// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

package com.luker.app

enum class LinkRoute {
    IN_APP,
    SYSTEM_BROWSER,
    POPUP,
}

/**
 * Process-wide copy of the "open external links in the system browser"
 * preference. The web UI writes it through the JS bridge while the navigation
 * client reads it on every request, so it lives outside the web settings.
 */
object LukerExternalLinkSettings {
    @Volatile
    var openExternally: Boolean = true

    // Kotlin properties do not expose a callable synthetic setter, and the
    // property setter already occupies this JVM signature, so the named
    // function used by the JS bridge is renamed on the JVM.
    @JvmName("applyOpenExternally")
    fun setOpenExternally(value: Boolean) {
        openExternally = value
    }
}

/**
 * Decides where a navigation request is handled.
 *
 * Only `http` and `https` URLs whose origin differs from the app origin can
 * leave the app. Every other scheme (`blob:`, `data:`, `about:blank`, …) — and
 * everything without an authority — stays in the WebView. Server redirects are
 * not routed here; the caller keeps them in the app.
 *
 * A page that is itself outside the app origin is a session the app admitted on
 * purpose — a server redirect into a sign-in page, for instance — and the
 * page's own navigations, form posts included, belong to that session. They
 * stay in the WebView regardless of the target and of the toggle, because the
 * app page is already off screen and the system browser would break the flow
 * mid-way. An empty or unknown current URL counts as the app page.
 */
object LukerExternalLinkPolicy {
    private const val SCHEME_SEPARATOR = "://"

    /**
     * Returns the lowercased `scheme://host[:port]` part of [raw], with the
     * scheme default port dropped. Returns an empty string when [raw] has no
     * `://` separator or no authority.
     */
    fun originOf(raw: String?): String {
        if (raw.isNullOrEmpty()) return ""
        val lower = raw.lowercase()
        val schemeEnd = lower.indexOf(SCHEME_SEPARATOR)
        if (schemeEnd < 0) return ""
        val scheme = lower.substring(0, schemeEnd)
        val rest = lower.substring(schemeEnd + SCHEME_SEPARATOR.length)
        val authorityEnd = rest.indexOfFirst { it == '/' || it == '?' || it == '#' }
        val authority = (if (authorityEnd < 0) rest else rest.substring(0, authorityEnd))
            .substringAfterLast('@')
        if (authority.isEmpty()) return ""

        val colon = authority.lastIndexOf(':')
        val port = if (colon >= 0) authority.substring(colon + 1) else ""
        val hasPort = port.isNotEmpty() && port.all { it in '0'..'9' }
        val host = if (hasPort) authority.substring(0, colon) else authority
        val defaultPort = (scheme == "http" && port == "80") || (scheme == "https" && port == "443")
        val effectivePort = if (hasPort && !defaultPort) ":$port" else ""
        return "$scheme://$host$effectivePort"
    }

    private fun isExternal(url: String?, appOrigin: String): Boolean {
        val origin = originOf(url)
        if (origin.isEmpty()) return false
        val scheme = origin.substring(0, origin.indexOf(SCHEME_SEPARATOR))
        if (scheme != "http" && scheme != "https") return false
        return origin != appOrigin
    }

    /**
     * Routes a main-frame navigation. [currentUrl] is the URL the main frame is
     * on right before this request; a frame that is already outside the app
     * origin keeps the request in the app so an admitted redirect session
     * survives. [routeNewWindow] deliberately takes no current URL: a new
     * window starts from the page that opened it and is not part of that
     * session.
     */
    fun routeTopLevelNavigation(
        url: String?,
        currentUrl: String?,
        appOrigin: String,
        openExternally: Boolean,
    ): LinkRoute {
        val currentOrigin = originOf(currentUrl)
        if (currentOrigin.isNotEmpty() && currentOrigin != appOrigin) return LinkRoute.IN_APP
        if (!isExternal(url, appOrigin)) return LinkRoute.IN_APP
        return if (openExternally) LinkRoute.SYSTEM_BROWSER else LinkRoute.IN_APP
    }

    fun routeNewWindow(
        url: String?,
        hasWindowFeatures: Boolean,
        appOrigin: String,
        openExternally: Boolean,
    ): LinkRoute {
        if (hasWindowFeatures) return LinkRoute.POPUP
        return routeTopLevelNavigation(url, null, appOrigin, openExternally)
    }
}
