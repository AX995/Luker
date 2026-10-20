// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

package com.luker.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.ByteArrayOutputStream
import java.io.IOException

@RunWith(RobolectricTestRunner::class)
class LukerCdpHeapSnapshotTest {

    private val response = """{"id":2,"result":{}}"""
    private fun chunk(text: String) =
        """{"method":"HeapProfiler.addHeapSnapshotChunk","params":{"chunk":${
            org.json.JSONObject.quote(text)
        }}}"""

    @Test
    fun chunks_are_written_in_arrival_order() {
        val channel = FakeChannel(
            listOf(
                """{"id":1,"result":{}}""",
                chunk("{\"snapshot\":"),
                chunk("\"head\"}"),
                response,
            ),
        )
        val sink = ByteArrayOutputStream()

        val written = writeHeapSnapshot(channel, sink)

        assertEquals("""{"snapshot":"head"}""", sink.toString("UTF-8"))
        assertEquals(sink.size().toLong(), written)
    }

    @Test
    fun the_command_is_enabled_and_then_issued() {
        val channel = FakeChannel(listOf("""{"id":1,"result":{}}""", chunk("x"), response))

        writeHeapSnapshot(channel, ByteArrayOutputStream())

        assertTrue(channel.sent[0].contains("HeapProfiler.enable"))
        assertTrue(channel.sent[1].contains("HeapProfiler.takeHeapSnapshot"))
    }

    @Test
    fun unrelated_messages_do_not_end_the_capture() {
        val channel = FakeChannel(
            listOf(
                """{"id":1,"result":{}}""",
                """{"method":"HeapProfiler.reportHeapSnapshotProgress","params":{"done":1,"total":2}}""",
                """{"method":"Runtime.consoleAPICalled","params":{}}""",
                chunk("x"),
                response,
            ),
        )
        val sink = ByteArrayOutputStream()

        writeHeapSnapshot(channel, sink)

        assertEquals("x", sink.toString("UTF-8"))
    }

    @Test(expected = IOException::class)
    fun an_error_reply_ends_the_capture_as_a_failure() {
        val channel = FakeChannel(
            listOf(
                """{"id":1,"result":{}}""",
                """{"id":2,"error":{"code":-32000,"message":"Cannot take heap snapshot"}}""",
            ),
        )

        writeHeapSnapshot(channel, ByteArrayOutputStream())
    }

    @Test(expected = IOException::class)
    fun a_snapshot_without_a_single_chunk_is_a_failure() {
        val channel = FakeChannel(listOf("""{"id":1,"result":{}}""", response))

        writeHeapSnapshot(channel, ByteArrayOutputStream())
    }
}
