package de.xyourp.antigravitymobile.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardReturn
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Backspace
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.isSpecified
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.compose.AsyncImagePainter
import coil.request.CachePolicy
import coil.request.ImageRequest

@Composable
fun ScreenScreen(
    tick: Long,
    autoRefresh: Boolean,
    urlFor: (Long) -> String,
    onTap: (Float, Float) -> Unit,
    onScroll: (Float) -> Unit,           // deltaY (uses centre of screen)
    onSubmit: (String) -> Unit,
    onKey: (String) -> Unit,
    onToggleAuto: () -> Unit,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize().imePadding()) {
        Box(
            Modifier.weight(1f).fillMaxWidth().clipToBounds().background(Color.Black),
            contentAlignment = Alignment.Center,
        ) {
            var containerSize by remember { mutableStateOf(IntSize.Zero) }
            var imgAspect by remember { mutableStateOf(1.6f) }
            var scale by remember { mutableStateOf(1f) }
            var offset by remember { mutableStateOf(Offset.Zero) }

            val ctx = LocalContext.current
            val request = remember(tick) {
                ImageRequest.Builder(ctx)
                    .data(urlFor(tick))
                    .memoryCachePolicy(CachePolicy.DISABLED)
                    .diskCachePolicy(CachePolicy.DISABLED)
                    .crossfade(false)
                    .build()
            }

            Box(
                Modifier.fillMaxSize()
                    .onSizeChanged { containerSize = it }
                    .pointerInput(containerSize, imgAspect) {
                        detectTapGestures { tap ->
                            normalize(tap, containerSize, imgAspect, scale, offset)?.let { onTap(it.x, it.y) }
                        }
                    }
                    .pointerInput(Unit) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            scale = (scale * zoom).coerceIn(1f, 5f)
                            offset = if (scale <= 1.01f) Offset.Zero else offset + pan
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                AsyncImage(
                    model = request,
                    contentDescription = "Live screen",
                    contentScale = ContentScale.Fit,
                    onState = { st ->
                        if (st is AsyncImagePainter.State.Success) {
                            val s = st.painter.intrinsicSize
                            if (s.isSpecified && s.height > 0) imgAspect = s.width / s.height
                        }
                    },
                    modifier = Modifier.fillMaxSize().graphicsLayer(
                        scaleX = scale, scaleY = scale,
                        translationX = offset.x, translationY = offset.y,
                    ),
                )
            }
        }

        ControlBar(autoRefresh, onScroll, onSubmit, onKey, onToggleAuto, onRefresh)
    }
}

@Composable
private fun ControlBar(
    autoRefresh: Boolean,
    onScroll: (Float) -> Unit,
    onSubmit: (String) -> Unit,
    onKey: (String) -> Unit,
    onToggleAuto: () -> Unit,
    onRefresh: () -> Unit,
) {
    var text by remember { mutableStateOf("") }
    Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
        Column(Modifier.fillMaxWidth().padding(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Type into the focused field…") },
                    shape = RoundedCornerShape(16.dp),
                    maxLines = 4,
                )
                Spacer(Modifier.width(6.dp))
                IconButton(
                    onClick = { if (text.isNotBlank()) { onSubmit(text); text = "" } },
                    enabled = text.isNotBlank(),
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send, "Send + Enter", tint = MaterialTheme.colorScheme.primary)
                }
            }
            Row(
                Modifier.fillMaxWidth().padding(top = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onToggleAuto) {
                    Icon(
                        if (autoRefresh) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                        if (autoRefresh) "Pause live" else "Resume live",
                    )
                }
                IconButton(onClick = onRefresh) { Icon(Icons.Filled.Refresh, "Refresh") }
                IconButton(onClick = { onScroll(-400f) }) { Icon(Icons.Filled.KeyboardArrowUp, "Scroll up") }
                IconButton(onClick = { onScroll(400f) }) { Icon(Icons.Filled.KeyboardArrowDown, "Scroll down") }
                IconButton(onClick = { onKey("Enter") }) { Icon(Icons.AutoMirrored.Filled.KeyboardReturn, "Enter") }
                IconButton(onClick = { onKey("Backspace") }) { Icon(Icons.Filled.Backspace, "Backspace") }
                IconButton(onClick = { onKey("Escape") }) { Text("Esc", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}

/** Map a tap in container coords to image-normalised (0..1), undoing zoom/pan + Fit letterbox. */
private fun normalize(tap: Offset, cont: IntSize, aspect: Float, scale: Float, offset: Offset): Offset? {
    if (cont.width == 0 || cont.height == 0) return null
    val cw = cont.width.toFloat(); val ch = cont.height.toFloat()
    val cx = cw / 2; val cy = ch / 2
    // undo graphicsLayer (transformOrigin = center)
    val lx = cx + (tap.x - cx - offset.x) / scale
    val ly = cy + (tap.y - cy - offset.y) / scale
    // fitted (ContentScale.Fit) image rect within the container
    val contAspect = cw / ch
    val fitW: Float; val fitH: Float
    if (contAspect > aspect) { fitH = ch; fitW = ch * aspect } else { fitW = cw; fitH = cw / aspect }
    val bx = (cw - fitW) / 2; val by = (ch - fitH) / 2
    val nx = (lx - bx) / fitW; val ny = (ly - by) / fitH
    if (nx < 0f || nx > 1f || ny < 0f || ny > 1f) return null
    return Offset(nx, ny)
}
