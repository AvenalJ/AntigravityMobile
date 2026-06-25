package de.xyourp.antigravitymobile.ui.settings

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
)

class SettingsViewModel(private val repo: AppRepository) : ViewModel() {

    private val _state = MutableStateFlow(SettingsUiState())
    val state: StateFlow<SettingsUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            val s = repo.settings.first()
            _state.value = _state.value.copy(
                host = s.host,
                restPort = s.restPort.toString(),
                wsPort = s.wsPort.toString(),
                loaded = true,
            )
        }
    }

    fun onHost(v: String) { _state.value = _state.value.copy(host = v.trim(), test = TestResult.Idle, saved = false) }
    fun onRestPort(v: String) { _state.value = _state.value.copy(restPort = v.filter { it.isDigit() }.take(5), test = TestResult.Idle, saved = false) }
    fun onWsPort(v: String) { _state.value = _state.value.copy(wsPort = v.filter { it.isDigit() }.take(5), test = TestResult.Idle, saved = false) }

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
            _state.value = _state.value.copy(saved = true)
            onSaved()
        }
    }
}
