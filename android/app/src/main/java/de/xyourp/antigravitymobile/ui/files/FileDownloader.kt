package de.xyourp.antigravitymobile.ui.files

import android.app.PendingIntent
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import de.xyourp.antigravitymobile.R
import de.xyourp.antigravitymobile.net.ApiClient
import de.xyourp.antigravitymobile.net.FileItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Result of a download attempt, surfaced to the UI for a snackbar/toast. */
data class DownloadResult(val ok: Boolean, val message: String)

/**
 * Streams files/folders from the remote PC to the phone's public Downloads
 * folder (MediaStore, API 29+). A single file is fetched as-is (any type);
 * folders or multi-selections are fetched as one ZIP built by the bridge.
 * Progress and completion are surfaced as notifications.
 */
object FileDownloader {

    private const val CHANNEL = "file_downloads"

    suspend fun download(context: Context, api: ApiClient, items: List<FileItem>): DownloadResult =
        withContext(Dispatchers.IO) {
            if (items.isEmpty()) return@withContext DownloadResult(false, "Nothing selected")
            ensureChannel(context)

            val asZip = items.size > 1 || items.any { it.isDirectory }
            val fileName = when {
                !asZip -> items.first().name
                items.size == 1 -> items.first().name + ".zip"
                else -> "antigravity-files-${items.size}.zip"
            }
            val mime = if (asZip) "application/zip" else mimeOf(fileName)
            val notifId = fileName.hashCode()

            notifyProgress(context, notifId, "Downloading $fileName…")
            try {
                val response = if (asZip) api.openZipDownload(items.map { it.path })
                else api.openFileDownload(items.first().path)

                response.use { resp ->
                    if (!resp.isSuccessful) {
                        val msg = "Download failed (HTTP ${resp.code})"
                        notifyDone(context, notifId, null, null, msg)
                        return@withContext DownloadResult(false, msg)
                    }
                    val uri = saveToDownloads(context, fileName, mime) { out ->
                        resp.body?.byteStream()?.use { it.copyTo(out) }
                            ?: throw IllegalStateException("Empty response")
                    }
                    notifyDone(context, notifId, uri, mime, "Saved $fileName to Downloads")
                    DownloadResult(true, "Saved $fileName to Downloads")
                }
            } catch (e: Exception) {
                val msg = "Download failed: ${e.message ?: "unknown error"}"
                notifyDone(context, notifId, null, null, msg)
                DownloadResult(false, msg)
            }
        }

    private fun saveToDownloads(
        context: Context,
        fileName: String,
        mime: String,
        write: (java.io.OutputStream) -> Unit,
    ): Uri {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
        val uri = resolver.insert(collection, values)
            ?: throw IllegalStateException("Couldn't create download entry")
        try {
            resolver.openOutputStream(uri)?.use { write(it) }
                ?: throw IllegalStateException("Couldn't open output stream")
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            return uri
        } catch (e: Exception) {
            runCatching { resolver.delete(uri, null, null) }
            throw e
        }
    }

    private fun mimeOf(fileName: String): String {
        val ext = fileName.substringAfterLast('.', "").lowercase()
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
            ?: "application/octet-stream"
    }

    private fun ensureChannel(context: Context) {
        NotificationManagerCompat.from(context).createNotificationChannel(
            NotificationChannelCompat.Builder(CHANNEL, NotificationManagerCompat.IMPORTANCE_LOW)
                .setName("File downloads")
                .setDescription("Files sent from the remote PC to this device")
                .build()
        )
    }

    private fun notifyProgress(context: Context, id: Int, text: String) {
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_agent)
            .setContentTitle("Antigravity")
            .setContentText(text)
            .setOngoing(true)
            .setProgress(0, 0, true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(id, n) }
    }

    private fun notifyDone(context: Context, id: Int, uri: Uri?, mime: String?, text: String) {
        val builder = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_agent)
            .setContentTitle("Antigravity")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setOngoing(false)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        if (uri != null) {
            val open = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mime ?: "*/*")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            builder.setContentIntent(
                PendingIntent.getActivity(
                    context, id, open,
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                )
            )
        }
        runCatching { NotificationManagerCompat.from(context).notify(id, builder.build()) }
    }
}
