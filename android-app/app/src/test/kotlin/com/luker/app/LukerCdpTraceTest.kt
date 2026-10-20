// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

package com.luker.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.ByteArrayOutputStream
import java.util.Base64

@RunWith(RobolectricTestRunner::class)
class LukerCdpTraceTest {

    private fun ioRead(handle: String, payload: String, eof: Boolean) = """
        {"id":99,"result":{"data":"${Base64.getEncoder().encodeToString(payload.toByteArray())}","base64Encoded":true,"eof":$eof}}
    """.trimIndent()

    /** The shape Chromium actually uses for the tracing stream: plain text. */
    private fun ioReadText(handle: String, payload: String, eof: Boolean) = """
        {"id":99,"result":{"data":${org.json.JSONObject.quote(payload)},"eof":$eof}}
    """.trimIndent()

    @Test
    fun begin_requests_a_stream_transfer() {
        val channel = FakeChannel(listOf("""{"id":1,"result":{}}"""))

        TraceSession(channel, ByteArrayOutputStream()).begin()

        assertTrue(channel.sent[0].contains("Tracing.start"))
        assertTrue(channel.sent[0].contains("ReturnAsStream"))
    }

    @Test
    fun finish_writes_the_stream_then_closes_it() {
        val channel = FakeChannel(
            listOf(
                """{"id":1,"result":{}}""",
                """{"method":"Tracing.tracingComplete","params":{"stream":"H1"}}""",
                ioRead("H1", "{\"traceEvents\":[", false),
                ioRead("H1", "]}", true),
                """{"id":2,"result":{}}""",
            ),
        )
        val sink = ByteArrayOutputStream()
        val session = TraceSession(channel, sink)
        session.begin()

        val written = session.finish()

        assertEquals("""{"traceEvents":[]}""", sink.toString("UTF-8"))
        assertEquals(sink.size().toLong(), written)
        assertTrue(channel.sent.last().contains("IO.close"))
        assertTrue(channel.sent.any { it.contains("IO.read") })
        assertFalse(session.isOpen)
    }

    @Test
    fun an_empty_stream_still_closes_and_returns_zero() {
        val channel = FakeChannel(
            listOf(
                """{"id":1,"result":{}}""",
                """{"method":"Tracing.tracingComplete","params":{"stream":"H1"}}""",
                ioRead("H1", "", true),
                """{"id":2,"result":{}}""",
            ),
        )
        val session = TraceSession(channel, ByteArrayOutputStream())
        session.begin()

        assertEquals(0L, session.finish())
    }

    @Test
    fun a_plain_text_chunk_is_written_as_is() {
        val channel = FakeChannel(
            listOf(
                """{"id":1,"result":{}}""",
                """{"method":"Tracing.tracingComplete","params":{"stream":"H1"}}""",
                ioReadText("H1", "{\"traceEvents\":[", false),
                ioReadText("H1", "]}", true),
                """{"id":2,"result":{}}""",
            ),
        )
        val sink = ByteArrayOutputStream()
        val session = TraceSession(channel, sink)
        session.begin()

        val written = session.finish()

        assertEquals("""{"traceEvents":[]}""", sink.toString("UTF-8"))
        assertEquals(sink.size().toLong(), written)
    }
}
