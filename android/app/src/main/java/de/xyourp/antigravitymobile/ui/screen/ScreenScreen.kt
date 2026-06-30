package de.xyourp.antigravitymobile.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.gestures.awaitFirstDown
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.withFrameNanos
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
import androidx.compose.ui.input.pointer.AwaitPointerEventScope
import androidx.compose.ui.input.pointer.PointerId
import androidx.compose.ui.input.pointer.PointerInputChange
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
import kotlinx.coroutines.withTimeoutOrNull
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
    onKey: (key: String, ctrl: Boolean, alt: Boolean, shift: Boolean, meta: Boolean) -> Unit,
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
            // Number of fingers currently down — used to stop the canvas from
            // panning during a 3-finger scroll.
            var activePointers by remember { mutableStateOf(0) }

            // Continuous, frame-driven edge-pan (RustDesk-style): while the virtual
            // cursor sits inside an edge margin and we're zoomed in, glide the
            // viewport every frame at a velocity that grows with how deep the
            // cursor pushes into the margin. Replaces the old per-event chunked
            // hops, which stepped instead of gliding.
            LaunchedEffect(inputMode) {
                if (inputMode != InputMode.Mouse) return@LaunchedEffect
                var last = 0L
                while (true) {
                    withFrameNanos { now ->
                        val dt = if (last == 0L) 0f else (now - last) / 1_000_000_000f
                        last = now
                        val cw = containerSize.width.toFloat()
                        val ch = containerSize.height.toFloat()
                        if (dt > 0f && scale > 1.01f && cw > 0f && ch > 0f) {
                            val fitW = if (cw / ch > imgAspect) ch * imgAspect else cw
                            val fitH = if (cw / ch > imgAspect) ch else cw / imgAspect
                            val curX = (virtualCursor.x - 0.5f) * (fitW * scale) + cw / 2f + offset.x
                            val curY = (virtualCursor.y - 0.5f) * (fitH * scale) + ch / 2f + offset.y
                            val marginX = cw * 0.18f
                            val marginY = ch * 0.18f
                            val maxSpeed = (cw.coerceAtLeast(ch)) * 1.6f // px/sec at full depth

                            // depth ratio 0..1, squared so it accelerates the deeper you push.
                            fun ratio(d: Float, m: Float) = (d / m).coerceIn(0f, 1f).let { it * it }
                            var vx = 0f
                            var vy = 0f
                            if (curX < marginX) vx = ratio(marginX - curX, marginX) * maxSpeed
                            else if (curX > cw - marginX) vx = -ratio(curX - (cw - marginX), marginX) * maxSpeed
                            if (curY < marginY) vy = ratio(marginY - curY, marginY) * maxSpeed
                            else if (curY > ch - marginY) vy = -ratio(curY - (ch - marginY), marginY) * maxSpeed

                            if (vx != 0f || vy != 0f) {
                                val maxX = ((fitW * scale) - cw).coerceAtLeast(0f) / 2f
                                val maxY = ((fitH * scale) - ch).coerceAtLeast(0f) / 2f
                                offset = Offset(
                                    (offset.x + vx * dt).coerceIn(-maxX, maxX),
                                    (offset.y + vy * dt).coerceIn(-maxY, maxY),
                                )
                            }
                        }
                    }
                }
            }

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
                        // Mouse mode only: virtual-cursor click and right-click.
                        // Touch mode tap/hold/drag are handled by the unified handler below.
                        if (inputMode != InputMode.Mouse) return@pointerInput
                        detectTapGestures(
                            onTap = {
                                onMouse("mousePressed", virtualCursor.x, virtualCursor.y, "left", null, null)
                                onMouse("mouseReleased", virtualCursor.x, virtualCursor.y, "left", null, null)
                            },
                            onLongPress = {
                                onMouse("mousePressed", virtualCursor.x, virtualCursor.y, "right", null, null)
                                onMouse("mouseReleased", virtualCursor.x, virtualCursor.y, "right", null, null)
                            }
                        )
                    }
                    .pointerInput(Unit) {
                        // Three-finger scroll (RustDesk Android: Three-Finger vertical drag →
                        // wheel). Accumulate raw pixel deltas and fire once we've built up
                        // ~40 px — matching the Rust-side divisor (dy/40 = lines) so each
                        // onScroll delivers ≥1 meaningful line rather than firing on every
                        // tiny finger movement.
                        var scrollAccum = 0f
                        awaitPointerEventScope {
                            while (true) {
                                val event = awaitPointerEvent()
                                // Track finger count first so the canvas-transform handler
                                // (declared after this one) can ignore 3-finger gestures.
                                activePointers = event.changes.count { it.pressed }
                                if (event.changes.size >= 3) {
                                    val dy = event.changes.map { (it.position.y - it.previousPosition.y).toDouble() }.average().toFloat()
                                    scrollAccum += dy
                                    if (kotlin.math.abs(scrollAccum) >= 40f) {
                                        // Inverted: swipe down scrolls content up (natural).
                                        onScroll(-scrollAccum)
                                        scrollAccum = 0f
                                    }
                                    event.changes.forEach { it.consume() }
                                } else {
                                    // Fingers lifted — discard any sub-threshold remainder.
                                    scrollAccum = 0f
                                }
                            }
                        }
                    }
                    .pointerInput(containerSize, imgAspect, inputMode) {
                        if (inputMode != InputMode.Touch) return@pointerInput
                        // Single-finger touch, faithful to RustDesk's Android gesture model.
                        // The key point the previous version got wrong: a plain one-finger move
                        // must NOT hold the left button. The button is held ONLY by a
                        // double-tap-then-drag. So a single tap (or a stray finger slide) can
                        // never leave the remote stuck in mousePressed.
                        //
                        //   • Tap                    → left click
                        //   • Double-tap             → double click
                        //   • Double-tap, then drag  → HOLD left button + drag (RustDesk "hold")
                        //   • Drag (one tap + move)  → move the remote cursor only, no button
                        //   • Long-press             → right click
                        val slop = viewConfiguration.touchSlop
                        val longPressMs = viewConfiguration.longPressTimeoutMillis
                        val doubleTapMs = viewConfiguration.doubleTapTimeoutMillis

                        fun send(action: String, p: Offset, button: String) {
                            normalize(p, containerSize, imgAspect, scale, offset)?.let {
                                onMouse(action, it.x, it.y, button, null, null)
                            }
                        }
                        fun click(p: Offset) {
                            normalize(p, containerSize, imgAspect, scale, offset)?.let { onTap(it.x, it.y) }
                        }
                        // Drag the given pointer, sending mouseMoved with [button] until lift.
                        // Returns the last position seen.
                        suspend fun AwaitPointerEventScope.dragUntilUp(id: PointerId, from: Offset, button: String): Offset {
                            var pos = from
                            send("mouseMoved", pos, button)
                            while (true) {
                                val e = awaitPointerEvent()
                                val c = e.changes.firstOrNull { it.id == id } ?: break
                                pos = c.position
                                if (!c.pressed) break
                                send("mouseMoved", pos, button)
                                c.consume()
                            }
                            return pos
                        }

                        awaitPointerEventScope {
                            while (true) {
                                val down = awaitFirstDown(requireUnconsumed = false)
                                val id = down.id
                                val startPos = down.position
                                var pos = startPos
                                var moved = false
                                var multi = false
                                var rightClicked = false
                                var startTime = down.uptimeMillis
                                var curTime = startTime

                                // ── Phase 1: classify the first press ──────────────
                                while (true) {
                                    val remaining = longPressMs - (curTime - startTime)
                                    val e = if (!moved && !rightClicked && remaining > 0)
                                        withTimeoutOrNull(remaining) { awaitPointerEvent() }
                                    else awaitPointerEvent()

                                    if (e == null) {
                                        // Long-press timeout, still down & still → right click.
                                        send("mousePressed", startPos, "right")
                                        send("mouseReleased", startPos, "right")
                                        rightClicked = true
                                        continue
                                    }
                                    if (e.changes.count { it.pressed } > 1) { multi = true; break }
                                    val c = e.changes.firstOrNull { it.id == id } ?: break
                                    curTime = c.uptimeMillis
                                    pos = c.position
                                    if (!c.pressed) break
                                    if (!moved && (c.position - startPos).getDistance() > slop) moved = true
                                    if (moved) break
                                }

                                // Multi-finger → let the pan/scroll handlers take over.
                                if (multi) continue
                                if (rightClicked) continue

                                if (moved) {
                                    // PLAIN DRAG → move the cursor only, no button held.
                                    dragUntilUp(id, pos, "none")
                                    continue
                                }

                                // Lifted before slop & before long-press → a TAP. Wait briefly
                                // for a second press (double-tap or double-tap-drag).
                                val second = withTimeoutOrNull(doubleTapMs) {
                                    var d: PointerInputChange? = null
                                    while (d == null) {
                                        val e = awaitPointerEvent()
                                        d = e.changes.firstOrNull { it.pressed && !it.previousPressed }
                                    }
                                    d
                                }

                                if (second == null) {
                                    // SINGLE TAP → left click.
                                    click(startPos)
                                    continue
                                }

                                // Second press began: quick lift → double click; move → hold-drag.
                                val id2 = second.id
                                val start2 = second.position
                                var pos2 = start2
                                var moved2 = false
                                while (true) {
                                    val e = awaitPointerEvent()
                                    val c = e.changes.firstOrNull { it.id == id2 } ?: break
                                    pos2 = c.position
                                    if (!c.pressed) break
                                    if ((c.position - start2).getDistance() > slop) { moved2 = true; break }
                                }

                                if (moved2) {
                                    // DOUBLE-TAP-DRAG → hold left button while dragging.
                                    send("mousePressed", start2, "left")
                                    val end = dragUntilUp(id2, pos2, "left")
                                    send("mouseReleased", end, "left")
                                } else {
                                    // DOUBLE TAP → double click.
                                    click(startPos)
                                    click(startPos)
                                }
                            }
                        }
                    }
                    .pointerInput(containerSize, imgAspect, inputMode) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            // 3+ fingers = scroll gesture; never pan/zoom the canvas then.
                            if (activePointers >= 3) return@detectTransformGestures
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

                                // Edge-panning is handled by a continuous frame-driven loop
                                // (see LaunchedEffect below) for smooth gliding, instead of
                                // discrete per-event hops.

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
                                // Cursor hotspot = the logo apex (where green meets red) within
                                // the 250x250 art: (125.4, 10.4) -> normalised (0.50, 0.042). Pin
                                // that point to the click position and rotate about it, so the tip
                                // stays exactly on target regardless of size or tilt.
                                val hotspotX = 0.502f
                                val hotspotY = 0.042f
                                val pivot = androidx.compose.ui.geometry.Offset(hotspotX * sizePx, hotspotY * sizePx)
                                translate(left = cx - hotspotX * sizePx, top = cy - hotspotY * sizePx + offsetYPx) {
                                    rotate(cursorTilt, pivot = pivot) {
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
    onKey: (key: String, ctrl: Boolean, alt: Boolean, shift: Boolean, meta: Boolean) -> Unit,
    onToggleAuto: () -> Unit,
    onRefresh: () -> Unit,
) {
    var text by remember { mutableStateOf("") }

    // Sticky modifiers (RustDesk-style): tap to arm, stays armed until tapped off,
    // and applies to every key fired — including Tab/Esc/arrows and typed letters.
    var ctrl by remember { mutableStateOf(false) }
    var alt by remember { mutableStateOf(false) }
    var shift by remember { mutableStateOf(false) }
    var meta by remember { mutableStateOf(false) }
    val anyMod = ctrl || alt || shift || meta
    val fire: (String) -> Unit = { key -> onKey(key, ctrl, alt, shift, meta) }

    Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
        Column(Modifier.fillMaxWidth().padding(8.dp)) {
            // Sticky modifier + special-key row (horizontally scrollable).
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(bottom = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ModChip("Ctrl", ctrl) { ctrl = !ctrl }
                ModChip("Alt", alt) { alt = !alt }
                ModChip("Shift", shift) { shift = !shift }
                ModChip("Win", meta) { meta = !meta }
                Spacer(Modifier.width(2.dp))
                KeyChip("Tab") { fire("Tab") }
                KeyChip("Esc") { fire("Escape") }
                KeyChip("↑") { fire("ArrowUp") }
                KeyChip("↓") { fire("ArrowDown") }
                KeyChip("←") { fire("ArrowLeft") }
                KeyChip("→") { fire("ArrowRight") }
                KeyChip("Del") { fire("Delete") }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text(if (anyMod) "Modifier armed — type a key…" else "Type into the focused field…") },
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
                IconButton(onClick = { fire("Enter") }) { Icon(Icons.AutoMirrored.Filled.KeyboardReturn, "Enter") }
                IconButton(onClick = { fire("Backspace") }) { Icon(Icons.Filled.Backspace, "Backspace") }
                IconButton(onClick = { fire("Escape") }) { Text("Esc", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}

/** A sticky modifier chip — highlighted while armed. */
@Composable
private fun ModChip(label: String, active: Boolean, onToggle: () -> Unit) {
    Surface(
        onClick = onToggle,
        shape = RoundedCornerShape(10.dp),
        color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
        contentColor = if (active) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Text(label, modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp), style = MaterialTheme.typography.labelLarge)
    }
}

/** A momentary special-key chip (fires with whatever modifiers are armed). */
@Composable
private fun KeyChip(label: String, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Text(label, modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp), style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
private fun WaitingOverlay(everLoaded: Boolean) {
    Column(
        Modifier.fillMaxSize().padding(28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Filled.DesktopWindows, null, modifier = Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.size(14.dp))
        Text(
            if (everLoaded) "Live screen paused" else "Waiting for the Antigravity window",
            color = MaterialTheme.colorScheme.onSurface,
            style = MaterialTheme.typography.titleSmall,
        )
        Spacer(Modifier.size(6.dp))
        Text(
            "No frames are coming through. Make sure the Antigravity window is open and " +
                "not minimised on your laptop — a minimised window can't be captured.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
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
