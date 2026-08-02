package de.xyourp.antigravitymobile.ui.session

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import de.xyourp.antigravitymobile.data.AppRepository
import de.xyourp.antigravitymobile.net.ApprovalsResponse
import de.xyourp.antigravitymobile.net.CdpSource
import de.xyourp.antigravitymobile.net.QuotaResponse
import de.xyourp.antigravitymobile.net.Repo
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

enum class AgentStatus(val label: String) {
    Running("Running"),
    Idle("Idle"),
    Waiting("Waiting for input"),
    Offline("Offline"),
}

data class SessionState(
    val workspaceName: String? = null,
    val models: List<String> = emptyList(),
    val currentModel: String? = null,
    val currentMode: String? = null,
    val modelsLoading: Boolean = false,
    val agentStatus: AgentStatus = AgentStatus.Idle,
    val pendingApproval: ApprovalsResponse? = null,
    val respondingApproval: Boolean = false,
    val repos: List<Repo> = emptyList(),
    val currentRepoPath: String? = null,
    val sources: List<CdpSource> = emptyList(),
    val sourcePreference: String = "auto",
    val quota: QuotaResponse? = null,
    val quotaLoading: Boolean = false,
)

/**
 * Session-scoped state shared by the top bar (workspace + model chip), the model
 * picker, and the chat approval bar. Derives agent status from the approvals
 * endpoint plus recent chat activity (the bridge exposes no explicit run flag).
 */
class SessionViewModel(private val repo: AppRepository) : ViewModel() {

    private val _state = MutableStateFlow(SessionState())
    val state: StateFlow<SessionState> = _state.asStateFlow()

    /** One-shot user-facing messages (clipboard sync etc.) shown as snackbars. */
    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val messages: SharedFlow<String> = _messages.asSharedFlow()

    @Volatile private var lastChatActivityMs: Long = 0L
    @Volatile private var screenActive: Boolean = false

    init {
        loadWorkspace()
        loadModels()
        loadRepos()
        loadSources()
        observeSocket()
        pollAgentStatus()
        // Apply the persisted model choice as a fallback display value.
        repo.selectedModel.onEach { saved ->
            if (saved != null && _state.value.currentModel == null) {
                _state.value = _state.value.copy(currentModel = saved)
            }
        }.launchIn(viewModelScope)
    }

    fun noteChatActivity() {
        lastChatActivityMs = System.currentTimeMillis()
    }

    /**
     * The live Screen tab runs a screencast that holds the bridge's single CDP slot, so
     * approval polling can't run then (it would fail and block live frames). Pause it
     * while the Screen tab is active and show a neutral status.
     */
    fun setScreenActive(active: Boolean) {
        screenActive = active
        if (active) _state.value = _state.value.copy(agentStatus = AgentStatus.Idle, pendingApproval = null)
    }

    private fun observeSocket() {
        repo.socket.events.onEach { msg ->
            when (msg.event) {
                "chat_update", "mobile_command" -> noteChatActivity()
                "model_changed" -> loadModels()
                "approval_responded" -> {
                    _state.value = _state.value.copy(pendingApproval = null)
                    refreshApprovals()
                }
                "workspace_changed" -> { loadWorkspace(); loadRepos() }
                "source_changed" -> { loadSources(); loadModels(); loadWorkspace() }
            }
        }.launchIn(viewModelScope)
    }

    /** Send the phone's clipboard text to the PC clipboard. */
    fun pushClipboard(context: Context) {
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        val text = cm?.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()
        if (text.isNullOrEmpty()) { _messages.tryEmit("Phone clipboard is empty"); return }
        viewModelScope.launch {
            val ok = runCatching { repo.api.setClipboard(text) }.getOrNull()?.success == true
            _messages.tryEmit(if (ok) "Sent to PC clipboard" else "Couldn't reach the PC")
        }
    }

    /** Copy the PC's clipboard text into the phone's clipboard. */
    fun pullClipboard(context: Context) {
        viewModelScope.launch {
            val text = runCatching { repo.api.getClipboard() }.getOrNull()?.text
            if (text.isNullOrEmpty()) { _messages.tryEmit("PC clipboard is empty"); return@launch }
            val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            cm?.setPrimaryClip(ClipData.newPlainText("Antigravity", text))
            _messages.tryEmit("Copied PC clipboard to phone")
        }
    }

    /** Fetch model usage/quota (for the Usage sheet). */
    fun loadQuota() {
        _state.value = _state.value.copy(quotaLoading = true)
        viewModelScope.launch {
            runCatching { repo.api.quota() }
                .onSuccess { _state.value = _state.value.copy(quota = it, quotaLoading = false) }
                .onFailure {
                    _state.value = _state.value.copy(
                        quota = QuotaResponse(available = false, error = it.message ?: "Failed to load usage"),
                        quotaLoading = false,
                    )
                }
        }
    }

