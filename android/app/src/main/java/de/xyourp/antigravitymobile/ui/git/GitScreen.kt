package de.xyourp.antigravitymobile.ui.git

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CallSplit
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.xyourp.antigravitymobile.net.GitFile
import de.xyourp.antigravitymobile.ui.components.EmptyState
import de.xyourp.antigravitymobile.ui.theme.AcceptGreen
import de.xyourp.antigravitymobile.ui.theme.GitModifiedAmber
import de.xyourp.antigravitymobile.ui.theme.RejectRed

@Composable
fun GitScreen(
    state: GitState,
    onRefresh: () -> Unit,
    onStage: (GitFile) -> Unit,
    onUnstage: (GitFile) -> Unit,
    onDiscard: (GitFile) -> Unit,
    onStageAll: () -> Unit,
    onOpenDiff: (GitFile) -> Unit,
    onCloseDiff: () -> Unit,
    onCommitTextChange: (String) -> Unit,
    onCommit: () -> Unit,
    onOpenBranches: () -> Unit,
    modifier: Modifier = Modifier,
) {
    state.diff?.let { diff ->
        DiffViewer(diff, onCloseDiff, modifier)
        return
    }

    Column(modifier.fillMaxSize().imePadding()) {
        when {
            state.loading && !state.status.isRepo -> Box(Modifier.fillMaxSize().weight(1f), Alignment.Center) {
                CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
            }
            !state.status.isRepo -> EmptyState(
                icon = Icons.Filled.CallSplit,
                title = "Not a git repository",
                subtitle = state.error ?: "Pick a repo from the selector above (it must be a git work tree).",
                modifier = Modifier.weight(1f),
            )
            else -> {
                BranchBar(state, onOpenBranches, onRefresh)
                state.message?.let { MessageBanner(it) }

                val staged = state.status.files.filter { it.isStaged() }
                val unstaged = state.status.files.filter { it.isUnstaged() }
                val untracked = state.status.files.filter { it.isUntracked() }

                Box(Modifier.weight(1f)) {
                    if (staged.isEmpty() && unstaged.isEmpty() && untracked.isEmpty()) {
                        EmptyState(
                            icon = Icons.Filled.Check,
                            title = "Working tree clean",
                            subtitle = "No changes on ${state.status.branch ?: "this branch"}.",
                        )
                    } else {
                        LazyColumn(Modifier.fillMaxSize()) {
                            section("Staged (${staged.size})", staged, accent = AcceptGreen) { f ->
                                FileRow(f, onClick = { onOpenDiff(f) }) {
                                    ActionIcon(Icons.Filled.Remove, "Unstage") { onUnstage(f) }
                                }
                            }
                            if (unstaged.isNotEmpty() || untracked.isNotEmpty()) {
                                item {
                                    SectionHeader("Changes (${unstaged.size + untracked.size})") {
                                        TextButton(onClick = onStageAll) { Text("Stage all") }
                                    }
                                }
                                items2(unstaged) { f ->
                                    FileRow(f, onClick = { onOpenDiff(f) }) {
                                        ActionIcon(Icons.Filled.DeleteOutline, "Discard") { onDiscard(f) }
                                        ActionIcon(Icons.Filled.Add, "Stage") { onStage(f) }
                                    }
                                }
                                items2(untracked) { f ->
                                    FileRow(f, onClick = { onOpenDiff(f) }) {
                                        ActionIcon(Icons.Filled.DeleteOutline, "Delete") { onDiscard(f) }
                                        ActionIcon(Icons.Filled.Add, "Stage") { onStage(f) }
                                    }
                                }
                            }
                        }
                    }
                }

                CommitBar(
                    text = state.commitText,
                    canCommit = staged.isNotEmpty() && state.commitText.isNotBlank() && !state.busy,
                    busy = state.busy,
                    onTextChange = onCommitTextChange,
                    onCommit = onCommit,
                )
            }
        }
    }
}

