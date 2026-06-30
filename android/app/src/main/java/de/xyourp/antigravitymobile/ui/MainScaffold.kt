package de.xyourp.antigravitymobile.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.CallSplit
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.first
import androidx.lifecycle.viewmodel.compose.viewModel
import de.xyourp.antigravitymobile.data.AppRepository
import de.xyourp.antigravitymobile.ui.chat.ChatScreen
import de.xyourp.antigravitymobile.ui.chat.ChatViewModel
import de.xyourp.antigravitymobile.ui.files.FilesScreen
import de.xyourp.antigravitymobile.ui.files.FilesViewModel
import de.xyourp.antigravitymobile.ui.git.BranchPickerSheet
import de.xyourp.antigravitymobile.ui.git.GitScreen
import de.xyourp.antigravitymobile.ui.git.GitViewModel
import de.xyourp.antigravitymobile.ui.screen.ScreenScreen
import de.xyourp.antigravitymobile.ui.screen.ScreenViewModel
import de.xyourp.antigravitymobile.ui.session.AgentStatus
import de.xyourp.antigravitymobile.ui.session.SessionViewModel
import de.xyourp.antigravitymobile.ui.usage.UsageSheet
import de.xyourp.antigravitymobile.ui.theme.AcceptGreen
import de.xyourp.antigravitymobile.ui.theme.RejectRed

private enum class Tab(val label: String) { Chat("Chat"), Files("Files"), Git("Git"), Screen("Screen") }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScaffold(repo: AppRepository, onOpenSettings: () -> Unit) {
    val sessionVm: SessionViewModel = viewModel(factory = appViewModelFactory { SessionViewModel(repo) })
    val chatVm: ChatViewModel = viewModel(factory = appViewModelFactory { ChatViewModel(repo) })
    val filesVm: FilesViewModel = viewModel(factory = appViewModelFactory { FilesViewModel(repo) })
    val gitVm: GitViewModel = viewModel(factory = appViewModelFactory { GitViewModel(repo) })
    val screenVm: ScreenViewModel = viewModel(factory = appViewModelFactory { ScreenViewModel(repo) })

    val session by sessionVm.state.collectAsStateWithLifecycle()
    val files by filesVm.state.collectAsStateWithLifecycle()
    val git by gitVm.state.collectAsStateWithLifecycle()
    val currentFrame by screenVm.currentFrame.collectAsStateWithLifecycle()
    val screenAuto by screenVm.autoRefresh.collectAsStateWithLifecycle()
    val cursorSize by screenVm.cursorSize.collectAsStateWithLifecycle()
    val cursorAlpha by screenVm.cursorAlpha.collectAsStateWithLifecycle()
    val cursorTilt by screenVm.cursorTilt.collectAsStateWithLifecycle()
    val cursorOffsetY by screenVm.cursorOffsetY.collectAsStateWithLifecycle()
    val isMouseMode by screenVm.isMouseMode.collectAsStateWithLifecycle()

