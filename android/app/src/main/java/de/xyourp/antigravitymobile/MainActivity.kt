package de.xyourp.antigravitymobile

import android.Manifest
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

class MainActivity : ComponentActivity() {

    private val requestNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* monitor starts regardless */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val repository = (application as AntigravityApp).repository

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
}
