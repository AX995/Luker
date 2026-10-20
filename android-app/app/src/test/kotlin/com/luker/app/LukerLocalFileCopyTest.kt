// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

package com.luker.app

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class LukerLocalFileCopyTest {

    @Test
    fun every_byte_is_copied_and_counted() {
        val payload = ByteArray(200_000) { (it % 251).toByte() }
        val sink = ByteArrayOutputStream()

        val written = copyWithProgress(ByteArrayInputStream(payload), sink, payload.size.toLong()) { _, _ -> }

        assertEquals(payload.size.toLong(), written)
        assertEquals(payload.toList(), sink.toByteArray().toList())
    }

    @Test
    fun progress_is_reported_and_ends_at_the_total() {
        val payload = ByteArray(300_000)
        val reports = mutableListOf<Pair<Long, Long>>()

        copyWithProgress(ByteArrayInputStream(payload), ByteArrayOutputStream(), payload.size.toLong()) { done, total ->
            reports.add(done to total)
        }

        assertEquals(payload.size.toLong(), reports.last().first)
        assertEquals(payload.size.toLong(), reports.last().second)
    }

    @Test
    fun an_unknown_total_still_copies_everything() {
        val payload = ByteArray(50_000)
        val sink = ByteArrayOutputStream()

        val written = copyWithProgress(ByteArrayInputStream(payload), sink, -1L) { _, _ -> }

        assertEquals(payload.size.toLong(), written)
        assertEquals(payload.size, sink.size())
    }
}