    var tab by remember { mutableStateOf(Tab.Chat) }
    // Restore the last-opened tab once on launch (waits for the first real
    // DataStore emission, not the Compose-seeded default), then persist changes.
    var tabRestored by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        val saved = repo.lastTab.first()
        runCatching { saved?.let { Tab.valueOf(it) } }.getOrNull()?.let { tab = it }
        tabRestored = true
    }
    var showModelSheet by remember { mutableStateOf(false) }
    var showRepoSheet by remember { mutableStateOf(false) }
    var showBranchSheet by remember { mutableStateOf(false) }
    var showIdePicker by remember { mutableStateOf(false) }
    var showConvPicker by remember { mutableStateOf(false) }
    var showUsageSheet by remember { mutableStateOf(false) }

    LaunchedEffect(tab) {
        screenVm.setActive(tab == Tab.Screen)
        sessionVm.setScreenActive(tab == Tab.Screen)
        if (tabRestored) repo.saveLastTab(tab.name)
    }

    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(Unit) {
        screenVm.errors.collect { snackbarHostState.showSnackbar(it) }
    }
    LaunchedEffect(Unit) {
        filesVm.messages.collect { snackbarHostState.showSnackbar(it) }
    }
    LaunchedEffect(Unit) {
        sessionVm.messages.collect { snackbarHostState.showSnackbar(it) }
    }
    val filesContext = LocalContext.current

    // Deep links (e.g. tapping a notification) request a tab switch.
    LaunchedEffect(Unit) {
        de.xyourp.antigravitymobile.NavRequests.requestedTab.collect { name ->
            if (name != null) {
                runCatching { Tab.valueOf(name) }.getOrNull()?.let { tab = it }
                de.xyourp.antigravitymobile.NavRequests.requestedTab.value = null
            }
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            session.workspaceName ?: "Antigravity",
                            style = MaterialTheme.typography.titleMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        AgentStatusLabel(session.agentStatus)
                    }
                },
                actions = {
                    SourceToggle(
                        preference = session.sourcePreference,
                        appAvailable = session.sources.any { it.id == "app" && it.available },
                        ideAvailable = session.sources.any { it.id == "ide" && it.available },
                        onSelect = { sessionVm.setSource(it) },
                        // IDE not running → pick a folder to launch it in.
                        onOpenIdePicker = { showIdePicker = true },
                    )
                    IconButton(onClick = { showConvPicker = true }) {
                        Icon(Icons.Filled.Add, "New 2.0 conversation in a project")
                    }
                    IconButton(onClick = { sessionVm.loadQuota(); showUsageSheet = true }) {
                        Icon(Icons.Filled.BarChart, "Usage")
                    }
                    IconButton(onClick = onOpenSettings) { Icon(Icons.Filled.Settings, "Settings") }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(tab == Tab.Chat, { tab = Tab.Chat }, icon = { Icon(Icons.Outlined.ChatBubbleOutline, null) }, label = { Text(Tab.Chat.label) })
                NavigationBarItem(tab == Tab.Files, { tab = Tab.Files }, icon = { Icon(Icons.Filled.Folder, null) }, label = { Text(Tab.Files.label) })
                NavigationBarItem(tab == Tab.Git, { tab = Tab.Git }, icon = { Icon(Icons.Filled.CallSplit, null) }, label = { Text(Tab.Git.label) })
                NavigationBarItem(tab == Tab.Screen, { tab = Tab.Screen }, icon = { Icon(Icons.Filled.Cast, null) }, label = { Text(Tab.Screen.label) })
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (tab) {
                Tab.Chat -> ChatScreen(vm = chatVm)
                Tab.Files -> Column(Modifier.fillMaxSize()) {
                    RepoHeader(session.workspaceName) { showRepoSheet = true }
                    FilesScreen(
                        state = files,
                        onOpenItem = { filesVm.openItem(it) },
                        onUp = { filesVm.goUp() },
                        onCloseFile = { filesVm.closeFile() },
                        onStartSelection = { filesVm.startSelection(it) },
                        onToggleSelect = { filesVm.toggleSelected(it) },
                        onClearSelection = { filesVm.clearSelection() },
                        onDownloadItem = { filesVm.downloadItem(filesContext, it) },
                        onDownloadSelected = { filesVm.downloadSelected(filesContext) },
                        onUpload = { filesVm.upload(filesContext, it) },
                    )
                }
                Tab.Git -> Column(Modifier.fillMaxSize()) {
                    RepoHeader(session.workspaceName) { showRepoSheet = true }
                    GitScreen(
                        state = git,
                        onRefresh = { gitVm.refresh() },
                        onStage = { gitVm.stage(it.path) },
                        onUnstage = { gitVm.unstage(it.path) },
                        onDiscard = { gitVm.discard(it.path, it.type == "untracked") },
                        onStageAll = { gitVm.stageAll() },
                        onOpenDiff = { gitVm.openDiff(it) },
                        onCloseDiff = { gitVm.closeDiff() },
                        onCommitTextChange = { gitVm.setCommitText(it) },
                        onCommit = { gitVm.commit() },
                        onOpenBranches = { gitVm.loadBranches(); showBranchSheet = true },
                    )
                }
                Tab.Screen -> ScreenScreen(
                    currentFrame = currentFrame,
                    autoRefresh = screenAuto,
                    cursorSize = cursorSize,
                    cursorAlpha = cursorAlpha,
                    cursorTilt = cursorTilt,
                    cursorOffsetY = cursorOffsetY,
                    isMouseMode = isMouseMode,
                    onSetMouseMode = { screenVm.setMouseMode(it) },
                    onTap = { x, y -> screenVm.click(x, y) },
                    onMouse = { type, x, y, button, dx, dy -> screenVm.mouse(type, x, y, button, dx, dy) },
                    onScroll = { dy -> screenVm.scroll(0.5f, 0.5f, dy) },
                    onSubmit = { screenVm.submit(it) },
                    onKey = { key, ctrl, alt, shift, meta -> screenVm.key(key, ctrl, alt, shift, meta) },
                    onToggleAuto = { screenVm.toggleAuto() },
                    onRefresh = { screenVm.refreshNow() },
                )
            }
        }
    }

    if (showModelSheet) {
        ModelPickerSheet(
            models = session.models,
            current = session.currentModel,
            loading = session.modelsLoading,
            onSelect = { sessionVm.selectModel(it); showModelSheet = false },
            onDismiss = { showModelSheet = false },
        )
    }

    if (showRepoSheet) {
        RepoPickerSheet(
            repos = session.repos,
            currentPath = session.currentRepoPath,
            onSelect = { sessionVm.selectRepo(it); showRepoSheet = false },
            onAdd = { sessionVm.addAndSelectRepo(it); showRepoSheet = false },
            onRemove = { sessionVm.removeRepo(it) },
            onDismiss = { showRepoSheet = false },
        )
    }

    if (showBranchSheet) {
        BranchPickerSheet(
            branches = git.branches,
            current = git.status.branch,
            onCheckout = { gitVm.checkout(it, create = false); showBranchSheet = false },
            onCreate = { gitVm.checkout(it, create = true); showBranchSheet = false },
            onDismiss = { showBranchSheet = false },
        )
    }

    if (showIdePicker) {
        DirectoryPickerSheet(
            title = "Open project in IDE",
            subtitle = "Pick a folder to open in the Antigravity IDE (new window).",
            actionLabel = "Open in IDE",
            startPath = session.currentRepoPath,
            load = { repo.api.dirs(it) },
            onPick = { sessionVm.openIde(it); showIdePicker = false },
            onDismiss = { showIdePicker = false },
        )
    }

    if (showConvPicker) {
        DirectoryPickerSheet(
            title = "New 2.0 conversation",
            subtitle = "Pick a project folder. Antigravity 2.0 opens it in a new window for a fresh conversation.",
            actionLabel = "Start conversation",
            startPath = session.currentRepoPath,
            load = { repo.api.dirs(it) },
            onPick = { sessionVm.newConversation(it); showConvPicker = false },
            onDismiss = { showConvPicker = false },
        )
    }

    if (showUsageSheet) {
        UsageSheet(
            quota = session.quota,
            loading = session.quotaLoading,
            onDismiss = { showUsageSheet = false },
        )
    }
}

