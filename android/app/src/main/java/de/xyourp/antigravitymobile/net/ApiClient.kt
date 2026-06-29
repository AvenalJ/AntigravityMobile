package de.xyourp.antigravitymobile.net

import de.xyourp.antigravitymobile.data.ConnectionSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Thin OkHttp REST client for the bridge. All calls run on [Dispatchers.IO] and
 * honour a 10-second timeout (per the project constraints). The base URL is read
 * fresh from [settingsProvider] on every call so Settings changes take effect
 * immediately without rebuilding the client.
 */
class ApiClient(private val settingsProvider: () -> ConnectionSettings) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .callTimeout(10, TimeUnit.SECONDS)
        .build()

    companion object {
        val json = Json {
            ignoreUnknownKeys = true
            isLenient = true
            coerceInputValues = true
            explicitNulls = false
        }
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }

    private fun settings() = settingsProvider()

    private suspend fun getRaw(path: String): String = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(settings().restUrl(path)).get().build()
        client.newCall(req).execute().use { resp ->
            val body = resp.body?.string().orEmpty()
            if (!resp.isSuccessful && body.isBlank()) {
                throw IOException("HTTP ${resp.code} for $path")
            }
            body
        }
    }

    private suspend fun postRaw(path: String, jsonBody: String): String = withContext(Dispatchers.IO) {
        val builder = Request.Builder()
            .url(settings().restUrl(path))
            .post(jsonBody.toRequestBody(JSON_MEDIA))
        val token = settings().deviceToken
        if (token.isNotBlank()) builder.header("x-device-token", token)
        val req = builder.build()
        client.newCall(req).execute().use { resp ->
            val body = resp.body?.string().orEmpty()
            // Surface any non-2xx as an error so callers (e.g. screen type/key) can
            // react instead of mistaking a 503 "helper not connected" for success.
            if (!resp.isSuccessful) {
                throw IOException("HTTP ${resp.code} for $path")
            }
            body
        }
    }

    suspend fun status(): StatusResponse =
        json.decodeFromString(getRaw("/api/status"))

    /** One-off connectivity check against an explicit [target] (used by "Test Connection"). */
    suspend fun ping(target: ConnectionSettings): StatusResponse = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(target.restUrl("/api/status")).get().build()
        client.newCall(req).execute().use { resp ->
            json.decodeFromString(resp.body?.string().orEmpty())
        }
    }

    suspend fun cdpStatus(): CdpStatusResponse =
        json.decodeFromString(getRaw("/api/cdp/status"))

    suspend fun workspace(): WorkspaceResponse =
        json.decodeFromString(getRaw("/api/workspace"))

    suspend fun chatSnapshot(): ChatSnapshot =
        json.decodeFromString(getRaw("/api/chat/snapshot"))

    /** Ask the bridge to begin polling the IDE chat and broadcasting `chat_update`. */
    suspend fun startChatStream() {
        runCatching { postRaw("/api/chat/start", "{}") }
    }

    suspend fun models(): ModelsResponse =
        json.decodeFromString(getRaw("/api/models"))

    suspend fun setModel(model: String): SetModelResponse =
        json.decodeFromString(postRaw("/api/models/set", bodyOf("model", model)))

    suspend fun approvals(): ApprovalsResponse =
        json.decodeFromString(getRaw("/api/approvals"))

    suspend fun respondApproval(action: String): RespondResponse =
        json.decodeFromString(postRaw("/api/approvals/respond", bodyOf("action", action)))

    suspend fun files(path: String?): FileListResponse {
        val suffix = if (path.isNullOrBlank()) "/api/files" else "/api/files?path=${encode(path)}"
        return json.decodeFromString(getRaw(suffix))
    }

    suspend fun fileContent(path: String): FileContentResponse =
        json.decodeFromString(getRaw("/api/files/content?path=${encode(path)}"))

    suspend fun screenshots(): ScreenshotsResponse =
        json.decodeFromString(getRaw("/api/screenshots"))

    suspend fun sendCommand(prompt: String): CommandResponse =
        json.decodeFromString(postRaw("/api/commands/execute", bodyOf("prompt", prompt)))

    // --- Source toggle + live screen control ---

    suspend fun cdpSources(): CdpSourcesResponse =
        json.decodeFromString(getRaw("/api/cdp/sources"))

    suspend fun setCdpTarget(target: String): CdpSourcesResponse =
        json.decodeFromString(postRaw("/api/cdp/target", bodyOf("target", target)))

    // --- Project pickers: browse directories + open a folder in the IDE / 2.0 app ---

    suspend fun dirs(path: String?): DirListing {
        val suffix = if (path.isNullOrBlank()) "/api/dirs" else "/api/dirs?path=${encode(path)}"
        return json.decodeFromString(getRaw(suffix))
    }

    suspend fun launchIde(path: String) {
        postRaw("/api/launch/ide", bodyOf("path", path))
    }

    suspend fun launchConversation(path: String) {
        postRaw("/api/launch/conversation", bodyOf("path", path))
    }

    /** Cache-busting URL for the live screen frame (load with Coil). */
    fun liveScreenUrl(ts: Long): String = settings().restUrl("/api/screen/live.jpg?ts=$ts")

    /** URL of the embeddable web chat page (structured chat + conversation picker). */
    fun webChatUrl(): String = settings().restUrl("/minimal.html")

    /**
     * One-time pairing against an explicit [target] (the host the user just
     * tested), so it never depends on whether the connection was saved first.
     */
    suspend fun pair(target: ConnectionSettings, code: String, name: String): PairOutcome = withContext(Dispatchers.IO) {
        val bodyJson = buildJsonObject { put("code", code); put("name", name) }.toString()
        val req = Request.Builder()
            .url(target.restUrl("/api/pair"))
            .post(bodyJson.toRequestBody(JSON_MEDIA))
            .build()
        try {
            client.newCall(req).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                val token = runCatching {
                    (json.parseToJsonElement(text) as? kotlinx.serialization.json.JsonObject)
                        ?.get("token")?.let { t -> (t as? kotlinx.serialization.json.JsonPrimitive)?.content }
                }.getOrNull()
                when {
                    resp.isSuccessful && !token.isNullOrBlank() -> PairOutcome(true, token, "ok")
                    resp.code == 401 -> PairOutcome(false, null, "Invalid code — re-check the PC console.")
                    else -> PairOutcome(false, null, "Server returned HTTP ${resp.code}")
                }
            }
        } catch (e: Exception) {
            PairOutcome(false, null, "Couldn't reach ${target.restBaseUrl}: ${e.message ?: "no response"}")
        }
    }

    suspend fun screenClick(x: Double, y: Double) {
        postRaw("/api/screen/click", buildJsonObject { put("x", x); put("y", y) }.toString())
    }

    suspend fun screenMouse(type: String, x: Double, y: Double, button: String, dx: Double? = null, dy: Double? = null) {
        val obj = buildJsonObject {
            put("type", type)
            put("x", x)
            put("y", y)
            put("button", button)
            if (dx != null) put("dx", dx)
            if (dy != null) put("dy", dy)
        }
        postRaw("/api/screen/mouse", obj.toString())
    }

    suspend fun screenScroll(x: Double, y: Double, deltaY: Double) {
        postRaw("/api/screen/scroll", buildJsonObject { put("x", x); put("y", y); put("deltaY", deltaY) }.toString())
    }

    suspend fun screenType(text: String) {
        postRaw("/api/screen/type", bodyOf("text", text))
    }

    suspend fun screenKey(
        key: String,
        ctrl: Boolean = false,
        alt: Boolean = false,
        shift: Boolean = false,
        meta: Boolean = false,
    ) {
        postRaw("/api/screen/key", buildJsonObject {
            put("key", key)
            if (ctrl) put("ctrl", true)
            if (alt) put("alt", true)
            if (shift) put("shift", true)
            if (meta) put("meta", true)
        }.toString())
    }

    // --- Repositories ---

    suspend fun repos(): ReposResponse =
        json.decodeFromString(getRaw("/api/repos"))

    suspend fun addRepo(path: String): String =
        postRaw("/api/repos", bodyOf("path", path))

    suspend fun selectRepo(path: String): String =
        postRaw("/api/repos/select", bodyOf("path", path))

    suspend fun removeRepo(path: String): String = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url(settings().restUrl("/api/repos"))
            .delete(bodyOf("path", path).toRequestBody(JSON_MEDIA))
            .build()
        client.newCall(req).execute().use { it.body?.string().orEmpty() }
    }

    // --- Git ---

    suspend fun gitStatus(): GitStatus =
        json.decodeFromString(getRaw("/api/git/status"))

    suspend fun gitDiff(file: String, staged: Boolean): GitDiff =
        json.decodeFromString(getRaw("/api/git/diff?file=${encode(file)}&staged=${if (staged) 1 else 0}"))

    suspend fun gitBranches(): GitBranches =
        json.decodeFromString(getRaw("/api/git/branches"))

    suspend fun gitStage(file: String): GitActionResponse =
        json.decodeFromString(postRaw("/api/git/stage", bodyOf("file", file)))

    suspend fun gitUnstage(file: String): GitActionResponse =
        json.decodeFromString(postRaw("/api/git/unstage", bodyOf("file", file)))

    suspend fun gitDiscard(file: String, untracked: Boolean): GitActionResponse =
        json.decodeFromString(postRaw("/api/git/discard", buildJsonObject {
            put("file", file); put("untracked", untracked)
        }.toString()))

    suspend fun gitCommit(message: String): GitActionResponse =
        json.decodeFromString(postRaw("/api/git/commit", bodyOf("message", message)))

    suspend fun gitCheckout(branch: String, create: Boolean): GitActionResponse =
        json.decodeFromString(postRaw("/api/git/checkout", buildJsonObject {
            put("branch", branch); put("create", create)
        }.toString()))

    /** Result of a pairing attempt — [detail] is a human-readable reason on failure. */
    data class PairOutcome(val ok: Boolean, val token: String?, val detail: String)

    private fun bodyOf(key: String, value: String): String =
        buildJsonObject { put(key, value) }.toString()

    private fun encode(s: String): String =
        java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20")
}
