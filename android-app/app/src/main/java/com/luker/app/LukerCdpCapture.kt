// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

package com.luker.app

import android.net.LocalSocket
import android.net.LocalSocketAddress
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream
import java.util.Base64
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

/**
 * The subset of a CDP transport the capture code needs. `LukerWebSocketChannel`
 * adapts the real WebSocket; tests script it directly.
 */
internal interface CdpChannel {
    fun sendText(text: String)
    fun readMessage(): String
}

internal class LukerWebSocketChannel(private val ws: LukerWebSocketClient) : CdpChannel {
    override fun sendText(text: String) = ws.sendText(text)
    override fun readMessage(): String = ws.readMessage()
}

/**
 * Drives `HeapProfiler.takeHeapSnapshot` and streams every
 * `addHeapSnapshotChunk` payload straight into [sink] as it arrives, so the
 * snapshot never has to fit in memory.
 *
 * Returns the number of bytes written.
 */
internal fun writeHeapSnapshot(channel: CdpChannel, sink: OutputStream): Long {
    channel.sendText("""{"id":1,"method":"HeapProfiler.enable"}""")
    channel.sendText(
        """{"id":2,"method":"HeapProfiler.takeHeapSnapshot","params":{"reportProgress":true,"captureNumericValue":true}}""",
    )
    var written = 0L
    var chunks = 0
    var maxChunk = 0
    while (true) {
        val message = channel.readMessage()
        val obj = JSONObject(message)
        val error = obj.optJSONObject("error")
        if (error != null) {
            throw IOException("cdp-capture: ${error.optString("message", "heap snapshot failed")}")
        }
        if (obj.optInt("id", -1) == 2) break
        if (obj.optString("method") != "HeapProfiler.addHeapSnapshotChunk") continue
        val text = obj.optJSONObject("params")?.optString("chunk") ?: continue
        val bytes = text.toByteArray(Charsets.UTF_8)
        sink.write(bytes)
        sink.flush()
        written += bytes.size
        chunks++
        if (bytes.size > maxChunk) maxChunk = bytes.size
    }
    if (written == 0L) {
        throw IOException("cdp-capture: heap snapshot returned no data")
    }
    LukerDebugTrail.append("native", "cdp-capture state=heap-write bytes=$written chunks=$chunks max-chunk=$maxChunk")
    return written
}

internal const val TRACE_READ_CHUNK_BYTES = 512 * 1024

/**
 * `IO.read` returns base64, so one response decodes to at most 3/4 of the
 * requested size; 512 KB keeps the response well under the 1 MB collector cap
 * and under [LukerCdpCapture.CAPTURE_MAX_MESSAGE_BYTES].
 */
internal const val TRACE_CATEGORIES =
    "devtools.timeline,v8,blink,cc,gpu," +
        "disabled-by-default-devtools.timeline," +
        "disabled-by-default-devtools.timeline.frame," +
        "disabled-by-default-v8.cpu_profiler"

/**
 * One performance recording, spanning `Tracing.start` … `Tracing.end`.
 *
 * `transferMode: ReturnAsStream` makes Chromium buffer the trace and hand it
 * back through `IO.read` once the recording ends, so [begin] returns as soon
 * as the recording starts and the trace bytes arrive during [finish]. The
 * channel must stay connected for the whole session.
 *
 * No screenshot categories are requested: the images dominate the file size
 * and add nothing to a stall investigation.
 */
