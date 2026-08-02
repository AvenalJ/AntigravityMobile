package de.xyourp.antigravitymobile

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.NotificationCompat
import de.xyourp.antigravitymobile.data.AppRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Process-lifetime monitor that raises a local notification only when the agent
 * needs input, finishes, errors, or a model quota runs low. The bridge detects
 * these transitions server-side (chat-stream.mjs) and pushes them as
 * `agent_event` frames; we just listen and notify — no persistent/foreground
 * "watching" notification.
 */
object AgentMonitor {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    @Volatile private var started = false

    fun start(context: Context) {
        if (started) return
        started = true
        val app = context.applicationContext
        ensureChannel(app)
        val repo = (app as AntigravityApp).repository

        repo.socket.events.onEach { msg ->
            if (msg.event == "agent_event") {
                val obj = msg.data?.jsonObject ?: return@onEach
                val kind = obj["kind"]?.jsonPrimitive?.content ?: return@onEach
                val message = obj["message"]?.jsonPrimitive?.content ?: ""
                notifyAgentEvent(app, kind, message)
            }
        }.launchIn(scope)

        startQuotaWatch(app, repo)
    }

    /** PendingIntent that opens the app, optionally deep-linking to a tab. */
    private fun openAppIntent(ctx: Context, tab: String?, requestCode: Int): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (tab != null) intent.putExtra(MainActivity.EXTRA_OPEN_TAB, tab)
        return PendingIntent.getActivity(ctx, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun notifyAgentEvent(ctx: Context, kind: String, message: String) {
        val (title, id) = when (kind) {
            "input_needed" -> "Antigravity needs your input" to ALERT_INPUT_ID
            "complete" -> "Agent finished" to ALERT_DONE_ID
            "error" -> "Antigravity hit an error" to ALERT_ERROR_ID
            else -> return
        }
        val builder = NotificationCompat.Builder(ctx, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_agent)
            .setContentTitle(title)
            .setContentText(message.ifBlank { title })
            .setStyle(NotificationCompat.BigTextStyle().bigText(message.ifBlank { title }))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(if (kind == "input_needed") NotificationCompat.CATEGORY_CALL else NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(ctx, if (kind == "error") null else "Chat", id))

        if (kind == "input_needed") {
            builder.addAction(0, "Approve", AgentActionReceiver.pendingIntent(ctx, AgentActionReceiver.ACTION_APPROVE))
            builder.addAction(0, "Reject", AgentActionReceiver.pendingIntent(ctx, AgentActionReceiver.ACTION_REJECT))
        }
        runCatching { NotificationManagerCompat.from(ctx).notify(id, builder.build()) }
    }

    /** Poll model quota periodically and alert when a provider crosses below 10%. */
    private fun startQuotaWatch(ctx: Context, repo: AppRepository) {
        scope.launch {
            val alerted = mutableSetOf<String>()
            while (true) {
                runCatching { repo.api.quota() }.getOrNull()?.let { q ->
                    if (q.available) {
                        q.models.forEach { m ->
                            val key = m.name
                            if (m.remainingPercent <= 10 && key !in alerted) {
                                alerted.add(key)
                                notifyLowQuota(ctx, m.name, m.remainingPercent)
                            } else if (m.remainingPercent > 15) {
                                alerted.remove(key) // recovered (hysteresis) → can alert again
                            }
                        }
                    }
                }
                delay(10 * 60 * 1000L) // every 10 minutes
            }
        }
    }

    private fun notifyLowQuota(ctx: Context, modelName: String, remaining: Int) {
        val text = "$modelName is at $remaining% remaining"
        val n = NotificationCompat.Builder(ctx, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_agent)
            .setContentTitle("Low model quota")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(ctx, null, ALERT_QUOTA_ID + modelName.hashCode()))
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(ALERT_QUOTA_ID + modelName.hashCode(), n) }
    }

    private fun ensureChannel(ctx: Context) {
        NotificationManagerCompat.from(ctx).createNotificationChannel(
            NotificationChannelCompat.Builder(CHANNEL_ALERTS, NotificationManagerCompat.IMPORTANCE_HIGH)
                .setName("Agent alerts")
                .setDescription("Notifies when the agent needs input, finishes, or errors")
                .build()
        )
    }

    private const val CHANNEL_ALERTS = "agent_alerts"
    const val ALERT_INPUT_ID = 4101
    private const val ALERT_DONE_ID = 4102
    private const val ALERT_ERROR_ID = 4103
    private const val ALERT_QUOTA_ID = 4200
}
