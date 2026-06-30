package de.xyourp.antigravitymobile.ui.files

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import de.xyourp.antigravitymobile.data.AppRepository
import de.xyourp.antigravitymobile.net.FileContentResponse
import de.xyourp.antigravitymobile.net.FileItem
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

data class FilesState(
    val path: String? = null,
    val parent: String? = null,
    val items: List<FileItem> = emptyList(),
    val isRoot: Boolean = false,
    val loading: Boolean = true,
    val error: String? = null,
    val openFile: FileContentResponse? = null,
    val fileLoading: Boolean = false,
    val fileError: String? = null,
    /** Multi-select for downloading: which item paths are selected. */
    val selecting: Boolean = false,
    val selected: Set<String> = emptySet(),
    val downloading: Boolean = false,
)

class FilesViewModel(private val repo: AppRepository) : ViewModel() {

    private val _state = MutableStateFlow(FilesState())
    val state: StateFlow<FilesState> = _state.asStateFlow()

    /** Transient user-facing messages (download results). */
    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val messages: SharedFlow<String> = _messages.asSharedFlow()

    init {
        navigate(null)
        repo.socket.events.onEach { msg ->
            when (msg.event) {
                "file_changed" -> if (_state.value.openFile == null) refresh()
                "workspace_changed" -> { closeFile(); navigate(null) } // repo switched → reload root
            }
        }.launchIn(viewModelScope)
    }

    fun navigate(path: String?) {
        // Leaving a folder clears any in-progress selection.
        _state.value = _state.value.copy(loading = true, error = null, selecting = false, selected = emptySet())
        viewModelScope.launch {
            runCatching { repo.api.files(path) }
                .onSuccess { r ->
                    if (r.error != null) {
                        _state.value = _state.value.copy(loading = false, error = r.error)
                    } else {
                        _state.value = _state.value.copy(
                            path = r.path,
                            parent = r.parent,
                            items = r.items,
                            isRoot = r.isRoot,
                            loading = false,
                            error = null,
                        )
                    }
                }
                .onFailure { _state.value = _state.value.copy(loading = false, error = it.message ?: "Failed to list files") }
        }
    }

    fun refresh() = navigate(_state.value.path)

    fun openItem(item: FileItem) {
        if (item.isDirectory) {
            navigate(item.path)
        } else {
            openFile(item.path)
        }
    }

    fun goUp() {
        _state.value.parent?.let { navigate(it) }
    }

    private fun openFile(path: String) {
        _state.value = _state.value.copy(fileLoading = true, fileError = null, openFile = null)
        viewModelScope.launch {
            runCatching { repo.api.fileContent(path) }
                .onSuccess { r ->
                    if (r.content != null) {
                        _state.value = _state.value.copy(openFile = r, fileLoading = false)
                    } else {
                        _state.value = _state.value.copy(fileLoading = false, fileError = r.error ?: "Cannot open file")
                    }
                }
                .onFailure { _state.value = _state.value.copy(fileLoading = false, fileError = it.message ?: "Failed to open file") }
        }
    }

    fun closeFile() {
        _state.value = _state.value.copy(openFile = null, fileError = null, fileLoading = false)
    }

    // --- Multi-select + download to the phone ---

    /** Enter selection mode with [item] selected (e.g. on long-press). */
    fun startSelection(item: FileItem) {
        _state.value = _state.value.copy(selecting = true, selected = setOf(item.path))
    }

    fun toggleSelected(item: FileItem) {
        val cur = _state.value.selected
        val next = if (item.path in cur) cur - item.path else cur + item.path
        _state.value = _state.value.copy(selected = next, selecting = next.isNotEmpty())
    }

    fun clearSelection() {
        _state.value = _state.value.copy(selecting = false, selected = emptySet())
    }

    /** Download a single item (file or folder) immediately. */
    fun downloadItem(context: Context, item: FileItem) = download(context, listOf(item))

    /** Download all currently-selected items, then exit selection mode. */
    fun downloadSelected(context: Context) {
        val items = _state.value.items.filter { it.path in _state.value.selected }
        if (items.isEmpty()) return
        download(context, items)
        clearSelection()
    }

    private fun download(context: Context, items: List<FileItem>) {
        _state.value = _state.value.copy(downloading = true)
        // Use the application context so the work survives screen recomposition.
        val appCtx = context.applicationContext
        viewModelScope.launch {
            val result = FileDownloader.download(appCtx, repo.api, items)
            _state.value = _state.value.copy(downloading = false)
            _messages.tryEmit(result.message)
        }
    }
}