internal class TraceSession(
    private val channel: CdpChannel,
    private val sink: OutputStream,
) {
    private var nextId = 1

    @Volatile
    private var open = false

    val isOpen: Boolean get() = open

    fun begin() {
        check(!open) { "cdp-trace: session already open" }
        channel.sendText(
            """{"id":${nextId++},"method":"Tracing.start","params":""" +
                """{"categories":"$TRACE_CATEGORIES","transferMode":"ReturnAsStream"}}""",
        )
        open = true
    }

    /**
     * Ends the recording, drains the returned stream into [sink] and closes
     * the handle. Returns the number of bytes written.
     *
     * Throws [IOException] on a transport error or a CDP error response;
     * `open` stays true in that case so the caller can still tear down.
     */
    fun finish(): Long {
        check(open) { "cdp-trace: session is not open" }
        channel.sendText("""{"id":${nextId++},"method":"Tracing.end"}""")

        var stream: String? = null
        while (stream == null) {
            val obj = JSONObject(channel.readMessage())
            failOnError(obj, "Tracing.end")
            if (obj.optString("method") != "Tracing.tracingComplete") continue
            stream = obj.optJSONObject("params")?.optString("stream")?.takeIf { it.isNotEmpty() }
                ?: throw IOException("cdp-trace: tracingComplete carried no stream handle")
        }

        var written = 0L
        while (true) {
            channel.sendText(
                """{"id":${nextId++},"method":"IO.read","params":""" +
                    """{"handle":"$stream","size":$TRACE_READ_CHUNK_BYTES}}""",
            )
            val obj = JSONObject(channel.readMessage())
            failOnError(obj, "IO.read")
            val result = obj.optJSONObject("result")
                ?: throw IOException("cdp-trace: IO.read returned no result")
            val data = result.optString("data")
            if (data.isNotEmpty()) {
                // IO.read hands back plain text unless the stream is binary,
                // in which case it base64-encodes and says so.
                val bytes = if (result.optBoolean("base64Encoded", false)) {
                    Base64.getDecoder().decode(data)
                } else {
                    data.toByteArray(Charsets.UTF_8)
                }
                sink.write(bytes)
                written += bytes.size
            }
            if (result.optBoolean("eof", false)) break
        }
        sink.flush()

        channel.sendText("""{"id":${nextId++},"method":"IO.close","params":{"handle":"$stream"}}""")
        open = false
        return written
    }

    private fun failOnError(obj: JSONObject, what: String) {
        val error = obj.optJSONObject("error") ?: return
        throw IOException("cdp-trace: $what failed: ${error.optString("message", "unknown error")}")
    }
}

object LukerCdpCapture {

    /**
     * Upper bound on one assembled WebSocket message during a capture.
     *
     * The collector's 1 MB default is sized for console/runtime events. A
     * heap-snapshot chunk is a slice of the whole snapshot text, and the
     * DevTools frontend splits that text at ~100 KB per message — but the
     * split size is an implementation detail of the Chromium build shipped
     * on the device, not a contract, and a rejected chunk would abort the
     * capture. 16 MB is two orders of magnitude above the observed chunk
     * size while staying far below the process heap limit, and it is only
     * ever allocated for the single message currently being assembled.
     * Task 7 records the observed maximum in the debug trail.
     */
    internal const val CAPTURE_MAX_MESSAGE_BYTES = 16 * 1024 * 1024

    private val heapInFlight = AtomicBoolean(false)

    private val traceLock = Any()

    @Volatile
    private var traceSession: TraceSession? = null

    @Volatile
    private var traceSocket: LocalSocket? = null

    @Volatile
    private var traceSink: OutputStream? = null

    @Volatile
    private var traceTarget: File? = null

    /**
     * Connects to the renderer's devtools socket, takes a heap snapshot and
     * streams it to [target]. Returns [target] on success.
     *
     * Throws [IOException] when the socket is not up yet, when the target list
     * holds no local page, or on any transport error. A failed capture deletes
     * [target] before rethrowing so a partial snapshot is never handed out as
     * a result.
     */
    fun captureHeapSnapshot(pid: Int, target: File): File {
        val targetInfo = LukerCdpTarget.fetchTarget(pid)
            ?: throw IOException("cdp-capture: no devtools target for pid=$pid")
        val wsPath = LukerCdpTarget.extractPath(targetInfo.optString("webSocketDebuggerUrl", ""))
        if (wsPath.isEmpty()) throw IOException("cdp-capture: target has no websocket path pid=$pid")

        target.parentFile?.mkdirs()
        try {
            LocalSocket().use { sock ->
                sock.connect(LocalSocketAddress(LukerCdpTarget.socketName(pid), LocalSocketAddress.Namespace.ABSTRACT))
                val ws = LukerWebSocketClient(sock.inputStream, sock.outputStream, CAPTURE_MAX_MESSAGE_BYTES)
                ws.handshake(wsPath)
                BufferedOutputStream(FileOutputStream(target)).use { out ->
                    writeHeapSnapshot(LukerWebSocketChannel(ws), out)
                }
            }
        } catch (t: Throwable) {
            target.delete()
            throw t
        }
        return target
    }

