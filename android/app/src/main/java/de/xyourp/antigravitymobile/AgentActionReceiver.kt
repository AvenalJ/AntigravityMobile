package de.xyourp.antigravitymobile

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Handles the Approve / Reject actions on the "needs your input" notification, so
 * the user can respond to an agent approval without opening the app.
 */
class AgentActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = when (intent.action) {
            ACTION_APPROVE -> "approve"
            ACTION_REJECT -> "reject"
            else -> return
        }
        val repo = (context.applicationContext as AntigravityApp).repository
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                runCatching { repo.api.respondApproval(action) }
                NotificationManagerCompat.from(context).cancel(AgentMonitor.ALERT_INPUT_ID)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION_APPROVE = "de.xyourp.antigravitymobile.APPROVE"
        const val ACTION_REJECT = "de.xyourp.antigravitymobile.REJECT"

        fun pendingIntent(context: Context, action: String): PendingIntent {
            val intent = Intent(context, AgentActionReceiver::class.java).setAction(action)
            return PendingIntent.getBroadcast(
                context, action.hashCode(), intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }
    }
}
