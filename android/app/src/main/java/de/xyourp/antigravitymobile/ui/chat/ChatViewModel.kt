package de.xyourp.antigravitymobile.ui.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import de.xyourp.antigravitymobile.data.AppRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

data class ChatState(
    val html: String? = null,
    val css: String? = null,
    val bodyBg: String? = null,
    val bodyColor: String? = null,
    val loading: Boolean = true,
    val sending: Boolean = false,
    val processing: Boolean = false,
    val error: String? = null,
    /** Bumped whenever new chat content arrives so the WebView reloads. */
    val revision: Long = 0,
)

/**
 * Drives the live chat mirror. The bridge renders the IDE's Cascade panel to
 * HTML+CSS (`/api/chat/snapshot`); we display it in a WebView and re-fetch when
 * the bridge broadcasts `chat_update` over the WebSocket.
 */
class ChatViewModel(private val repo: AppRepository) : ViewModel() {

    private val _state = MutableStateFlow(ChatState())
    val state: StateFlow<ChatState> = _state.asStateFlow()

    @Volatile private var refreshing = false

    init {
        // Ask the bridge to begin polling the IDE and broadcasting updates.
        viewModelScope.launch { repo.api.startChatStream() }
        loadSnapshot(initial = true)
        repo.socket.events.onEach { msg ->
            if (msg.event == "chat_update" || msg.event == "history") {
                _state.value = _state.value.copy(processing = false)
                loadSnapshot(initial = false)
            }
        }.launchIn(viewModelScope)
    }

    fun loadSnapshot(initial: Boolean) {
        if (refreshing) return
        refreshing = true
        viewModelScope.launch {
            if (initial) _state.value = _state.value.copy(loading = true)
            runCatching { repo.api.chatSnapshot() }
                .onSuccess { snap ->
                    if (snap.html != null) {
                        _state.value = _state.value.copy(
                            html = snap.html,
                            css = snap.css,
                            bodyBg = snap.bodyBg,
                            bodyColor = snap.bodyColor,
                            loading = false,
                            error = null,
                            revision = _state.value.revision + 1,
                        )
                    } else {
                        _state.value = _state.value.copy(
                            loading = false,
                            error = snap.error ?: "No chat panel found in the IDE yet.",
                        )
                    }
                }
                .onFailure {
                    _state.value = _state.value.copy(
                        loading = false,
                        error = it.message ?: "Failed to load chat.",
                    )
                }
            refreshing = false
        }
    }

    /** URL of the embeddable web chat page shown in the native WebView. */
    fun webChatUrl(): String = repo.api.webChatUrl()

    fun send(prompt: String) {
        val text = prompt.trim()
        if (text.isEmpty()) return
        _state.value = _state.value.copy(sending = true)
        viewModelScope.launch {
            runCatching { repo.api.sendCommand(text) }
            _state.value = _state.value.copy(sending = false, processing = true)
        }
    }

}

/** Full standalone HTML document for the WebView mirror. */
fun ChatState.toDocument(): String {
    val bg = bodyBg ?: "#0F1413"
    val fg = bodyColor ?: "#E6ECEA"
    return """
        <!DOCTYPE html>
        <html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
        <style>
          html,body{margin:0;padding:12px;background:${bg};color:${fg};
            font-family:-apple-system,Roboto,Segoe UI,sans-serif;font-size:14px;
            line-height:1.5;word-break:break-word;overflow-x:hidden;}
          img{max-width:100%;height:auto;}
          pre,code{white-space:pre-wrap;word-break:break-word;}
          ${css ?: ""}
        </style>
        </head><body>${html ?: ""}</body></html>
    """.trimIndent()
}
