package de.xyourp.antigravitymobile.ui.settings

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import de.xyourp.antigravitymobile.data.AppRepository
import de.xyourp.antigravitymobile.data.ConnectionSettings
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

sealed interface TestResult {
    data object Idle : TestResult
    data object Testing : TestResult
    data class Success(val message: String) : TestResult
    data class Failure(val message: String) : TestResult
}

data class SettingsUiState(
    val host: String = "",
    val restPort: String = "5000",
    val wsPort: String = "5000",
    val loaded: Boolean = false,
    val test: TestResult = TestResult.Idle,
    val saved: Boolean = false,
    val cursorSize: Float = 32f,
    val cursorAlpha: Float = 1.0f,
    val cursorTilt: Float = 0f,
    val cursorOffsetY: Float = 0f,
    val paired: Boolean = false,
    val pairCode: String = "",
    val pairing: Boolean = false,
    val pairError: String? = null,
    val clipboardMessage: String? = null,
)

class SettingsViewModel(private val repo: AppRepository) : ViewModel() {

    private val _state = MutableStateFlow(SettingsUiState())
    val state: StateFlow<SettingsUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            val s = repo.settings.first()
            val size = repo.cursorSize.first()
            val alpha = repo.cursorAlpha.first()
            val tilt = repo.cursorTilt.first()
            val offsetY = repo.cursorOffsetY.first()
            _state.value = _state.value.copy(
                host = s.host,
                restPort = s.restPort.toString(),
                wsPort = s.wsPort.toString(),
                cursorSize = size.toFloat(),
                cursorAlpha = alpha,
                cursorTilt = tilt,
                cursorOffsetY = offsetY,
                paired = s.deviceToken.isNotBlank(),
                loaded = true,
            )
        }
    }

    fun onPairCode(v: String) { _state.value = _state.value.copy(pairCode = v.filter { it.isDigit() }.take(6), pairError = null) }

    fun pairDevice() {
        val code = _state.value.pairCode
        if (code.length < 6) { _state.value = _state.value.copy(pairError = "Enter the 6-digit code shown on the PC."); return }
        val target = build()
        if (target.host.isBlank()) { _state.value = _state.value.copy(pairError = "Enter the PC host/IP above first."); return }
        _state.value = _state.value.copy(pairing = true, pairError = null)
        viewModelScope.launch {
            // null = success; non-null = human-readable reason.
            val err = runCatching { repo.pair(target, code, android.os.Build.MODEL ?: "phone") }
                .getOrElse { it.message ?: "Unexpected error" }
            _state.value = _state.value.copy(
                pairing = false,
                paired = err == null,
                pairCode = if (err == null) "" else _state.value.pairCode,
                pairError = err,
            )
        }
    }

    fun onHost(v: String) { _state.value = _state.value.copy(host = v.trim(), test = TestResult.Idle, saved = false) }
    fun onRestPort(v: String) { _state.value = _state.value.copy(restPort = v.filter { it.isDigit() }.take(5), test = TestResult.Idle, saved = false) }
    fun onWsPort(v: String) { _state.value = _state.value.copy(wsPort = v.filter { it.isDigit() }.take(5), test = TestResult.Idle, saved = false) }
    
    fun onCursorSize(v: Float) { _state.value = _state.value.copy(cursorSize = v, saved = false) }
    fun onCursorAlpha(v: Float) { _state.value = _state.value.copy(cursorAlpha = v, saved = false) }
    fun onCursorTilt(v: Float) { _state.value = _state.value.copy(cursorTilt = v, saved = false) }
    fun onCursorOffsetY(v: Float) { _state.value = _state.value.copy(cursorOffsetY = v, saved = false) }

    fun pushClipboard(context: Context) {
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        val text = cm?.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()
        if (text.isNullOrEmpty()) { _state.value = _state.value.copy(clipboardMessage = "Phone clipboard is empty"); return }
        viewModelScope.launch {
            val ok = runCatching { repo.api.setClipboard(text) }.getOrNull()?.success == true
            _state.value = _state.value.copy(clipboardMessage = if (ok) "Sent to PC clipboard" else "Couldn't reach the PC")
        }
    }

    fun pullClipboard(context: Context) {
        viewModelScope.launch {
            val text = runCatching { repo.api.getClipboard() }.getOrNull()?.text
            if (text.isNullOrEmpty()) { _state.value = _state.value.copy(clipboardMessage = "PC clipboard is empty"); return@launch }
            val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            cm?.setPrimaryClip(ClipData.newPlainText("Antigravity", text))
            _state.value = _state.value.copy(clipboardMessage = "Copied PC clipboard to phone")
        }
    }

    private fun build(): ConnectionSettings = ConnectionSettings(
        host = _state.value.host.trim(),
        restPort = _state.value.restPort.toIntOrNull() ?: 5000,
        wsPort = _state.value.wsPort.toIntOrNull() ?: 5000,
    )

    fun testConnection() {
        val target = build()
        if (target.host.isBlank()) {
            _state.value = _state.value.copy(test = TestResult.Failure("Enter the Tailscale IP first."))
            return
        }
        _state.value = _state.value.copy(test = TestResult.Testing)
        viewModelScope.launch {
            runCatching { repo.api.ping(target) }
                .onSuccess { r ->
                    if (r.status == "ok") {
                        _state.value = _state.value.copy(
                            test = TestResult.Success("Connected — bridge is up (uptime ${r.uptime.toInt()}s)."),
                        )
                    } else {
                        _state.value = _state.value.copy(test = TestResult.Failure("Unexpected response from ${target.restBaseUrl}."))
                    }
                }
                .onFailure {
                    _state.value = _state.value.copy(
                        test = TestResult.Failure("Couldn't reach ${target.restBaseUrl}: ${it.message ?: "no response"}"),
                    )
                }
        }
    }

    fun save(onSaved: () -> Unit) {
        viewModelScope.launch {
            repo.saveConnection(build())
            repo.saveCursorSize(_state.value.cursorSize.toInt())
            repo.saveCursorAlpha(_state.value.cursorAlpha)
            repo.saveCursorTilt(_state.value.cursorTilt)
            repo.saveCursorOffsetY(_state.value.cursorOffsetY)
            _state.value = _state.value.copy(saved = true)
            onSaved()
        }
    }
}
