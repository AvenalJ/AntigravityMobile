package de.xyourp.antigravitymobile.data

import de.xyourp.antigravitymobile.net.ApiClient
import de.xyourp.antigravitymobile.net.LiveSocket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach

/**
 * Single source of truth for the app: holds the latest [ConnectionSettings],
 * wires them into the [ApiClient] and [LiveSocket], and reconnects the socket
 * whenever the connection settings change.
 */
class AppRepository(private val settingsStore: SettingsStore) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @Volatile
    private var currentSettings: ConnectionSettings = ConnectionSettings()

    val api = ApiClient(settingsProvider = { currentSettings })
    val socket = LiveSocket(scope)

    val settings: Flow<ConnectionSettings> = settingsStore.settings
    val selectedModel: Flow<String?> = settingsStore.selectedModel
    
    val cursorSize: Flow<Int> = settingsStore.cursorSize
    val cursorAlpha: Flow<Float> = settingsStore.cursorAlpha
    val cursorTilt: Flow<Float> = settingsStore.cursorTilt
    val cursorOffsetY: Flow<Float> = settingsStore.cursorOffsetY
    val isMouseMode: Flow<Boolean> = settingsStore.isMouseMode
    val lastTab: Flow<String?> = settingsStore.lastTab

    init {
        settingsStore.settings
            .onEach { s ->
                currentSettings = s
                socket.connect(s)
            }
            .launchIn(scope)
    }

    fun currentSettings(): ConnectionSettings = currentSettings

    suspend fun saveConnection(settings: ConnectionSettings) {
        settingsStore.saveConnection(settings)
    }

    suspend fun saveSelectedModel(model: String) {
        settingsStore.saveSelectedModel(model)
    }

    suspend fun saveCursorSize(size: Int) {
        settingsStore.saveCursorSize(size)
    }

    suspend fun saveCursorAlpha(alpha: Float) {
        settingsStore.saveCursorAlpha(alpha)
    }

    suspend fun saveCursorTilt(tilt: Float) {
        settingsStore.saveCursorTilt(tilt)
    }

    suspend fun saveCursorOffsetY(offsetY: Float) {
        settingsStore.saveCursorOffsetY(offsetY)
    }

    suspend fun saveIsMouseMode(isMouseMode: Boolean) {
        settingsStore.saveIsMouseMode(isMouseMode)
    }

    suspend fun saveLastTab(tab: String) {
        settingsStore.saveLastTab(tab)
    }

    /**
     * Pair against [target] (the host the user entered/tested). On success,
     * persists both the connection and the issued token. Returns null on
     * success, or a human-readable error string on failure.
     */
    suspend fun pair(target: ConnectionSettings, code: String, name: String): String? {
        val out = api.pair(target, code, name)
        return if (out.ok && out.token != null) {
            settingsStore.saveConnection(target)   // make sure the paired host is the saved host
            settingsStore.saveDeviceToken(out.token)
            null
        } else {
            out.detail
        }
    }

    fun isPaired(): Boolean = currentSettings.deviceToken.isNotBlank()
}
