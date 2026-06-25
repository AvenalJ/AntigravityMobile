package de.xyourp.antigravitymobile.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectDragGestures
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
import androidx.compose.material.icons.filled.DesktopWindows
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Mouse
import androidx.compose.material.icons.filled.TouchApp
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
import androidx.compose.ui.draw.drawWithContent
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.foundation.Image
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.res.painterResource
import de.xyourp.antigravitymobile.R

enum class InputMode { Touch, Mouse }

@Composable
fun ScreenScreen(
    currentFrame: android.graphics.Bitmap?,
    autoRefresh: Boolean,
    cursorSize: Int,
    cursorAlpha: Float,
    cursorTilt: Float,
    cursorOffsetY: Float,
    isMouseMode: Boolean,
    onSetMouseMode: (Boolean) -> Unit,
    onTap: (Float, Float) -> Unit,
    onMouse: (String, Float, Float, String, Float?, Float?) -> Unit,
    onScroll: (Float) -> Unit,           // deltaY (uses centre of screen)
    onSubmit: (String) -> Unit,
    onKey: (String) -> Unit,
    onToggleAuto: () -> Unit,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize().imePadding()) {
        val inputMode = if (isMouseMode) InputMode.Mouse else InputMode.Touch
        var virtualCursor by remember { mutableStateOf(Offset(0.5f, 0.5f)) }
        
        val cursorPainter = painterResource(id = R.drawable.cursor_logo)

        Box(
            Modifier.weight(1f).fillMaxWidth().clipToBounds().background(Color.Black),
            contentAlignment = Alignment.Center,
        ) {
            var containerSize by remember { mutableStateOf(IntSize.Zero) }
            var imgAspect by remember { mutableStateOf(1.6f) }
            var scale by remember { mutableStateOf(1f) }
            var offset by remember { mutableStateOf(Offset.Zero) }

            var everLoaded by remember { mutableStateOf(false) }
            if (currentFrame != null) {
                everLoaded = true
                val w = currentFrame.width.toFloat()
                val h = currentFrame.height.toFloat()
                if (h > 0) imgAspect = w / h
            }

            Box(
                Modifier.fillMaxSize()
                    .onSizeChanged { containerSize = it }
                    .pointerInput(containerSize, imgAspect, inputMode) {
                        detectTapGestures(
                            onTap = { tap ->
                                if (inputMode == InputMode.Mouse) {
                                    onMouse("mousePressed", virtualCursor.x, virtualCursor.y, "left", null, null)
                                    onMouse("mouseReleased", virtualCursor.x, virtualCursor.y, "left", null, null)
                                } else {
                                    normalize(tap, containerSize, imgAspect, scale, offset)?.let { onTap(it.x, it.y) }
                                }
                            },
                            onLongPress = { tap ->
                                if (inputMode == InputMode.Mouse) {
                                    onMouse("mousePressed", virtualCursor.x, virtualCursor.y, "right", null, null)
                                    onMouse("mouseReleased", virtualCursor.x, virtualCursor.y, "right", null, null)
                                }
                            }
                        )
                    }
                    .pointerInput(Unit) {
                        awaitPointerEventScope {
                            while (true) {
                                val event = awaitPointerEvent()
                                if (event.changes.size >= 3) {
                                    val dy = event.changes.map { (it.position.y - it.previousPosition.y).toDouble() }.average().toFloat()
                                    if (dy != 0f) onScroll(dy * 2f) // Positive drag down = scroll down page = wheel up
                                    event.changes.forEach { it.consume() }
                                }
                            }
                        }
                    }
                    .pointerInput(containerSize, imgAspect, inputMode) {
                        var lastDragPos: Offset? = null
                        if (inputMode == InputMode.Touch) {
                            detectDragGestures(
                                onDragStart = { start ->
                                    lastDragPos = start
                                    normalize(start, containerSize, imgAspect, scale, offset)?.let { 
                                        onMouse("mousePressed", it.x, it.y, "left", null, null) 
                                    }
                                },
                                onDragEnd = {
                                    lastDragPos?.let { pos ->
                                        normalize(pos, containerSize, imgAspect, scale, offset)?.let {
                                            onMouse("mouseReleased", it.x, it.y, "left", null, null)
                                        }
                                    }
                                },
                                onDragCancel = {
                                    lastDragPos?.let { pos ->
                                        normalize(pos, containerSize, imgAspect, scale, offset)?.let {
                                            onMouse("mouseReleased", it.x, it.y, "left", null, null)
                                        }
                                    }
                                },
                                onDrag = { change, dragAmount ->
                                    change.consume()
                                    lastDragPos = change.position
                                    normalize(change.position, containerSize, imgAspect, scale, offset)?.let {
                                        onMouse("mouseMoved", it.x, it.y, "left", null, null) 
                                    }
                                }
                            )
                        }
                    }
                    .pointerInput(containerSize, imgAspect, inputMode) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            if (inputMode == InputMode.Mouse && zoom == 1f) {
                                val cw = containerSize.width.toFloat()
                                val ch = containerSize.height.toFloat()
                                val fitW = if (cw / ch > imgAspect) ch * imgAspect else cw
                                val fitH = if (cw / ch > imgAspect) ch else cw / imgAspect
                                
                                val dx = pan.x / (fitW * scale)
                                val dy = pan.y / (fitH * scale)
                                
                                virtualCursor = Offset(
                                    virtualCursor.x + dx,
                                    virtualCursor.y + dy
                                )
                                
                                // Auto-panning logic: if zoomed in, adjust offset when approaching edges
                                if (scale > 1f) {
                                    val screenCursorX = (virtualCursor.x - 0.5f) * (fitW * scale) + (cw / 2f) + offset.x
                                    val screenCursorY = (virtualCursor.y - 0.5f) * (fitH * scale) + (ch / 2f) + offset.y
                                    
                                    val edgeMarginX = cw * 0.15f
                                    val edgeMarginY = ch * 0.15f
                                    val panAmountX = cw * 0.05f
                                    val panAmountY = ch * 0.05f
                                    
                                    var newOffsetX = offset.x
                                    var newOffsetY = offset.y
                                    
                                    if (screenCursorX < edgeMarginX) newOffsetX += panAmountX
                                    if (screenCursorX > cw - edgeMarginX) newOffsetX -= panAmountX
                                    if (screenCursorY < edgeMarginY) newOffsetY += panAmountY
                                    if (screenCursorY > ch - edgeMarginY) newOffsetY -= panAmountY
                                    
                                    val maxX = ((fitW * scale) - cw).coerceAtLeast(0f) / 2f
                                    val maxY = ((fitH * scale) - ch).coerceAtLeast(0f) / 2f
                                    offset = Offset(
                                        newOffsetX.coerceIn(-maxX, maxX),
                                        newOffsetY.coerceIn(-maxY, maxY)
                                    )
                                }
                                
                                // Provide absolute host position based on virtual cursor
                                onMouse("mouseMoved", virtualCursor.x, virtualCursor.y, "none", null, null)
                            } else {
                                scale = (scale * zoom).coerceIn(1f, 5f)
                                offset = if (scale <= 1.01f) Offset.Zero else offset + pan
                            }
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                if (currentFrame != null) {
                    Image(
                        bitmap = currentFrame.asImageBitmap(),
                        contentDescription = "Live screen",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxSize().graphicsLayer(
                            scaleX = scale, scaleY = scale,
                            translationX = offset.x, translationY = offset.y,
                        ).drawWithContent {
                            drawContent()
                            if (inputMode == InputMode.Mouse) {
                                val cw = size.width
                                val ch = size.height
                                val fitW = if (cw / ch > imgAspect) ch * imgAspect else cw
                                val fitH = if (cw / ch > imgAspect) ch else cw / imgAspect
                                val bx = (cw - fitW) / 2f
                                val by = (ch - fitH) / 2f
                                
                                val cx = bx + virtualCursor.x * fitW
                                val cy = by + virtualCursor.y * fitH
                                
                                val sizePx = cursorSize.dp.toPx()
                                val offsetYPx = cursorOffsetY.dp.toPx()
                                translate(left = cx - sizePx / 2f, top = cy - sizePx / 2f + offsetYPx) {
                                    rotate(cursorTilt, pivot = androidx.compose.ui.geometry.Offset(sizePx / 2f, sizePx / 2f)) {
                                        with(cursorPainter) {
                                            draw(size = androidx.compose.ui.geometry.Size(sizePx, sizePx), alpha = cursorAlpha)
                                        }
                                    }
                                }
                            }
                        },
                    )
                }

                if (!everLoaded || currentFrame == null) {
                    WaitingOverlay(everLoaded)
                }
            }
        }

        ControlBar(inputMode, { onSetMouseMode(it == InputMode.Mouse) }, autoRefresh, onScroll, onSubmit, onKey, onToggleAuto, onRefresh)
    }
}

@Composable
private fun ControlBar(
    inputMode: InputMode,
    onModeChange: (InputMode) -> Unit,
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
                IconButton(onClick = { onModeChange(if (inputMode == InputMode.Touch) InputMode.Mouse else InputMode.Touch) }) {
                    Icon(
                        if (inputMode == InputMode.Touch) Icons.Filled.TouchApp else Icons.Filled.Mouse,
                        "Toggle Input Mode"
                    )
                }
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

@Composable
private fun WaitingOverlay(everLoaded: Boolean) {
    Column(
        Modifier.fillMaxSize().padding(28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Filled.DesktopWindows, null, modifier = Modifier.size(48.dp), tint = Color(0xFF8A9A96))
        Spacer(Modifier.size(14.dp))
        Text(
            if (everLoaded) "Live screen paused" else "Waiting for the Antigravity window",
            color = Color(0xFFE6ECEA),
            style = MaterialTheme.typography.titleSmall,
        )
        Spacer(Modifier.size(6.dp))
        Text(
            "No frames are coming through. Make sure the Antigravity window is open and " +
                "not minimised on your laptop — a minimised window can't be captured.",
            color = Color(0xFF8A9A96),
            style = MaterialTheme.typography.bodySmall,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
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
