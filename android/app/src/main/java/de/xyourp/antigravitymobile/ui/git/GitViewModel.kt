package de.xyourp.antigravitymobile.ui.git

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import de.xyourp.antigravitymobile.data.AppRepository
import de.xyourp.antigravitymobile.net.GitFile
import de.xyourp.antigravitymobile.net.GitStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

data class DiffView(
    val file: String,
    val staged: Boolean,
    val text: String? = null,
    val loading: Boolean = true,
    val error: String? = null,
)

data class GitState(
    val loading: Boolean = true,
    val status: GitStatus = GitStatus(),
    val error: String? = null,
    val busy: Boolean = false,
    val message: String? = null,           // transient result (commit/checkout/discard)
    val branches: List<String> = emptyList(),
    val commitText: String = "",
    val diff: DiffView? = null,
)

/** Staged = index code is meaningful; unstaged = worktree code is meaningful. */
fun GitFile.isStaged() = x != "." && x != " " && x != "?"
fun GitFile.isUnstaged() = (y != "." && y != " ") && type != "untracked"
fun GitFile.isUntracked() = type == "untracked"

class GitViewModel(private val repo: AppRepository) : ViewModel() {

    private val _state = MutableStateFlow(GitState())
    val state: StateFlow<GitState> = _state.asStateFlow()

    init {
        refresh()
        repo.socket.events.onEach { msg ->
            when (msg.event) {
                "file_changed" -> if (_state.value.diff == null) refresh()
                "workspace_changed" -> { _state.value = _state.value.copy(diff = null); refresh() }
            }
        }.launchIn(viewModelScope)
    }

    fun refresh() {
        viewModelScope.launch {
            if (_state.value.status.files.isEmpty()) _state.value = _state.value.copy(loading = true)
            runCatching { repo.api.gitStatus() }
                .onSuccess { _state.value = _state.value.copy(status = it, loading = false, error = it.error) }
                .onFailure { _state.value = _state.value.copy(loading = false, error = it.message ?: "git failed") }
        }
    }

    private fun action(block: suspend () -> Unit) {
        viewModelScope.launch {
            _state.value = _state.value.copy(busy = true)
            runCatching { block() }
                .onFailure { _state.value = _state.value.copy(message = it.message ?: "Action failed") }
            _state.value = _state.value.copy(busy = false)
            refresh()
        }
    }

    fun stage(file: String) = action { repo.api.gitStage(file) }
    fun unstage(file: String) = action { repo.api.gitUnstage(file) }
    fun discard(file: String, untracked: Boolean) = action { repo.api.gitDiscard(file, untracked) }

    fun stageAll() = action {
        _state.value.status.files.filter { it.isUnstaged() || it.isUntracked() }
            .forEach { repo.api.gitStage(it.path) }
    }

    fun setCommitText(text: String) { _state.value = _state.value.copy(commitText = text) }

    fun commit() {
        val msg = _state.value.commitText.trim()
        if (msg.isEmpty()) return
        viewModelScope.launch {
            _state.value = _state.value.copy(busy = true)
            val r = runCatching { repo.api.gitCommit(msg) }.getOrNull()
            _state.value = _state.value.copy(
                busy = false,
                commitText = if (r?.success == true) "" else _state.value.commitText,
                message = if (r?.success == true) "Committed" else (r?.error ?: "Commit failed"),
            )
            refresh()
        }
    }

    fun loadBranches() {
        viewModelScope.launch {
            runCatching { repo.api.gitBranches() }.onSuccess {
                _state.value = _state.value.copy(branches = it.branches)
            }
        }
    }

    fun checkout(branch: String, create: Boolean) {
        viewModelScope.launch {
            _state.value = _state.value.copy(busy = true)
            val r = runCatching { repo.api.gitCheckout(branch, create) }.getOrNull()
            _state.value = _state.value.copy(
                busy = false,
                message = if (r?.success == true) "Switched to $branch" else (r?.error ?: "Checkout failed"),
            )
            refresh()
        }
    }

    fun openDiff(file: GitFile) {
        val staged = file.isStaged() && !file.isUnstaged()
        _state.value = _state.value.copy(diff = DiffView(file = file.path, staged = staged))
        viewModelScope.launch {
            runCatching { repo.api.gitDiff(file.path, staged) }
                .onSuccess { d ->
                    _state.value = _state.value.copy(
                        diff = DiffView(file = file.path, staged = staged, text = d.diff, loading = false, error = d.error),
                    )
                }
                .onFailure {
                    _state.value = _state.value.copy(
                        diff = DiffView(file = file.path, staged = staged, loading = false, error = it.message),
                    )
                }
        }
    }

    fun closeDiff() { _state.value = _state.value.copy(diff = null) }
    fun clearMessage() { _state.value = _state.value.copy(message = null) }
}
