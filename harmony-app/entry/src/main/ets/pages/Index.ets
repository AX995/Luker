import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { picker, fileIo } from '@kit.CoreFileKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import http from '@ohos.net.http';
import { getBackendStatus } from 'libnode_ctl.so';
import { BackendManager } from '../BackendManager';
import { launchInProcessEarly } from '../BackendLauncher';
import { promptAction } from '@kit.ArkUI';
import { listPending, acknowledge, StoredReport } from '../crash/CrashReportStore';
import { buildCrashSummary, isArkWebCrashReason } from '../crash/CrashSummary';
import { exportTo } from '../crash/DiagnosticsExporter';
import { writeArkWebExit } from '../crash/CrashCapture';
import { LastExit } from '../crash/LastExit';
import { KeepAliveManager, LukerHarmonyBridge } from '../KeepAliveManager';
import { FileSelectionPlan, MediaKind, planFileSelection } from '../FileSelectionPlanner';
import { BusinessError } from '@kit.BasicServicesKit';

const TAG: string = 'luker.Index';
const DOMAIN: number = 0xE1EC;
const SERVER_URL: string = 'http://127.0.0.1:8000';
const BOOT_TIMEOUT_MS: number = 120_000;
const CONFIRM_EXIT_WINDOW_MS: number = 2000;

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  private bridge: LukerHarmonyBridge = new LukerHarmonyBridge();
  @State serverReady: boolean = false;
  @State statusMessage: string = '';
  private exporting: boolean = false;
  private crashDialogDone: boolean = false;
  private saveTargets: Map<string, string> = new Map<string, string>();
  private fsHandler: FullScreenExitHandler | null = null;
  private lastExitPressAt: number = 0;

  aboutToAppear(): void {
    this.statusMessage = this.res($r('app.string.starting_engine').id, '0s');
    let dialogShown: boolean = false;
    try {
      dialogShown = this.checkPendingCrash();
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'checkPendingCrash failed: %{public}s', JSON.stringify(e));
    }
    if (!dialogShown) {
      this.start();
    }
  }

  private res(id: number, arg?: string): string {
    const mgr = getContext(this).resourceManager;
    return arg === undefined ? mgr.getStringSync(id) : mgr.getStringSync(id, arg);
  }

  private crashFilesDir(): string {
    return (getContext(this) as common.UIAbilityContext).filesDir;
  }

  private async doExport(): Promise<void> {
    if (this.exporting) {
      return;
    }
    this.exporting = true;
    try {
      await exportTo(getContext(this) as common.UIAbilityContext);
    } catch (e) {
      promptAction.showToast({
        message: this.res($r('app.string.export_failed').id, String(e))
      });
    } finally {
      this.exporting = false;
    }
  }

  /**
   * Shows the crash dialog when the previous run ended abnormally or an
   * unacknowledged report exists. Returns true when the dialog is shown; the
   * backend start then waits for the dialog, so an export captures the crashed
   * run's node logs before a new launch rotates them.
   */
  private checkPendingCrash(): boolean {
    const pending: StoredReport[] = listPending(this.crashFilesDir());
    if (pending.length === 0 && !LastExit.deferBackend) {
      return false;
    }
    let summary: string = '';
    for (let i = 0; i < pending.length; i++) {
      summary += buildCrashSummary(pending[i].body) + '\n\n';
    }
    if (summary.trim().length === 0) {
      summary = this.res($r('app.string.no_crash_report').id);
    }
    promptAction.showDialog({
      title: this.res($r('app.string.crash_dialog_title').id),
      message: this.res($r('app.string.crash_dialog_intro').id) + '\n\n' + summary,
      buttons: [
        { text: this.res($r('app.string.crash_dialog_close').id), color: '#8b93a7' },
        { text: this.res($r('app.string.export_diagnostics').id), color: '#4aa3ff' }
      ]
    }).then(async (result: promptAction.ShowDialogSuccessResponse) => {
      if (result.index === 1) {
        await this.doExport();
      }
      this.finishCrashDialog();
    }).catch(() => {
      this.finishCrashDialog();
    });
    return true;
  }

  private finishCrashDialog(): void {
    if (this.crashDialogDone) {
      return;
    }
    this.crashDialogDone = true;
    // Acknowledge with the current time: a hiAppEvent report for the same
    // crash that arrives later carries an earlier time and stays acknowledged.
    acknowledge(this.crashFilesDir(), Date.now());
    LastExit.deferBackend = false;
    this.start();
  }

  async start(): Promise<void> {
    const context = getContext(this) as common.UIAbilityContext;
    if (!BackendManager.launchAttempted) {
      launchInProcessEarly(context);
    }
    const startedAt: number = Date.now();
    while (Date.now() - startedAt < BOOT_TIMEOUT_MS) {
      if (await this.probe()) {
        this.serverReady = true;
        return;
      }
      const secs: number = Math.round((Date.now() - startedAt) / 1000);
      const status: string = getBackendStatusSafe();
      this.statusMessage =
        this.res($r('app.string.starting_engine').id, `${secs}s`) + '\n' +
        this.res($r('app.string.backend_status').id, status);
      if (status.startsWith('failed:')) {
        this.statusMessage = this.res($r('app.string.engine_failed').id, status);
        return;
      }
      await this.sleep(200);
    }
    this.statusMessage = this.res($r('app.string.engine_timeout').id);
  }

  async probe(): Promise<boolean> {
    const client = http.createHttp();
    try {
      const resp = await client.request(SERVER_URL, {
        method: http.RequestMethod.GET,
        connectTimeout: 3000,
        readTimeout: 3000,
        usingCache: false
      });
      return resp.responseCode >= 200 && resp.responseCode < 500;
    } catch {
      return false;
    } finally {
      client.destroy();
    }
  }

  sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(() => resolve(), ms));
  }

  onBackPress(): boolean {
    if (this.fsHandler !== null) {
      this.lastExitPressAt = 0;
      this.fsHandler.exitFullScreen();
      return true;
    }
    try {
      if (this.controller.accessStep(-1)) {
        this.lastExitPressAt = 0;
        this.controller.backward();
        return true;
      }
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'accessStep failed: %{public}s', JSON.stringify(e));
    }
    this.dispatchBackToWeb();
    return true;
  }

  private dispatchBackToWeb(): void {
    const script = "(function(){try{return (typeof window.__lukerHandleBack === 'function') ? String(window.__lukerHandleBack()) : 'noop';}catch(e){return 'noop';}})();";
    this.controller.runJavaScript(script, (err: BusinessError, result: string) => {
      if (err) {
        hilog.error(DOMAIN, TAG, 'runJavaScript failed: %{public}s', JSON.stringify(err));
      }
      const value = String(result || '').trim().replace(/^"|"$/g, '').toLowerCase();
      if (value === 'consumed') {
        this.lastExitPressAt = 0;
        return;
      }
      this.confirmExit();
    });
  }

  private confirmExit(): void {
    const now: number = Date.now();
    if (this.lastExitPressAt !== 0 && now - this.lastExitPressAt <= CONFIRM_EXIT_WINDOW_MS) {
      const context = getContext(this) as common.UIAbilityContext;
      context.terminateSelf();
      return;
    }
    this.lastExitPressAt = now;
    promptAction.showToast({ message: this.res($r('app.string.press_back_again_to_exit').id) });
  }

  /**
   * Routes page-initiated downloads (the frontend saves backups and exports by
   * clicking an `<a download>` on a blob/data URL) through the ArkWeb download
   * delegate. Without it the download is silently dropped and no save dialog
   * appears. The delegate must be set once the controller is attached to the
   * Web component.
   */
  private setupDownloads(): void {
    const delegate = new webview.WebDownloadDelegate();
    const context = getContext(this) as common.UIAbilityContext;
    delegate.onBeforeDownload((item: webview.WebDownloadItem) => {
      const fileName: string = item.getSuggestedFileName() || 'luker-download';
      // The download stays PENDING until start() is called, so it is safe to
      // await the picker first.
      this.pickSavePath(fileName).then((targetUri: string) => {
        if (targetUri.length === 0) {
          item.cancel();
          return;
        }
        this.saveTargets.set(item.getGuid(), targetUri);
        // Download into the app cache, then copy to the user-picked location:
        // ArkWeb always may write its own sandbox, while the picked URI is
        // written through the fd opened with the picker's grant.
        item.start(`${context.cacheDir}/${fileName}`);
      }).catch((e: object) => {
        hilog.error(DOMAIN, TAG, 'download save path failed: %{public}s', JSON.stringify(e));
        item.cancel();
      });
    });
    delegate.onDownloadFinish((item: webview.WebDownloadItem) => {
      const targetUri: string = this.saveTargets.get(item.getGuid()) ?? '';
      this.saveTargets.delete(item.getGuid());
      if (targetUri.length === 0) {
        return;
      }
      this.copyToUserPath(item.getFullPath(), targetUri);
    });
    delegate.onDownloadFailed((item: webview.WebDownloadItem) => {
      this.saveTargets.delete(item.getGuid());
      hilog.error(DOMAIN, TAG, 'download failed: %{public}d', item.getLastErrorCode());
      promptAction.showToast({ message: this.res($r('app.string.download_failed').id) });
    });
    try {
      this.controller.setDownloadDelegate(delegate);
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'setDownloadDelegate failed: %{public}s', JSON.stringify(e));
    }
  }

  private async pickSavePath(fileName: string): Promise<string> {
    const context = getContext(this) as common.UIAbilityContext;
    const options = new picker.DocumentSaveOptions();
    options.newFileNames = [fileName];
    const result: Array<string> = await new picker.DocumentViewPicker(context).save(options);
    if (result.length === 0 || !result[0]) {
      return '';
    }
    return result[0];
  }

  private async copyToUserPath(sourcePath: string, targetUri: string): Promise<void> {
    try {
      const src = fileIo.openSync(sourcePath, fileIo.OpenMode.READ_ONLY);
      const dst = fileIo.openSync(targetUri, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE);
      await fileIo.copyFile(src.fd, dst.fd);
      fileIo.closeSync(src);
      fileIo.closeSync(dst);
      try {
        fileIo.unlinkSync(sourcePath);
      } catch {
        // best effort
      }
      promptAction.showToast({ message: this.res($r('app.string.download_saved').id) });
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'download copy failed: %{public}s', JSON.stringify(e));
      promptAction.showToast({ message: this.res($r('app.string.download_failed').id) });
    }
  }

  /**
   * Answers a page file-upload request. ArkWeb keeps the file input pending
   * until the result is handed back, so every path, including a cancelled or
   * failed picker, has to call handleFileList.
   */
  private async resolveFileSelection(event: OnShowFileSelectorEvent): Promise<void> {
    let selected: Array<string> = [];
    try {
      const multiple: boolean =
        event.fileSelector.getMode() === FileSelectorMode.FileOpenMultipleMode;
      const plan: FileSelectionPlan = planFileSelection(
        event.fileSelector.getAcceptType(),
        event.fileSelector.getMimeTypes(),
        multiple,
      );
      selected = plan.useMediaPicker
        ? await this.pickMedia(plan)
        : await this.pickDocument(plan);
    } catch (e) {
      hilog.error(DOMAIN, TAG, 'file selection failed: %{public}s', JSON.stringify(e));
    }
    event.result.handleFileList(selected);
  }

  private async pickMedia(plan: FileSelectionPlan): Promise<Array<string>> {
    const options = new photoAccessHelper.PhotoSelectOptions();
    options.MIMEType = mediaMimeType(plan.mediaKind);
    if (plan.maxSelectNumber > 0) {
      options.maxSelectNumber = plan.maxSelectNumber;
    }
    const mediaPicker = new photoAccessHelper.PhotoViewPicker();
    const result: photoAccessHelper.PhotoSelectResult = await mediaPicker.select(options);
    return result.photoUris;
  }

  private async pickDocument(plan: FileSelectionPlan): Promise<Array<string>> {
    const options = new picker.DocumentSelectOptions();
    if (plan.fileSuffixFilters.length > 0) {
      options.fileSuffixFilters = plan.fileSuffixFilters;
    }
    if (plan.maxSelectNumber > 0) {
      options.maxSelectNumber = plan.maxSelectNumber;
    }
    const context = getContext(this) as common.UIAbilityContext;
    const documentPicker = new picker.DocumentViewPicker(context);
    return await documentPicker.select(options);
  }

  build() {
    Stack() {
      if (this.serverReady) {
        Web({ src: SERVER_URL, controller: this.controller })
          .width('100%')
          .height('100%')
          .javaScriptAccess(true)
          .domStorageAccess(true)
          .javaScriptProxy({
            object: this.bridge,
            name: 'LukerHarmony',
            methodList: ['setGenerationActive', 'setImmersiveModeEnabled'],
            controller: this.controller
          })
          .onControllerAttached(() => {
            this.setupDownloads();
          })
          // A reload or renderer exit drops the page's generation state, so the
          // native flag must not outlive it.
          .onPageBegin(() => {
            KeepAliveManager.setGenerationActive(false);
          })
          .onRenderExited((event) => {
            KeepAliveManager.setGenerationActive(false);
            if (event && isArkWebCrashReason(event.renderExitReason)) {
              writeArkWebExit(this.crashFilesDir(), event.renderExitReason);
            }
          })
          .onFullScreenEnter((event) => {
            this.fsHandler = event.handler;
          })
          .onFullScreenExit(() => {
            this.fsHandler = null;
          })
          .onShowFileSelector((event) => {
            if (event) {
              this.resolveFileSelection(event);
            }
            return true;
          })
      } else {
        Column({ space: 16 }) {
          Text('Luker').fontSize(24).fontWeight(FontWeight.Bold).fontColor('#cfd6e4')
          LoadingProgress().width(36).height(36).color('#4aa3ff')
          Text(this.statusMessage)
            .fontSize(12)
            .fontColor('#8b93a7')
            .textAlign(TextAlign.Center)
            .padding({ left: 24, right: 24 })
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .backgroundColor('#15171a')
      }
    }
    .width('100%')
    .height('100%')
  }
}

function mediaMimeType(kind: MediaKind): photoAccessHelper.PhotoViewMIMETypes {
  switch (kind) {
    case MediaKind.Image:
      return photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
    case MediaKind.Video:
      return photoAccessHelper.PhotoViewMIMETypes.VIDEO_TYPE;
    default:
      return photoAccessHelper.PhotoViewMIMETypes.IMAGE_VIDEO_TYPE;
  }
}

function getBackendStatusSafe(): string {
  try {
    return getBackendStatus();
  } catch {
    return 'unavailable';
  }
}
