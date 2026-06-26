package de.xyourp.antigravitymobile.ui.screen

import android.graphics.Bitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import de.xyourp.antigravitymobile.data.AppRepository
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
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
    }

    fun setMouseMode(b: Boolean) {
        viewModelScope.launch { repo.saveIsMouseMode(b) }
    }

    fun toggleAuto() {
        _auto.value = !_auto.value
    }

    fun refreshNow() {
        // No-op for streams, it naturally refreshes
    }

    fun click(nx: Float, ny: Float) = input { repo.api.screenClick(nx.toDouble(), ny.toDouble()) }
    
    fun mouse(type: String, nx: Float, ny: Float, button: String = "none", dx: Float? = null, dy: Float? = null) {
        viewModelScope.launch {
            runCatching { repo.api.screenMouse(type, nx.toDouble(), ny.toDouble(), button, dx?.toDouble(), dy?.toDouble()) }
        }
    }

    fun scroll(nx: Float, ny: Float, deltaY: Float) = input { repo.api.screenScroll(nx.toDouble(), ny.toDouble(), deltaY.toDouble()) }
    fun type(text: String) = input { repo.api.screenType(text) }
    fun key(name: String, ctrl: Boolean = false, alt: Boolean = false, shift: Boolean = false, meta: Boolean = false) =
        input { repo.api.screenKey(name, ctrl, alt, shift, meta) }

    /** Type [text] then press Enter — the common "send a message to the agent" action. */
    fun submit(text: String) = input {
        repo.api.screenType(text)
        repo.api.screenKey("Enter")
    }

    private fun input(block: suspend () -> Unit) {
        viewModelScope.launch {
            runCatching { block() }
        }
    }
}
