// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

package com.luker.app

import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LukerCdpCaptureGuardTest {

    @After
    fun tearDown() {
        LukerCdpCapture.endHeapCapture()
    }

    @Test
    fun only_one_heap_capture_runs_at_a_time() {
        assertTrue(LukerCdpCapture.tryBeginHeapCapture())
        assertFalse(LukerCdpCapture.tryBeginHeapCapture())

        LukerCdpCapture.endHeapCapture()

        assertTrue(LukerCdpCapture.tryBeginHeapCapture())
    }

    @Test
    fun no_trace_is_reported_before_one_starts() {
        assertFalse(LukerCdpCapture.isTraceRecording())
    }
}
