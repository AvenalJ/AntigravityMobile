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

    /** Pair this device with the PC using the code shown in the bridge console. */
    suspend fun pair(code: String, name: String): Boolean {
        val token = api.pair(code, name) ?: return false
        settingsStore.saveDeviceToken(token)
        return true
    }

    fun isPaired(): Boolean = currentSettings.deviceToken.isNotBlank()
}
