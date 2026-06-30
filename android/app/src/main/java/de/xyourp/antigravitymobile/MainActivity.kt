package de.xyourp.antigravitymobile

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import de.xyourp.antigravitymobile.ui.AppRoot
import de.xyourp.antigravitymobile.ui.theme.AntigravityTheme
import kotlinx.coroutines.flow.MutableStateFlow

/** Cross-process nav requests (e.g. a notification asking to open a tab). */
object NavRequests {
    val requestedTab = MutableStateFlow<String?>(null)
}

class MainActivity : ComponentActivity() {

    private val requestNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* monitor starts regardless */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val repository = (application as AntigravityApp).repository
        handleDeepLink(intent)

        // Ask for notification permission (API 33+) so agent alerts can show, then
        // start the background monitor that listens for `agent_event` frames.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        AgentMonitorService.start(this)

        setContent {
            AntigravityTheme {
                AppRoot(repository)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLink(intent)
    }

    private fun handleDeepLink(intent: Intent?) {
        intent?.getStringExtra(EXTRA_OPEN_TAB)?.let { NavRequests.requestedTab.value = it }
    }

    companion object {
        const val EXTRA_OPEN_TAB = "open_tab"
    }
}
