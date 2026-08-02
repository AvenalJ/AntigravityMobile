package de.xyourp.antigravitymobile

import android.app.Application
import de.xyourp.antigravitymobile.data.AppRepository
import de.xyourp.antigravitymobile.data.SettingsStore

/** Holds process-wide singletons (settings + repository). */
class AntigravityApp : Application() {
    lateinit var repository: AppRepository
        private set

    override fun onCreate() {
        super.onCreate()
        repository = AppRepository(SettingsStore(this))
        // Watch for agent events / low quota and post alert notifications.
        // No foreground service, so there's no persistent "watching" notification.
        AgentMonitor.start(this)
    }
}
