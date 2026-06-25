package de.xyourp.antigravitymobile.net

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import de.xyourp.antigravitymobile.data.ConnectionSettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.util.concurrent.TimeUnit

/** One decoded `{event,data,ts}` frame from the bridge WebSocket. */
data class SocketMessage(val event: String, val data: JsonElement?)

/**
 * WebSocket client for the bridge. Single connection, shared on the same port as
 * REST. Auto-reconnects with exponential backoff capped at 30s (per constraints).
 */
class LiveSocket(private val scope: CoroutineScope) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS) // long-lived
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    private val _events = MutableSharedFlow<SocketMessage>(extraBufferCapacity = 64)
    val events: SharedFlow<SocketMessage> = _events.asSharedFlow()

    private val _frames = MutableSharedFlow<Bitmap>(
        extraBufferCapacity = 2,
        onBufferOverflow = kotlinx.coroutines.channels.BufferOverflow.DROP_OLDEST
    )
    val frames: SharedFlow<Bitmap> = _frames.asSharedFlow()

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected.asStateFlow()

    private var webSocket: WebSocket? = null
    private var loopJob: Job? = null
    private var current: ConnectionSettings? = null

    fun connect(settings: ConnectionSettings) {
        if (settings == current && loopJob?.isActive == true) return
        stop()
        current = settings
        if (!settings.isConfigured) return
        loopJob = scope.launch { runWithBackoff(settings) }
    }

    /** Forces an immediate reconnect attempt (used by the "Retry" action). */
    fun reconnectNow() {
        val s = current ?: return
        stop()
        connect(s)
    }

    fun stop() {
        loopJob?.cancel()
        loopJob = null
        webSocket?.cancel()
        webSocket = null
        _connected.value = false
    }

    private suspend fun runWithBackoff(settings: ConnectionSettings) {
        var backoffMs = 1000L
        while (true) {
            val opened = openOnce(settings)
            // openOnce suspends until the socket closes/fails.
            if (opened) backoffMs = 1000L // reset after a successful session
            backoffMs = (backoffMs * 2).coerceAtMost(30_000L)
            delay(backoffMs)
        }
    }

    /** Opens a socket and suspends until it closes or fails. Returns true if it opened. */
    private suspend fun openOnce(settings: ConnectionSettings): Boolean {
        var everOpen = false
        val gate = kotlinx.coroutines.CompletableDeferred<Unit>()
        val listener = object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                everOpen = true
                _connected.value = true
            }

            override fun onMessage(ws: WebSocket, text: String) {
                emit(text)
            }

            override fun onMessage(ws: WebSocket, bytes: ByteString) {
                val byteArray = bytes.toByteArray()
                val bitmap = BitmapFactory.decodeByteArray(byteArray, 0, byteArray.size)
                if (bitmap != null) {
                    _frames.tryEmit(bitmap)
                }
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                ws.close(1000, null)
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                _connected.value = false
                if (!gate.isCompleted) gate.complete(Unit)
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                _connected.value = false
                if (!gate.isCompleted) gate.complete(Unit)
            }
        }
        val req = Request.Builder().url(settings.wsUrl).build()
        webSocket = client.newWebSocket(req, listener)
        gate.await()
        webSocket = null
        return everOpen
    }

    fun send(text: String) {
        webSocket?.send(text)
    }

    private fun emit(text: String) {
        runCatching {
            val obj = ApiClient.json.parseToJsonElement(text).jsonObject
            val event = obj["event"]?.jsonPrimitive?.content ?: return
            _events.tryEmit(SocketMessage(event, obj["data"]))
        }
    }
}
