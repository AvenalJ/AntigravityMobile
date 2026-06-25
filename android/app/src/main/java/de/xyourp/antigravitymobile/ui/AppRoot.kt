package de.xyourp.antigravitymobile.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import de.xyourp.antigravitymobile.data.AppRepository
import de.xyourp.antigravitymobile.data.ConnectionSettings
import de.xyourp.antigravitymobile.ui.components.FullLoading
import de.xyourp.antigravitymobile.ui.settings.SettingsScreen
import de.xyourp.antigravitymobile.ui.settings.SettingsViewModel

/**
 * Top-level navigation gate: loading → settings overlay → not-connected → main app.
 * Settings is always reachable (even when offline) so the IP can be configured.
 */
@Composable
fun AppRoot(repo: AppRepository) {
    val settings by repo.settings.collectAsStateWithLifecycle<ConnectionSettings?>(initialValue = null)
    val connected by repo.socket.connected.collectAsStateWithLifecycle()
    var showSettings by rememberSaveable { mutableStateOf(false) }

    val settingsVm: SettingsViewModel = viewModel(factory = appViewModelFactory { SettingsViewModel(repo) })

    val current = settings
    when {
        current == null -> FullLoading()

        showSettings -> SettingsScreen(vm = settingsVm, onClose = { showSettings = false })

        !current.isConfigured -> NotConnectedScreen(
            configured = false,
            address = null,
            connecting = false,
            onRetry = {},
            onOpenSettings = { showSettings = true },
        )

        !connected -> NotConnectedScreen(
            configured = true,
            address = "${current.host}:${current.wsPort}",
            connecting = true,
            onRetry = { repo.socket.reconnectNow() },
            onOpenSettings = { showSettings = true },
        )

        else -> MainScaffold(repo, onOpenSettings = { showSettings = true })
    }
}
