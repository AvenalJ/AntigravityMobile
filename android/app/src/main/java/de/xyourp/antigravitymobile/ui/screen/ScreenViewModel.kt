package de.xyourp.antigravitymobile.ui.screen

import android.graphics.Bitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import de.xyourp.antigravitymobile.data.AppRepository
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Drives the live screen ("Screen" tab). Frames are collected from the
 * bridge via a binary WebSocket stream. Tap/scroll/type/key are sent
 * to the bridge (fire-and-forget).
 */
class ScreenViewModel(private val repo: AppRepository) : ViewModel() {

    private val _currentFrame = MutableStateFlow<Bitmap?>(null)
    val currentFrame: StateFlow<Bitmap?> = _currentFrame.asStateFlow()

    private val _auto = MutableStateFlow(true)
    val autoRefresh: StateFlow<Boolean> = _auto.asStateFlow()

    private val _active = MutableStateFlow(false)

    /** One-shot user-facing errors (e.g. input failed to reach the remote). */
    private val _errors = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val errors: SharedFlow<String> = _errors.asSharedFlow()

    val cursorSize: StateFlow<Int> = repo.cursorSize.stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.WhileSubscribed(5000), 32)
    val cursorAlpha: StateFlow<Float> = repo.cursorAlpha.stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.WhileSubscribed(5000), 1.0f)
    val cursorTilt: StateFlow<Float> = repo.cursorTilt.stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.WhileSubscribed(5000), 0f)
    val cursorOffsetY: StateFlow<Float> = repo.cursorOffsetY.stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.WhileSubscribed(5000), 0f)
    val isMouseMode: StateFlow<Boolean> = repo.isMouseMode.stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.WhileSubscribed(5000), false)

    init {
        viewModelScope.launch {
            repo.socket.frames.collect { bitmap ->
                if (_active.value && _auto.value) {
                    _currentFrame.value = bitmap
                }
            }
        }

        viewModelScope.launch {
            while (true) {
                if (_active.value && _auto.value) {
                    repo.socket.send("""{"action":"watch_screen"}""")
                }
                delay(2000)
            }
        }
    }

    fun setActive(b: Boolean) {
        _active.value = b
        updateWatching()
    }

    fun setMouseMode(b: Boolean) {
        viewModelScope.launch { repo.saveIsMouseMode(b) }
    }

    fun toggleAuto() {
        _auto.value = !_auto.value
        updateWatching()
    }

    /** Tells the socket whether to bother decoding incoming frames at all —
     * the bridge streams to every connected client regardless, so this is the
     * only place frame decoding can be cheaply skipped. */
    private fun updateWatching() {
        repo.socket.screenWatching = _active.value && _auto.value
    }

    fun refreshNow() {
        // No-op for streams, it naturally refreshes
    }

    fun click(nx: Float, ny: Float) = input { repo.api.screenClick(nx.toDouble(), ny.toDouble()) }

    private data class MouseEvent(
        val type: String, val nx: Double, val ny: Double,
        val button: String, val dx: Double?, val dy: Double?,
    )

    /**
     * All mouse events go through one queue drained by a single coroutine, so
     * mousePressed/mouseReleased can never arrive at the PC out of order (each
     * event used to be its own parallel HTTP call — a release overtaking its
     * press left the remote button stuck down). Button presses/releases are
     * retried; a release that still fails is surfaced instead of swallowed.
     */
    private val mouseQueue = Channel<MouseEvent>(Channel.UNLIMITED)

    init {
        viewModelScope.launch {
            for (e in mouseQueue) {
                val send: suspend () -> Unit = {
                    repo.api.screenMouse(e.type, e.nx, e.ny, e.button, e.dx, e.dy)
                }
                if (e.type == "mouseMoved") {
                    runCatching { send() }
                } else if (!attempt(send)) {
                    _errors.tryEmit("Mouse ${if (e.type == "mousePressed") "press" else "release"} didn't reach the PC")
                }
            }
        }
    }

    fun mouse(type: String, nx: Float, ny: Float, button: String = "none", dx: Float? = null, dy: Float? = null) {
        mouseQueue.trySend(MouseEvent(type, nx.toDouble(), ny.toDouble(), button, dx?.toDouble(), dy?.toDouble()))
    }

    fun scroll(nx: Float, ny: Float, deltaY: Float) = input { repo.api.screenScroll(nx.toDouble(), ny.toDouble(), deltaY.toDouble()) }
    fun type(text: String) = guarded("Couldn't send text to the PC") { repo.api.screenType(text) }
    fun key(name: String, ctrl: Boolean = false, alt: Boolean = false, shift: Boolean = false, meta: Boolean = false) =
        guarded("Couldn't send key to the PC") { repo.api.screenKey(name, ctrl, alt, shift, meta) }

    /**
     * Type [text] then press Enter — the common "send a message to the agent".
     * Each step is retried independently so a half-delivered Send never re-types
     * the text; if either step still can't reach the remote, the user is told.
     */
    fun submit(text: String) {
        viewModelScope.launch {
            if (!attempt { repo.api.screenType(text) }) {
                _errors.tryEmit("Couldn't send your message to the PC")
                return@launch
            }
            if (!attempt { repo.api.screenKey("Enter") }) {
                _errors.tryEmit("Message typed, but Enter didn't reach the PC")
            }
        }
    }

    /** Run [block], retrying once after a short delay. Returns true if it succeeded. */
    private suspend fun attempt(block: suspend () -> Unit): Boolean {
        if (runCatching { block() }.isSuccess) return true
        delay(300)
        return runCatching { block() }.isSuccess
    }

    /** Fire-and-forget for non-critical input (mouse moves etc.); failures are ignored. */
    private fun input(block: suspend () -> Unit) {
        viewModelScope.launch {
            runCatching { block() }
        }
    }

    /**
     * Run a critical input action (typing/keys), retrying once, and surface
     * [errorMsg] to the user if it still doesn't reach the remote — so a dropped
     * keystroke is never silent.
     */
    private fun guarded(errorMsg: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            if (!attempt(block)) _errors.tryEmit(errorMsg)
        }
    }
}
