package de.xyourp.antigravitymobile.ui.screenshots

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Image
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import de.xyourp.antigravitymobile.net.ScreenshotItem
import de.xyourp.antigravitymobile.ui.components.EmptyState

@Composable
fun ScreenshotsScreen(
    state: ScreenshotsState,
    imageUrl: (ScreenshotItem) -> String,
    onSelect: (ScreenshotItem) -> Unit,
    onCloseViewer: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier.fillMaxSize()) {
        when {
            state.loading && state.items.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
            }
            state.items.isEmpty() -> EmptyState(
                icon = Icons.Filled.Image,
                title = "No screenshots yet",
                subtitle = state.error
                    ?: "Antigravity captures the IDE on a schedule. New screenshots will appear here.",
            )
            else -> LazyColumn(
                Modifier.fillMaxSize().padding(12.dp),
            ) {
                items(state.items, key = { it.filename }) { item ->
                    ScreenshotCard(item, imageUrl(item), onClick = { onSelect(item) })
                }
            }
        }
    }

    state.selected?.let { sel ->
        FullScreenViewer(imageUrl(sel), sel, onCloseViewer)
    }
}

@Composable
private fun ScreenshotCard(item: ScreenshotItem, url: String, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
        Text(
            item.timestamp?.replace('T', ' ') ?: item.filename,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp, bottom = 6.dp),
        )
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        ) {
            AsyncImage(
                model = url,
                contentDescription = item.filename,
                contentScale = ContentScale.FillWidth,
                modifier = Modifier.fillMaxWidth().aspectRatio(16f / 10f).clip(RoundedCornerShape(12.dp)),
            )
        }
    }
}

@Composable
private fun FullScreenViewer(url: String, item: ScreenshotItem, onClose: () -> Unit) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(
            Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.95f)).clickable(onClick = onClose),
            contentAlignment = Alignment.Center,
        ) {
            AsyncImage(
                model = url,
                contentDescription = item.filename,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize().padding(8.dp),
            )
            Text(
                item.timestamp?.replace('T', ' ') ?: item.filename,
                style = MaterialTheme.typography.labelSmall,
                color = Color.White.copy(alpha = 0.8f),
                modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp),
            )
        }
    }
}
