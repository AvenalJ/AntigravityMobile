package de.xyourp.antigravitymobile.ui.screen

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import de.xyourp.antigravitymobile.data.AppRepository
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Drives the live screen ("Screen" tab). A counter [tick] is bumped on a timer while
 * the tab is active + auto-refresh is on; the UI loads the cache-busted live frame
 * for each tick. Tap/scroll/type/key are sent to the bridge (fire-and-forget) and we
 * bump a few extra frames afterwards to show the result quickly.
 */
class ScreenViewModel(private val repo: AppRepository) : ViewModel() {

    private val _tick = MutableStateFlow(0L)
    val tick: StateFlow<Long> = _tick.asStateFlow()

    private val _auto = MutableStateFlow(true)
    val autoRefresh: StateFlow<Boolean> = _auto.asStateFlow()

    private val _active = MutableStateFlow(false)

    init {
        viewModelScope.launch {
            while (true) {
                if (_active.value && _auto.value) bump()
                delay(700)
            }
        }
    }

    fun setActive(active: Boolean) {
        _active.value = active
        if (active) bump()
    }

    fun toggleAuto() {
        _auto.value = !_auto.value
        if (_auto.value) bump()
    }

    fun refreshNow() = bump()

    private fun bump() { _tick.value = _tick.value + 1 }

    fun urlFor(t: Long): String = repo.api.liveScreenUrl(t)

    fun click(nx: Float, ny: Float) = input { repo.api.screenClick(nx.toDouble(), ny.toDouble()) }
    fun scroll(nx: Float, ny: Float, deltaY: Float) = input { repo.api.screenScroll(nx.toDouble(), ny.toDouble(), deltaY.toDouble()) }
    fun type(text: String) = input { repo.api.screenType(text) }
    fun key(name: String) = input { repo.api.screenKey(name) }

    /** Type [text] then press Enter — the common "send a message to the agent" action. */
    fun submit(text: String) = input {
        repo.api.screenType(text)
        repo.api.screenKey("Enter")
    }

    private fun input(block: suspend () -> Unit) {
        viewModelScope.launch {
            runCatching { block() }
            // refresh several frames so the result of the action shows promptly
            repeat(4) { delay(220); bump() }
        }
    }
}
