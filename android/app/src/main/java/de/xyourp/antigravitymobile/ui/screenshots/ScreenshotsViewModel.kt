package de.xyourp.antigravitymobile.ui.screenshots

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import de.xyourp.antigravitymobile.data.AppRepository
import de.xyourp.antigravitymobile.net.ScreenshotItem
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ScreenshotsState(
    val items: List<ScreenshotItem> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    val selected: ScreenshotItem? = null,
)

class ScreenshotsViewModel(private val repo: AppRepository) : ViewModel() {

    private val _state = MutableStateFlow(ScreenshotsState())
    val state: StateFlow<ScreenshotsState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            load(initial = true)
            // Saved screenshots are captured on a schedule by the bridge; poll for new ones.
            while (true) {
                delay(10_000)
                load(initial = false)
            }
        }
    }

    fun load(initial: Boolean) {
        viewModelScope.launch {
            if (initial) _state.value = _state.value.copy(loading = true)
            runCatching { repo.api.screenshots() }
                .onSuccess { r ->
                    _state.value = _state.value.copy(items = r.screenshots, loading = false, error = null)
                }
                .onFailure {
                    if (initial) _state.value = _state.value.copy(loading = false, error = it.message ?: "Failed to load screenshots")
                }
        }
    }

    fun imageUrl(item: ScreenshotItem): String {
        val path = item.url ?: "/api/screenshots/${item.filename}"
        return repo.currentSettings().restUrl(path)
    }

    fun select(item: ScreenshotItem) { _state.value = _state.value.copy(selected = item) }
    fun closeViewer() { _state.value = _state.value.copy(selected = null) }
}
