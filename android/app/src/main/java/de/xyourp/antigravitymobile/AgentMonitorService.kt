package de.xyourp.antigravitymobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import de.xyourp.antigravitymobile.data.AppRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Foreground service that keeps the bridge WebSocket alive while the app is
 * backgrounded and raises a local notification when the agent needs input,
 * finishes, or errors. The bridge already detects these transitions server-side
 * (chat-stream.mjs) and pushes them as `agent_event` frames — this service just
 * listens and notifies, so there is no extra CDP polling from the phone.
 */
class AgentMonitorService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannels(this)
        startForegroundMonitor()

        val repo: AppRepository = (application as AntigravityApp).repository
        repo.socket.events.onEach { msg ->
            if (msg.event == "agent_event") {
                val obj = msg.data?.jsonObject ?: return@onEach
                val kind = obj["kind"]?.jsonPrimitive?.content ?: return@onEach
                val message = obj["message"]?.jsonPrimitive?.content ?: ""
                notifyAgentEvent(kind, message)
            }
        }.launchIn(scope)

        startQuotaWatch(repo)
    }

    private fun startForegroundMonitor() {
        val tap = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val ongoing = NotificationCompat.Builder(this, CHANNEL_MONITOR)
            .setSmallIcon(R.drawable.ic_stat_agent)
            .setContentTitle("Antigravity")
            .setContentText("Watching the agent for updates")
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(tap)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(
                this, MONITOR_NOTIF_ID, ongoing,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(MONITOR_NOTIF_ID, ongoing)
        }
    }

    /** PendingIntent that opens the app, optionally deep-linking to a tab. */
    private fun openAppIntent(tab: String?, requestCode: Int): PendingIntent {
        val intent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (tab != null) intent.putExtra(MainActivity.EXTRA_OPEN_TAB, tab)
        return PendingIntent.getActivity(this, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun notifyAgentEvent(kind: String, message: String) {
        val (title, id) = when (kind) {
            "input_needed" -> "Antigravity needs your input" to ALERT_INPUT_ID
            "complete" -> "Agent finished" to ALERT_DONE_ID
            "error" -> "Antigravity hit an error" to ALERT_ERROR_ID
            else -> return
        }
        // input_needed/complete deep-link to the Chat tab; tapping any opens the app.
        val builder = NotificationCompat.Builder(this, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_agent)
            .setContentTitle(title)
            .setContentText(message.ifBlank { title })
            .setStyle(NotificationCompat.BigTextStyle().bigText(message.ifBlank { title }))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(if (kind == "input_needed") NotificationCompat.CATEGORY_CALL else NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(if (kind == "error") null else "Chat", id))

        if (kind == "input_needed") {
            // Approve / Reject the pending step straight from the notification.
            builder.addAction(0, "Approve", AgentActionReceiver.pendingIntent(this, AgentActionReceiver.ACTION_APPROVE))
            builder.addAction(0, "Reject", AgentActionReceiver.pendingIntent(this, AgentActionReceiver.ACTION_REJECT))
        }

        // POST_NOTIFICATIONS is requested by MainActivity; guard in case it's denied.
        runCatching { NotificationManagerCompat.from(this).notify(id, builder.build()) }
    }

    /** Poll model quota periodically and alert when a provider crosses below 10%. */
    private fun startQuotaWatch(repo: AppRepository) {
        scope.launch {
            val alerted = mutableSetOf<String>()
            while (true) {
                runCatching { repo.api.quota() }.getOrNull()?.let { q ->
                    if (q.available) {
                        q.models.forEach { m ->
                            val key = m.name
                            if (m.remainingPercent <= 10 && key !in alerted) {
                                alerted.add(key)
                                notifyLowQuota(m.name, m.remainingPercent)
                            } else if (m.remainingPercent > 15) {
                                alerted.remove(key) // recovered (with hysteresis) → can alert again
                            }
                        }
                    }
                }
                kotlinx.coroutines.delay(10 * 60 * 1000L) // every 10 minutes
            }
        }
    }

    private fun notifyLowQuota(modelName: String, remaining: Int) {
        val text = "$modelName is at $remaining% remaining"
        val n = NotificationCompat.Builder(this, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_agent)
            .setContentTitle("Low model quota")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(null, ALERT_QUOTA_ID + modelName.hashCode()))
            .build()
        runCatching { NotificationManagerCompat.from(this).notify(ALERT_QUOTA_ID + modelName.hashCode(), n) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL_MONITOR = "agent_monitor"
        private const val CHANNEL_ALERTS = "agent_alerts"
        private const val MONITOR_NOTIF_ID = 4100
        const val ALERT_INPUT_ID = 4101
        private const val ALERT_DONE_ID = 4102
        private const val ALERT_ERROR_ID = 4103
        private const val ALERT_QUOTA_ID = 4200

        fun start(context: Context) {
            val intent = Intent(context, AgentMonitorService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        /** Create the low-importance monitor channel and the high-importance alert channel. */
        fun ensureChannels(context: Context) {
            val mgr = NotificationManagerCompat.from(context)
            mgr.createNotificationChannel(
                NotificationChannelCompat.Builder(CHANNEL_MONITOR, NotificationManagerCompat.IMPORTANCE_MIN)
                    .setName("Agent monitor")
                    .setDescription("Keeps the connection alive to watch for agent updates")
                    .build()
            )
            mgr.createNotificationChannel(
                NotificationChannelCompat.Builder(CHANNEL_ALERTS, NotificationManagerCompat.IMPORTANCE_HIGH)
                    .setName("Agent alerts")
                    .setDescription("Notifies when the agent needs input, finishes, or errors")
                    .build()
            )
        }
    }
}
