// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

import UIKit
import WebKit

final class ViewController: UIViewController {
    private enum BootState {
        case startingRuntime
        case waitingForServer
        case failed(reason: String)
        case ready
    }

    private static let serverReadyTimeout: TimeInterval = 90
    private static let serverReadyPollInterval: TimeInterval = 0.5

    private let runtime = LukerRuntimeManager.shared
    private var webView: WKWebView?
    private var downloadShareViewController: UIViewController?
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]

    private let statusStack: UIStackView = {
        let stack = UIStackView()
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        return stack
    }()

    private let spinner = UIActivityIndicatorView(style: .large)

    private let statusLabel: UILabel = {
        let label = UILabel()
        label.textAlignment = .center
        label.numberOfLines = 0
        label.font = .preferredFont(forTextStyle: .body)
        return label
    }()

    private let diagnosticsTextView: UITextView = {
        let textView = UITextView()
        textView.isEditable = false
        textView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        textView.layer.borderColor = UIColor.separator.cgColor
        textView.layer.borderWidth = 1
        textView.layer.cornerRadius = 8
        return textView
    }()

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        configureConstraints()
        setBootState(.startingRuntime)
        startRuntime()
    }

    private func configureConstraints() {
        statusStack.addArrangedSubview(spinner)
        statusStack.addArrangedSubview(statusLabel)
        statusStack.addArrangedSubview(diagnosticsTextView)
        diagnosticsTextView.isHidden = true
        view.addSubview(statusStack)
        NSLayoutConstraint.activate([
            statusStack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            statusStack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            statusStack.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
            view.trailingAnchor.constraint(greaterThanOrEqualTo: statusStack.trailingAnchor, constant: 24),
            diagnosticsTextView.widthAnchor.constraint(lessThanOrEqualToConstant: 480),
            diagnosticsTextView.heightAnchor.constraint(lessThanOrEqualToConstant: 320),
        ])
    }

    // MARK: - Boot flow

    private func startRuntime() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result = self?.runtime.startIfNeeded()
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                guard let result else { return }
                if result.ok {
                    self.setBootState(.waitingForServer)
                    self.waitForServer()
                } else {
                    self.setBootState(.failed(reason: result.error ?? NSLocalizedString("runtime_failure_reason_unknown_error", comment: "")))
                }
            }
        }
    }

    private func waitForServer() {
        let deadline = Date().addingTimeInterval(Self.serverReadyTimeout)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            while Date() < deadline {
                guard let self, self.runtime.isServerReady() else {
                    Thread.sleep(forTimeInterval: Self.serverReadyPollInterval)
                    continue
                }
                DispatchQueue.main.async { [weak self] in
                    self?.setBootState(.ready)
                }
                return
            }
            DispatchQueue.main.async { [weak self] in
                self?.setBootState(.failed(reason: NSLocalizedString("loading_failed_timeout", comment: "")))
            }
        }
    }

    private func setBootState(_ state: BootState) {
        switch state {
        case .startingRuntime:
            spinner.startAnimating()
            statusLabel.text = NSLocalizedString("loading_runtime", comment: "")
            diagnosticsTextView.isHidden = true
            navigationItem.rightBarButtonItems = nil
        case .waitingForServer:
            spinner.startAnimating()
            statusLabel.text = NSLocalizedString("loading_webview", comment: "")
            diagnosticsTextView.isHidden = true
        case .failed(let reason):
            spinner.stopAnimating()
            statusLabel.text = String(
                format: NSLocalizedString("loading_failed_with_reason", comment: ""),
                reason
            )
            diagnosticsTextView.text = runtime.collectDiagnostics()
            diagnosticsTextView.isHidden = false
            navigationItem.rightBarButtonItems = [
                UIBarButtonItem(
                    title: NSLocalizedString("diagnostics_share", comment: ""),
                    style: .plain,
                    target: self,
                    action: #selector(shareDiagnostics)
                ),
                UIBarButtonItem(
                    title: NSLocalizedString("retry", comment: ""),
                    style: .plain,
                    target: self,
                    action: #selector(retryBoot)
                ),
            ]
        case .ready:
            spinner.stopAnimating()
            statusStack.isHidden = true
            installWebView()
        }
    }

    @objc private func retryBoot() {
        setBootState(.startingRuntime)
        startRuntime()
    }

    @objc private func shareDiagnostics() {
        let text = runtime.collectDiagnostics()
        let activityViewController = UIActivityViewController(
            activityItems: [text],
            applicationActivities: nil
        )
        present(activityViewController, animated: true)
    }

    // MARK: - Web view

    private func installWebView() {
        guard webView == nil else { return }
        let configuration = WKWebViewConfiguration()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        self.webView = webView
        webView.load(URLRequest(url: runtime.serverURL))
    }
}