    fun loadSources() {
        viewModelScope.launch {
            runCatching { repo.api.cdpSources() }.onSuccess { r ->
                _state.value = _state.value.copy(sources = r.sources, sourcePreference = r.preference)
            }
        }
    }

    /** Switch which Antigravity app the bridge mirrors: "auto" | "app" | "ide". */
    fun setSource(target: String) {
        _state.value = _state.value.copy(sourcePreference = target) // optimistic
        viewModelScope.launch {
            runCatching { repo.api.setCdpTarget(target) }.onSuccess { r ->
                _state.value = _state.value.copy(sources = r.sources, sourcePreference = r.preference)
            }
            loadModels(); loadWorkspace()
        }
    }

    fun loadRepos() {
        viewModelScope.launch {
            runCatching { repo.api.repos() }.onSuccess { r ->
                _state.value = _state.value.copy(repos = r.repos, currentRepoPath = r.current)
            }
        }
    }

    /** Open [path] in the Antigravity IDE (new window, CDP enabled). */
    fun openIde(path: String) {
        viewModelScope.launch {
            runCatching { repo.api.launchIde(path) }
            // Give the IDE a moment to come up, then refresh source availability.
            kotlinx.coroutines.delay(2500)
            loadSources()
        }
    }

    /** Start a new 2.0 conversation in project [path] (new app window, CDP enabled). */
    fun newConversation(path: String) {
        viewModelScope.launch {
            runCatching { repo.api.launchConversation(path) }
            kotlinx.coroutines.delay(2500)
            loadSources()
        }
    }

    /** Add a repo by path and immediately switch to it. */
    fun addAndSelectRepo(path: String) {
        val p = path.trim()
        if (p.isEmpty()) return
        viewModelScope.launch {
            runCatching { repo.api.selectRepo(p) }
            loadRepos()
            loadWorkspace()
        }
    }

    fun selectRepo(path: String) {
        viewModelScope.launch {
            runCatching { repo.api.selectRepo(path) }
            loadRepos()
            loadWorkspace()
        }
    }

    fun removeRepo(path: String) {
        viewModelScope.launch {
            runCatching { repo.api.removeRepo(path) }
            loadRepos()
        }
    }

    fun loadWorkspace() {
        viewModelScope.launch {
            runCatching { repo.api.workspace() }.onSuccess {
                _state.value = _state.value.copy(workspaceName = it.projectName ?: it.workspace)
            }
        }
    }

    fun loadModels() {
        viewModelScope.launch {
            _state.value = _state.value.copy(modelsLoading = true)
            runCatching { repo.api.models() }
                .onSuccess { r ->
                    val current = r.currentModel?.takeIf { it.isNotBlank() && it != "Unknown" }
                        ?: _state.value.currentModel
                    _state.value = _state.value.copy(
                        models = r.models,
                        currentModel = current,
                        currentMode = r.currentMode?.takeIf { it != "Unknown" } ?: _state.value.currentMode,
                        modelsLoading = false,
                    )
                }
                .onFailure { _state.value = _state.value.copy(modelsLoading = false) }
        }
    }

    fun selectModel(model: String) {
        // Optimistic update + persist.
        _state.value = _state.value.copy(currentModel = model)
        viewModelScope.launch {
            repo.saveSelectedModel(model)
            runCatching { repo.api.setModel(model) }.onSuccess { res ->
                res.selected?.let { _state.value = _state.value.copy(currentModel = it) }
            }
        }
    }

    private fun pollAgentStatus() {
        viewModelScope.launch {
            while (true) {
                if (!screenActive) refreshApprovals()
                delay(3000)
            }
        }
    }

    fun refreshApprovals() {
        viewModelScope.launch {
            runCatching { repo.api.approvals() }
                .onSuccess { a ->
                    val pending = if (a.pending) a else null
                    val recentChat = System.currentTimeMillis() - lastChatActivityMs < 6000
                    val status = when {
                        a.pending -> AgentStatus.Waiting
                        recentChat -> AgentStatus.Running
                        else -> AgentStatus.Idle
                    }
                    _state.value = _state.value.copy(pendingApproval = pending, agentStatus = status)
                }
                .onFailure {
                    _state.value = _state.value.copy(agentStatus = AgentStatus.Offline)
                }
        }
    }

    fun respondApproval(action: String) {
        _state.value = _state.value.copy(respondingApproval = true)
        viewModelScope.launch {
            runCatching { repo.api.respondApproval(action) }
            _state.value = _state.value.copy(respondingApproval = false, pendingApproval = null)
            refreshApprovals()
        }
    }
}