@Composable
private fun SourceToggle(
    preference: String,
    appAvailable: Boolean,
    ideAvailable: Boolean,
    onSelect: (String) -> Unit,
    onOpenIdePicker: () -> Unit,
) {
    // "auto" highlights the app (it's picked first). Tapping selects an explicit source.
    val selected = if (preference == "ide") "ide" else "app"
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = CircleShape) {
        Row {
            SourceSegment("2.0", selected == "app", appAvailable) { onSelect("app") }
            // IDE: select it if it's running, otherwise open the folder picker to launch it.
            SourceSegment("IDE", selected == "ide", available = true) {
                if (ideAvailable) onSelect("ide") else onOpenIdePicker()
            }
        }
    }
}

@Composable
private fun SourceSegment(label: String, selected: Boolean, available: Boolean, onClick: () -> Unit) {
    val bg = if (selected) MaterialTheme.colorScheme.primary else Color.Transparent
    val fg = when {
        selected -> MaterialTheme.colorScheme.onPrimary
        !available -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
        else -> MaterialTheme.colorScheme.onSurface
    }
    val base = Modifier.clip(CircleShape)
    Surface(
        color = bg,
        shape = CircleShape,
        modifier = if (available) base.clickable(onClick = onClick) else base,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = fg,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
        )
    }
}

@Composable
private fun RepoHeader(name: String?, onClick: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
        Column {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Folder, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                Spacer8()
                Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = CircleShape, onClick = onClick) {
                    Row(
                        Modifier.padding(start = 12.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            name ?: "Select repository",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.widthIn(max = 220.dp),
                        )
                        Icon(Icons.Filled.UnfoldMore, "Switch repository", modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

@Composable
private fun Spacer8() = androidx.compose.foundation.layout.Spacer(Modifier.width(8.dp))

@Composable
private fun AgentStatusLabel(status: AgentStatus) {
    val color = when (status) {
        AgentStatus.Running -> MaterialTheme.colorScheme.primary
        AgentStatus.Waiting -> AcceptGreen
        AgentStatus.Idle -> MaterialTheme.colorScheme.onSurfaceVariant
        AgentStatus.Offline -> RejectRed
    }
    Text(status.label, style = MaterialTheme.typography.labelSmall, color = color, maxLines = 1)
}

