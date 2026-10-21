// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

package com.luker.app

import org.junit.Assert.assertEquals
import org.junit.Test

class LukerExternalLinkPolicyTest {
    private val appOrigin = "http://127.0.0.1:8000"

    @Test
    fun origin_strips_path_query_and_fragment() {
        assertEquals(appOrigin, LukerExternalLinkPolicy.originOf("http://127.0.0.1:8000/chat?x=1#y"))
        assertEquals(appOrigin, LukerExternalLinkPolicy.originOf("HTTP://127.0.0.1:8000"))
    }

    @Test
    fun origin_drops_the_scheme_default_port() {
        assertEquals("https://example.com", LukerExternalLinkPolicy.originOf("https://example.com:443/a"))
        assertEquals("http://example.com", LukerExternalLinkPolicy.originOf("http://example.com:80/a"))
    }

    @Test
    fun origin_is_empty_for_a_scheme_less_or_non_hierarchical_url() {
        assertEquals("", LukerExternalLinkPolicy.originOf("about:blank"))
        assertEquals("", LukerExternalLinkPolicy.originOf(""))
        assertEquals("", LukerExternalLinkPolicy.originOf(null))
    }

    @Test
    fun top_level_navigation_to_an_external_https_url_goes_to_the_browser() {
        assertEquals(
            LinkRoute.SYSTEM_BROWSER,
            LukerExternalLinkPolicy.routeTopLevelNavigation("https://example.com/x", appOrigin, appOrigin, true),
        )
    }

    @Test
    fun top_level_navigation_stays_in_app_when_the_toggle_is_off() {
        assertEquals(
            LinkRoute.IN_APP,
            LukerExternalLinkPolicy.routeTopLevelNavigation("https://example.com/x", appOrigin, appOrigin, false),
        )
    }

    @Test
    fun top_level_navigation_to_the_app_origin_stays_in_app() {
        assertEquals(
            LinkRoute.IN_APP,
            LukerExternalLinkPolicy.routeTopLevelNavigation("$appOrigin/chat", appOrigin, appOrigin, true),
        )
    }

    @Test
    fun a_different_port_is_a_different_origin() {
        assertEquals(
            LinkRoute.SYSTEM_BROWSER,
            LukerExternalLinkPolicy.routeTopLevelNavigation("http://127.0.0.1:8001/", appOrigin, appOrigin, true),
        )
    }

    @Test
    fun non_http_schemes_stay_in_app() {
        for (url in listOf(
            "about:blank",
            "blob:$appOrigin/0f1e",
            "data:text/html,<a href=\"https://example.com\">x</a>",
            "file:///sdcard/x.html",
        )) {
            assertEquals(
                url,
                LinkRoute.IN_APP,
                LukerExternalLinkPolicy.routeTopLevelNavigation(url, appOrigin, appOrigin, true),
            )
        }
    }

    @Test
    fun an_external_current_page_keeps_its_own_navigations_in_app() {
        assertEquals(
            LinkRoute.IN_APP,
            LukerExternalLinkPolicy.routeTopLevelNavigation(
                "https://example.com/session", "https://example.com/signin", appOrigin, true,
            ),
        )
        assertEquals(
            LinkRoute.IN_APP,
            LukerExternalLinkPolicy.routeTopLevelNavigation(
                "https://example.com/y", "https://example.com:443/x", appOrigin, true,
            ),
        )
        assertEquals(
            LinkRoute.IN_APP,
            LukerExternalLinkPolicy.routeTopLevelNavigation(
                "https://other.example/y", "https://example.com/x", appOrigin, true,
            ),
        )
        assertEquals(
            LinkRoute.IN_APP,
            LukerExternalLinkPolicy.routeTopLevelNavigation(
                "https://example.com/y", "https://example.com/x", appOrigin, false,
            ),
        )
    }

    @Test
    fun an_empty_or_unknown_current_page_counts_as_the_app_page() {
        for (currentUrl in listOf("$appOrigin/", "", "about:blank")) {
            assertEquals(currentUrl, LinkRoute.SYSTEM_BROWSER, LukerExternalLinkPolicy.routeTopLevelNavigation(
                "https://example.com/a", currentUrl, appOrigin, true,
            ))
        }
        assertEquals(
            LinkRoute.SYSTEM_BROWSER,
            LukerExternalLinkPolicy.routeTopLevelNavigation("https://example.com/a", null, appOrigin, true),
        )
        assertEquals(
            LinkRoute.IN_APP,
            LukerExternalLinkPolicy.routeTopLevelNavigation("https://example.com/a", "about:blank", appOrigin, false),
        )
    }

    @Test
    fun a_feature_popup_stays_in_app_regardless_of_the_toggle() {
        assertEquals(
            LinkRoute.POPUP,
            LukerExternalLinkPolicy.routeNewWindow("https://example.com/auth", true, appOrigin, true),
        )
        assertEquals(
            LinkRoute.POPUP,
            LukerExternalLinkPolicy.routeNewWindow("https://example.com/auth", true, appOrigin, false),
        )
    }

    @Test
    fun a_featureless_new_window_follows_the_top_level_rule() {
        assertEquals(
            LinkRoute.SYSTEM_BROWSER,
            LukerExternalLinkPolicy.routeNewWindow("https://example.com/x", false, appOrigin, true),
        )
        assertEquals(
            LinkRoute.IN_APP,
            LukerExternalLinkPolicy.routeNewWindow("https://example.com/x", false, appOrigin, false),
        )
    }

    @Test
    fun a_configured_non_local_endpoint_is_the_app_origin() {
        val configured = LukerExternalLinkPolicy.originOf("https://chat.example.net:8443/luker")
        assertEquals("https://chat.example.net:8443", configured)
        assertEquals(
            LinkRoute.IN_APP,
            LukerExternalLinkPolicy.routeTopLevelNavigation(
                "https://chat.example.net:8443/chat", configured, configured, true,
            ),
        )
        assertEquals(
            LinkRoute.IN_APP,
            LukerExternalLinkPolicy.routeNewWindow(
                "https://chat.example.net:8443/auth", false, configured, true,
            ),
        )
        assertEquals(
            LinkRoute.SYSTEM_BROWSER,
            LukerExternalLinkPolicy.routeTopLevelNavigation(
                "https://example.com/x", configured, configured, true,
            ),
        )
    }

    @Test
    fun settings_hold_the_toggle_defaulting_to_on() {
        LukerExternalLinkSettings.openExternally = true
        assertEquals(true, LukerExternalLinkSettings.openExternally)
        LukerExternalLinkSettings.setOpenExternally(false)
        assertEquals(false, LukerExternalLinkSettings.openExternally)
        LukerExternalLinkSettings.setOpenExternally(true)
    }
}
