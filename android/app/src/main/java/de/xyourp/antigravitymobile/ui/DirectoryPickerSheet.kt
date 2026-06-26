package de.xyourp.antigravitymobile.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import de.xyourp.antigravitymobile.net.DirListing

/**
 * Filesystem directory picker (dirs only). Browse from drive roots down, then
 * confirm a folder. Reused by the IDE launcher and the 2.0 new-conversation flow
 * — only [title]/[actionLabel]/[onPick] differ.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DirectoryPickerSheet(
    title: String,
    subtitle: String,
    actionLabel: String,
    startPath: String?,
    load: suspend (String?) -> DirListing,
    onPick: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var path by remember { mutableStateOf(startPath) }
    var listing by remember { mutableStateOf<DirListing?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(path) {
        loading = true; error = null
        runCatching { load(path) }
            .onSuccess { listing = it }
            .onFailure { error = it.message ?: "Couldn't read folder" }
        loading = false
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
            Spacer(Modifier.height(4.dp))
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(10.dp))

            // Current path + Up.
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                if (listing?.parent != null || listing?.path != null) {
                    TextButton(onClick = { path = listing?.parent }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Up", modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Up")
                    }
                }
                Text(
                    listing?.path ?: "This PC",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
                )
            }

            Spacer(Modifier.height(6.dp))
            Box(Modifier.fillMaxWidth().heightIn(min = 120.dp, max = 360.dp)) {
                when {
                    loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    error != null -> Text(
                        error!!,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.align(Alignment.Center),
                    )
                    else -> Column(Modifier.verticalScroll(rememberScrollState())) {
                        listing?.dirs?.forEach { d ->
                            Row(
                                Modifier.fillMaxWidth().clickable { path = d.path }.padding(vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(Icons.Filled.Folder, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                                Spacer(Modifier.width(12.dp))
                                Text(d.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                        if (listing?.dirs?.isEmpty() == true) {
                            Text(
                                "No subfolders here.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(vertical = 12.dp),
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Button(
                    onClick = { listing?.path?.let(onPick) },
                    enabled = listing?.path != null,
                ) { Text(actionLabel) }
            }
        }
    }
}