    /**
     * Opens a trace session and leaves it recording: the connection stays
     * open until [stopTrace] or [abortTrace] ends it. Returns [target].
     *
     * Throws when a session is already recording, when the socket is not up
     * yet or the target list holds no local page, or on any transport error.
     */
    fun startTrace(pid: Int, target: File): File = synchronized(traceLock) {
        check(traceSession == null) { "cdp-capture: a trace is already recording" }
        val targetInfo = LukerCdpTarget.fetchTarget(pid)
            ?: throw IOException("cdp-capture: no devtools target for pid=$pid")
        val wsPath = LukerCdpTarget.extractPath(targetInfo.optString("webSocketDebuggerUrl", ""))
        if (wsPath.isEmpty()) throw IOException("cdp-capture: target has no websocket path pid=$pid")

        target.parentFile?.mkdirs()
        val sock = LocalSocket()
        var sink: OutputStream? = null
        try {
            sock.connect(LocalSocketAddress(LukerCdpTarget.socketName(pid), LocalSocketAddress.Namespace.ABSTRACT))
            val ws = LukerWebSocketClient(sock.inputStream, sock.outputStream, CAPTURE_MAX_MESSAGE_BYTES)
            ws.handshake(wsPath)
            val out = BufferedOutputStream(FileOutputStream(target))
            sink = out
            val session = TraceSession(LukerWebSocketChannel(ws), out)
            session.begin()
            traceSession = session
            traceSocket = sock
            traceSink = out
            traceTarget = target
        } catch (t: Throwable) {
            runCatching { sink?.close() }
            runCatching { sock.close() }
            target.delete()
            throw t
        }
        target
    }

    /**
     * Ends the recording, writes the trace to the session's target file and
     * returns it. The session is always torn down, even on failure.
     *
     * Throws [IllegalStateException] when nothing is recording; deletes the
     * target and rethrows when the trace could not be drained, so an
     * incomplete trace is never offered as a result.
     */
    fun stopTrace(): File = synchronized(traceLock) {
        val session = traceSession ?: throw IllegalStateException("cdp-capture: no trace is recording")
        val target = traceTarget ?: throw IllegalStateException("cdp-capture: trace has no target file")
        try {
            val written = session.finish()
            LukerDebugTrail.append("native", "cdp-capture state=trace-write bytes=$written file=${target.name}")
            target
        } catch (t: Throwable) {
            target.delete()
            throw t
        } finally {
            runCatching { traceSink?.close() }
            runCatching { traceSocket?.close() }
            traceSession = null
            traceSocket = null
            traceSink = null
            traceTarget = null
        }
    }

    fun isTraceRecording(): Boolean = traceSession?.isOpen == true

    /**
     * Claims the single heap-snapshot slot. Returns false when a capture is
     * already running, so a second request is refused instead of interleaving
     * writes into the same file.
     */
    fun tryBeginHeapCapture(): Boolean = heapInFlight.compareAndSet(false, true)

    fun endHeapCapture() {
        heapInFlight.set(false)
    }

    /**
     * Finalizes a recording that can no longer continue — the renderer is gone
     * or the page navigated away. Flushes and closes the sink and socket and
     * clears the session. Returns false when nothing was recording.
     *
     * With `transferMode: ReturnAsStream` the trace bytes are only handed over
     * once `Tracing.end` runs, so an aborted recording has written nothing yet;
     * whatever landed on disk stays there for a manual pull.
     */
    fun abortTrace(): Boolean = synchronized(traceLock) {
        if (traceSession == null) return@synchronized false
        val name = traceTarget?.name
        runCatching { traceSink?.close() }
        runCatching { traceSocket?.close() }
        traceSession = null
        traceSocket = null
        traceSink = null
        traceTarget = null
        LukerDebugTrail.append("native", "cdp-capture state=trace-abort file=${name ?: "<none>"}")
        true
    }
}
