package de.xyourp.antigravitymobile.net

import kotlinx.serialization.Serializable

// Responses from the Antigravity Mobile bridge (port 5000). All optional fields are
// nullable so error/partial payloads deserialize cleanly (Json ignores unknown keys).

@Serializable
data class StatusResponse(
    val status: String? = null,
    val authEnabled: Boolean = false,
    val uptime: Double = 0.0,
)

@Serializable
data class CdpStatusResponse(
    val available: Boolean = false,
    val error: String? = null,
)

// Directory picker (GET /api/dirs). `path`/`parent` are null at the drive-root level.
@Serializable
data class DirEntry(val name: String, val path: String)

@Serializable
data class DirListing(
    val path: String? = null,
    val parent: String? = null,
    val dirs: List<DirEntry> = emptyList(),
)

@Serializable
data class ChatSnapshot(
    val html: String? = null,
    val css: String? = null,
    val bodyBg: String? = null,
    val bodyColor: String? = null,
    val error: String? = null,
)

@Serializable
data class ModelsResponse(
    val models: List<String> = emptyList(),
    val currentModel: String? = null,
    val currentMode: String? = null,
    val error: String? = null,
)

@Serializable
data class SetModelResponse(
    val success: Boolean = false,
    val selected: String? = null,
    val error: String? = null,
)

@Serializable
data class ButtonInfo(
    val text: String? = null,
)

@Serializable
data class ApprovalsResponse(
    val pending: Boolean = false,
    val count: Int = 0,
    val approveButton: ButtonInfo? = null,
    val rejectButton: ButtonInfo? = null,
    val error: String? = null,
)

@Serializable
data class RespondResponse(
    val success: Boolean = false,
    val action: String? = null,
    val error: String? = null,
)

@Serializable
data class WorkspaceResponse(
    val workspace: String? = null,
    val targetWorkspace: String? = null,
    val projectName: String? = null,
)

@Serializable
data class FileItem(
    val name: String,
    val path: String,
    val isDirectory: Boolean = false,
    val size: Long? = null,
    val modified: String? = null,
    val extension: String? = null,
)

@Serializable
data class FileListResponse(
    val path: String? = null,
    val parent: String? = null,
    val items: List<FileItem> = emptyList(),
    val isRoot: Boolean = false,
    val workspaceRoot: String? = null,
    val error: String? = null,
)

@Serializable
data class FileContentResponse(
    val path: String? = null,
    val name: String? = null,
    val extension: String? = null,
    val size: Long? = null,
    val content: String? = null,
    val error: String? = null,
)

@Serializable
data class ScreenshotItem(
    val filename: String,
    val size: Long = 0,
    val timestamp: String? = null,
    val url: String? = null,
)

@Serializable
data class ScreenshotsResponse(
    val screenshots: List<ScreenshotItem> = emptyList(),
    val error: String? = null,
)

@Serializable
data class CommandResponse(
    val success: Boolean = false,
    val error: String? = null,
)

// --- CDP source (which Antigravity app the bridge mirrors) ---

@Serializable
data class CdpSource(
    val id: String,           // "app" (Antigravity 2.0) or "ide"
    val name: String = "",
    val port: Int = 0,
    val available: Boolean = false,
)

@Serializable
data class CdpSourcesResponse(
    val sources: List<CdpSource> = emptyList(),
    val preference: String = "auto",
    val activePort: Int? = null,
)

// --- Repositories ---

@Serializable
data class Repo(
    val path: String,
    val name: String = "",
    val exists: Boolean = true,
    val isRepo: Boolean = false,
)

@Serializable
data class ReposResponse(
    val repos: List<Repo> = emptyList(),
    val current: String? = null,
    val currentName: String? = null,
)

// --- Git ---

@Serializable
data class GitFile(
    val path: String,
    val x: String = ".",   // staged (index) status code
    val y: String = ".",   // worktree status code
    val type: String = "modified",
    val orig: String? = null,
)

@Serializable
data class GitStatus(
    val isRepo: Boolean = false,
    val root: String? = null,
    val branch: String? = null,
    val upstream: String? = null,
    val ahead: Int = 0,
    val behind: Int = 0,
    val remoteUrl: String? = null,
    val files: List<GitFile> = emptyList(),
    val error: String? = null,
)

@Serializable
data class GitDiff(
    val file: String? = null,
    val staged: Boolean = false,
    val diff: String? = null,
    val error: String? = null,
)

@Serializable
data class GitBranches(
    val current: String? = null,
    val branches: List<String> = emptyList(),
    val error: String? = null,
)

@Serializable
data class GitActionResponse(
    val success: Boolean = false,
    val output: String? = null,
    val error: String? = null,
)

// ---- Structured chat (GET /api/chat/structured) — native chat renderer ----

@Serializable
data class ActivityStep(val kind: String = "step", val text: String = "")

@Serializable
data class ActionButton(val label: String = "", val xpath: String = "", val kind: String = "")

@Serializable
data class ChangeSummary(val summary: String = "", val add: String? = null, val del: String? = null)

@Serializable
data class StructuredMessage(
    val role: String = "agent",            // "user" | "agent"
    val text: String = "",                 // whitelisted HTML for agent prose
    val working: Boolean = false,
    val worked: String = "",
    val activity: List<ActivityStep> = emptyList(),
    val changes: ChangeSummary? = null,
    val actions: List<ActionButton> = emptyList(),
)

@Serializable
data class PromptOption(val label: String = "", val xpath: String = "")

@Serializable
data class AskPrompt(
    val type: String = "choice",
    val question: String = "",
    val options: List<PromptOption> = emptyList(),
    val otherXpath: String? = null,
    val submitXpath: String? = null,
    val skipXpath: String? = null,
)

@Serializable
data class Artifact(
    val open: Boolean = false,
    val title: String = "",
    val html: String = "",
    val prevXpath: String? = null,
    val nextXpath: String? = null,
)

@Serializable
data class StructuredChat(
    val found: Boolean = false,
    val version: String = "",
    val model: String = "",
    val messages: List<StructuredMessage> = emptyList(),
    val prompt: AskPrompt? = null,
    val artifact: Artifact? = null,
    val error: String? = null,
)

@Serializable
data class Conversation(val id: String = "", val title: String = "", val active: Boolean = false)

@Serializable
data class ConversationsResponse(
    val found: Boolean = false,
    val conversations: List<Conversation> = emptyList(),
)

@Serializable
data class ActionResult(val success: Boolean = false, val error: String? = null)