// MARK: - WKNavigationDelegate

extension ViewController: WKNavigationDelegate {
    /// Mirrors the Android external link policy: same-origin navigations stay
    /// inside the app, everything else goes to the system browser.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        preferences: WKWebpagePreferences,
        decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
    ) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download, preferences)
            return
        }

        let url = navigationAction.request.url
        if runtime.isSameOriginURL(url) {
            if navigationAction.targetFrame == nil {
                // A popup (target=_blank) from the local UI: load it in the
                // same web view instead of dropping the navigation.
                if let request = navigationAction.request as URLRequest? {
                    webView.load(request)
                }
                decisionHandler(.cancel, preferences)
                return
            }
            decisionHandler(.allow, preferences)
            return
        }

        if let url, UIApplication.shared.canOpenURL(url) {
            UIApplication.shared.open(url)
        } else if let url {
            let alert = UIAlertController(
                title: nil,
                message: NSLocalizedString("no_app_can_open_link", comment: ""),
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: NSLocalizedString("close", comment: ""), style: .default))
            present(alert, animated: true)
        }
        decisionHandler(.cancel, preferences)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        if navigationResponse.canShowMIMEType {
            decisionHandler(.allow)
        } else {
            decisionHandler(.download)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.load(URLRequest(url: runtime.serverURL))
    }
}

// MARK: - WKDownloadDelegate

extension ViewController: WKDownloadDelegate {
    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let filename = suggestedFilename.isEmpty
            ? NSLocalizedString("download_saved_fallback_name", comment: "")
            : suggestedFilename
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        try? FileManager.default.removeItem(at: destination)
        downloadDestinations[ObjectIdentifier(download)] = destination
        completionHandler(destination)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let fileURL = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let alert = UIAlertController(
            title: nil,
            message: String(format: NSLocalizedString("download_saved", comment: ""), fileURL.lastPathComponent),
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(
            title: NSLocalizedString("download_share", comment: ""),
            style: .default
        ) { [weak self] _ in
            let share = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
            self?.present(share, animated: true)
        })
        alert.addAction(UIAlertAction(title: NSLocalizedString("close", comment: ""), style: .cancel))
        present(alert, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
        let alert = UIAlertController(
            title: nil,
            message: NSLocalizedString("download_failed", comment: ""),
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: NSLocalizedString("close", comment: ""), style: .cancel))
        present(alert, animated: true)
    }
}

// MARK: - WKUIDelegate

extension ViewController: WKUIDelegate {
    /// JS alert()/confirm()/prompt() land here; show them natively so the web
    /// UI can use the same dialogs it uses on Android.
    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("close", comment: ""), style: .default) { _ in
            completionHandler()
        })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("ok", comment: ""), style: .default) { _ in
            completionHandler(true)
        })
        alert.addAction(UIAlertAction(title: NSLocalizedString("cancel", comment: ""), style: .cancel) { _ in
            completionHandler(false)
        })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { textField in
            textField.text = defaultText
        }
        alert.addAction(UIAlertAction(title: NSLocalizedString("ok", comment: ""), style: .default) { _ in
            completionHandler(alert.textFields?.first?.text)
        })
        alert.addAction(UIAlertAction(title: NSLocalizedString("cancel", comment: ""), style: .cancel) { _ in
            completionHandler(nil)
        })
        present(alert, animated: true)
    }
}
