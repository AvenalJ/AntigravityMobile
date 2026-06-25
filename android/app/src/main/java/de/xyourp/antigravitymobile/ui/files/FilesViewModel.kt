package de.xyourp.antigravitymobile.ui.files

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import de.xyourp.antigravitymobile.data.AppRepository
import de.xyourp.antigravitymobile.net.FileContentResponse
import de.xyourp.antigravitymobile.net.FileItem
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
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
)

class FilesViewModel(private val repo: AppRepository) : ViewModel() {

    private val _state = MutableStateFlow(FilesState())
    val state: StateFlow<FilesState> = _state.asStateFlow()

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
        _state.value = _state.value.copy(loading = true, error = null)
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
}
