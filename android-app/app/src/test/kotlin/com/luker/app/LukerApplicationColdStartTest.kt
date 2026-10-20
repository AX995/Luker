// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

package com.luker.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Robolectric builds the manifest's application before `@Before` runs, so the
 * instance under test is already attached; each case resets the trail and
 * invokes `onCreate()` again to replay the cold-start path against the pref
 * value the case just set.
 *
 * Assertions read [LukerDebugTrail], never [LukerCdpCollector.started]: that
 * flag is a process-wide singleton which never resets, so it would leak
 * between the two cases.
 */
@RunWith(RobolectricTestRunner::class)
class LukerApplicationColdStartTest {

    private val app = ApplicationProvider.getApplicationContext<LukerApplication>()
    private val context: Context get() = app

    @Before
    fun setUp() {
        LukerDebugTrail.resetForTest()
        LukerAndroidDebugConfig.setEnabled(context, false)
    }

    @After
    fun tearDown() {
        LukerAndroidDebugConfig.setEnabled(context, false)
        LukerDebugTrail.resetForTest()
    }

    @Test
    fun cold_start_arms_the_debug_switch_without_the_collector() {
        app.onCreate()

        val trail = LukerDebugTrail.dumpAll()
        assertTrue(trail, trail.contains("state=arm debug-enabled=true"))
        assertFalse(trail, trail.contains("cdp-collector state=start"))
    }

    @Test
    fun cold_start_with_the_pref_on_also_starts_the_collector() {
        LukerAndroidDebugConfig.setEnabled(context, true)

        app.onCreate()

        assertTrue(LukerDebugTrail.dumpAll().contains("cdp-collector state=start"))
    }
}
