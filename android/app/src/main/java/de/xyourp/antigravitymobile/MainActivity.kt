package de.xyourp.antigravitymobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import de.xyourp.antigravitymobile.ui.AppRoot
import de.xyourp.antigravitymobile.ui.theme.AntigravityTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val repository = (application as AntigravityApp).repository
        setContent {
            AntigravityTheme {
                AppRoot(repository)
            }
        }
    }
}
