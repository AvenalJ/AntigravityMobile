package de.xyourp.antigravitymobile.ui.files

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.DriveFolderUpload
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.xyourp.antigravitymobile.net.FileItem
import de.xyourp.antigravitymobile.ui.components.EmptyState

@Composable
fun FilesScreen(
    state: FilesState,
    onOpenItem: (FileItem) -> Unit,
    onUp: () -> Unit,
    onCloseFile: () -> Unit,
    onStartSelection: (FileItem) -> Unit = {},
    onToggleSelect: (FileItem) -> Unit = {},
    onClearSelection: () -> Unit = {},
    onDownloadItem: (FileItem) -> Unit = {},
    onDownloadSelected: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    if (state.openFile != null || state.fileLoading || state.fileError != null) {
        FileViewer(state, onCloseFile, modifier)
        return
    }

    Column(modifier.fillMaxSize()) {
        // Header switches to a selection action bar while picking items to download.
        Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 1.dp) {
            if (state.selecting) {
                Row(
                    Modifier.fillMaxWidth().padding(start = 4.dp, end = 8.dp, top = 4.dp, bottom = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onClearSelection) { Icon(Icons.Filled.Close, "Cancel selection") }
                    Text(
                        "${state.selected.size} selected",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(onClick = onDownloadSelected, enabled = state.selected.isNotEmpty() && !state.downloading) {
                        Icon(Icons.Filled.Download, "Download selected", tint = MaterialTheme.colorScheme.primary)
                    }
                }
            } else {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.FolderOpen, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        state.path?.substringAfterLast('\\')?.substringAfterLast('/') ?: "Files",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
        if (state.downloading) {
            LinearProgressIndicator(Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.primary)
        }
        Divider(color = MaterialTheme.colorScheme.outlineVariant)

        Box(Modifier.weight(1f)) {
            when {
                state.loading && state.items.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                }
                state.error != null -> EmptyState(
                    icon = Icons.Filled.Folder,
                    title = "Couldn't load files",
                    subtitle = state.error,
                )
                state.items.isEmpty() && state.parent == null -> EmptyState(
                    icon = Icons.Filled.Folder,
                    title = "No files",
                    subtitle = "This workspace folder is empty.",
                )
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    if (state.parent != null && !state.isRoot) {
                        item {
                            Row(
                                Modifier.fillMaxWidth().clickable { onUp() }
                                    .padding(horizontal = 16.dp, vertical = 14.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(Icons.Filled.DriveFolderUpload, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                Spacer(Modifier.width(14.dp))
                                Text("..", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurface)
                            }
                            Divider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
                        }
                    }
                    items(state.items, key = { it.path }) { item ->
                        FileRow(
                            item = item,
                            selecting = state.selecting,
                            selected = item.path in state.selected,
                            onClick = { if (state.selecting) onToggleSelect(item) else onOpenItem(item) },
                            onLongClick = { onStartSelection(item) },
                            onDownload = { onDownloadItem(item) },
                        )
                        Divider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FileRow(
    item: FileItem,
    selecting: Boolean,
    selected: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    onDownload: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth()
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(start = 16.dp, end = 4.dp, top = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (selecting) {
            Checkbox(checked = selected, onCheckedChange = { onClick() })
            Spacer(Modifier.width(6.dp))
        } else {
            Icon(
                if (item.isDirectory) Icons.Filled.Folder else Icons.Filled.Description,
                null,
                tint = if (item.isDirectory) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(22.dp),
            )
            Spacer(Modifier.width(14.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(item.name, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (!item.isDirectory) {
                Text(
                    buildString {
                        append(humanSize(item.size ?: 0))
                        item.modified?.take(10)?.let { append(" · $it") }
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        // Quick per-row download (files and folders). Hidden in selection mode.
        if (!selecting) {
            IconButton(onClick = onDownload) {
                Icon(
                    Icons.Filled.Download,
                    contentDescription = "Download ${item.name}",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun FileViewer(state: FilesState, onClose: () -> Unit, modifier: Modifier) {
    val file = state.openFile
    Column(modifier.fillMaxSize()) {
        Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
            Row(
                Modifier.fillMaxWidth().padding(end = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onClose) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back to files")
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        file?.name ?: "File",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (file != null) {
                        Text(humanSize(file.size ?: 0), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        Divider(color = MaterialTheme.colorScheme.outlineVariant)

        Box(Modifier.weight(1f)) {
            when {
                state.fileLoading -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                }
                state.fileError != null -> EmptyState(
                    icon = Icons.Filled.Description,
                    title = "Can't display this file",
                    subtitle = state.fileError,
                )
                file?.content != null -> {
                    val palette = CodePalette(
                        base = MaterialTheme.colorScheme.onSurface,
                        keyword = MaterialTheme.colorScheme.primary,
                        string = MaterialTheme.colorScheme.secondary,
                        comment = MaterialTheme.colorScheme.onSurfaceVariant,
                        number = MaterialTheme.colorScheme.tertiary,
                    )
                    val highlighted = highlightCode(file.content, palette)
                    Column(
                        Modifier.fillMaxSize()
                            .background(MaterialTheme.colorScheme.background)
                            .verticalScroll(rememberScrollState())
                            .horizontalScroll(rememberScrollState())
                            .padding(12.dp),
                    ) {
                        Text(
                            text = highlighted,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
            }
        }
    }
}

private fun humanSize(bytes: Long): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "%.1f KB".format(bytes / 1024.0)
    else -> "%.1f MB".format(bytes / (1024.0 * 1024))
}