@Composable
private fun BranchBar(state: GitState, onOpenBranches: () -> Unit, onRefresh: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 1.dp) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.CallSplit, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = CircleShape, onClick = onOpenBranches) {
                Text(
                    state.status.branch ?: "(detached)",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp),
                )
            }
            Spacer(Modifier.width(8.dp))
            val ab = buildString {
                if (state.status.ahead > 0) append("↑${state.status.ahead}")
                if (state.status.behind > 0) { if (isNotEmpty()) append(" "); append("↓${state.status.behind}") }
            }
            if (ab.isNotEmpty()) {
                Text(ab, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.weight(1f))
            if (state.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
private fun MessageBanner(msg: String) {
    Surface(color = MaterialTheme.colorScheme.surfaceVariant) {
        Text(
            msg,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        )
    }
}

@Composable
private fun SectionHeader(title: String, trailing: @Composable (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 14.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.weight(1f))
        trailing?.invoke()
    }
}

@Composable
private fun FileRow(file: GitFile, onClick: () -> Unit, actions: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatusBadge(file)
        Spacer(Modifier.width(10.dp))
        Text(
            file.path,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        actions()
    }
}

@Composable
private fun StatusBadge(file: GitFile) {
    val code = when {
        file.isUntracked() -> "U"
        file.isStaged() && file.x != "." -> file.x
        else -> file.y
    }
    val color = when (code) {
        "A" -> AcceptGreen
        "D" -> RejectRed
        "M" -> GitModifiedAmber
        "R" -> MaterialTheme.colorScheme.primary
        "U" -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Box(
        Modifier.size(22.dp).clip(RoundedCornerShape(5.dp)).background(color.copy(alpha = 0.18f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(code, style = MaterialTheme.typography.labelMedium, color = color)
    }
}

@Composable
private fun ActionIcon(icon: androidx.compose.ui.graphics.vector.ImageVector, desc: String, onClick: () -> Unit) {
    IconButton(onClick = onClick, modifier = Modifier.size(40.dp)) {
        Icon(icon, desc, modifier = Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun CommitBar(text: String, canCommit: Boolean, busy: Boolean, onTextChange: (String) -> Unit, onCommit: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
        Row(
            Modifier.fillMaxWidth().padding(10.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            OutlinedTextField(
                value = text,
                onValueChange = onTextChange,
                modifier = Modifier.weight(1f),
                placeholder = { Text("Commit message (staged changes)") },
                shape = RoundedCornerShape(14.dp),
                maxLines = 4,
            )
            Spacer(Modifier.width(8.dp))
            Button(onClick = onCommit, enabled = canCommit, modifier = Modifier.height(56.dp)) {
                if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                else Text("Commit")
            }
        }
    }
}

@Composable
private fun DiffViewer(diff: DiffView, onClose: () -> Unit, modifier: Modifier) {
    Column(modifier.fillMaxSize()) {
        Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                Column(Modifier.weight(1f)) {
                    Text(diff.file.substringAfterLast('/'), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(if (diff.staged) "staged diff" else "working tree diff", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        Box(Modifier.weight(1f)) {
            when {
                diff.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = MaterialTheme.colorScheme.primary) }
                diff.text.isNullOrBlank() -> EmptyState(
                    icon = Icons.Filled.CallSplit,
                    title = "No diff to show",
                    subtitle = diff.error ?: "This file has no textual diff (it may be new, binary, or unchanged).",
                )
                else -> Column(
                    Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)
                        .verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).padding(12.dp),
                ) {
                    Text(
                        text = colorizeDiff(
                            diff.text,
                            add = AcceptGreen,
                            del = RejectRed,
                            hunk = MaterialTheme.colorScheme.primary,
                            base = MaterialTheme.colorScheme.onSurfaceVariant,
                        ),
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BranchPickerSheet(
    branches: List<String>,
    current: String?,
    onCheckout: (String) -> Unit,
    onCreate: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var newBranch by remember { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp)) {
            Text("Branches", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
            Spacer(Modifier.height(8.dp))
            branches.forEach { b ->
                Row(
                    Modifier.fillMaxWidth().clickable { onCheckout(b) }.padding(vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (b == current) Icon(Icons.Filled.Check, "current", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                    else Spacer(Modifier.width(18.dp))
                    Spacer(Modifier.width(12.dp))
                    Text(b, style = MaterialTheme.typography.bodyLarge, color = if (b == current) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                }
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = newBranch,
                onValueChange = { newBranch = it },
                label = { Text("New branch") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                TextButton(onClick = { if (newBranch.isNotBlank()) { onCreate(newBranch.trim()); newBranch = "" } }, enabled = newBranch.isNotBlank()) {
                    Icon(Icons.Filled.Add, null, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Create & switch")
                }
            }
        }
    }
}

private fun colorizeDiff(text: String, add: Color, del: Color, hunk: Color, base: Color): AnnotatedString =
    buildAnnotatedString {
        text.lineSequence().forEach { line ->
            val color = when {
                line.startsWith("@@") -> hunk
                line.startsWith("+") && !line.startsWith("+++") -> add
                line.startsWith("-") && !line.startsWith("---") -> del
                else -> base
            }
            withStyle(SpanStyle(color = color)) { append(line) }
            append("\n")
        }
    }

// --- tiny LazyListScope helpers to keep the builder readable ---
private fun androidx.compose.foundation.lazy.LazyListScope.section(
    title: String,
    files: List<GitFile>,
    accent: Color,
    row: @Composable (GitFile) -> Unit,
) {
    if (files.isEmpty()) return
    item { SectionHeaderText(title) }
    items2(files, row)
}

private fun androidx.compose.foundation.lazy.LazyListScope.items2(
    files: List<GitFile>,
    row: @Composable (GitFile) -> Unit,
) {
    items(files.size, key = { "git_${files[it].path}_${files[it].type}" }) { row(files[it]) }
}

@Composable
private fun SectionHeaderText(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurface,
        modifier = Modifier.fillMaxWidth().padding(start = 16.dp, top = 14.dp, bottom = 4.dp),
    )
}
