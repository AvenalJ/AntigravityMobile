package de.xyourp.antigravitymobile.ui.chat

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import de.xyourp.antigravitymobile.net.ApprovalsResponse
import de.xyourp.antigravitymobile.ui.components.EmptyState
import de.xyourp.antigravitymobile.ui.components.FullLoading
import de.xyourp.antigravitymobile.ui.theme.AcceptGreen
import de.xyourp.antigravitymobile.ui.theme.RejectRed
import androidx.compose.material.icons.filled.ChatBubbleOutline

@Composable
fun ChatScreen(
    state: ChatState,
    currentModel: String?,
    pendingApproval: ApprovalsResponse?,
    responding: Boolean,
    onModelClick: () -> Unit,
    onApprove: () -> Unit,
    onReject: () -> Unit,
    onSend: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize().imePadding()) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                state.loading && state.html == null -> FullLoading("Loading chat…")
                state.html == null -> EmptyState(
                    icon = Icons.Filled.ChatBubbleOutline,
                    title = "No chat yet",
                    subtitle = state.error
                        ?: "Open a Cascade chat in Antigravity IDE, then it will mirror here.",
                )
                else -> ChatMirror(state)
            }
        }

        // Diff / command approval action bar.
        AnimatedVisibility(visible = pendingApproval != null) {
            ApprovalBar(
                approval = pendingApproval,
                responding = responding,
                onApprove = onApprove,
                onReject = onReject,
            )
        }

        // Typing / processing indicator.
        AnimatedVisibility(visible = state.processing || state.sending) {
            TypingIndicator()
        }

        ModelChipRow(currentModel = currentModel, onClick = onModelClick)

        ChatInputBar(sending = state.sending, onSend = onSend)
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun ChatMirror(state: ChatState) {
    var lastRevision by remember { mutableStateOf(-1L) }
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            WebView(ctx).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
                settings.javaScriptEnabled = false
                settings.loadWithOverviewMode = true
                settings.useWideViewPort = false
                setBackgroundColor(Color.Transparent.toArgb())
                isVerticalScrollBarEnabled = true
                webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView, url: String?) {
                        // Keep the latest message in view.
                        view.evaluateJavascript(
                            "window.scrollTo(0, document.body.scrollHeight);", null,
                        )
                    }
                }
            }
        },
        update = { web ->
            if (state.revision != lastRevision) {
                lastRevision = state.revision
                web.loadDataWithBaseURL(null, state.toDocument(), "text/html", "utf-8", null)
            }
        },
    )
}

@Composable
private fun ApprovalBar(
    approval: ApprovalsResponse?,
    responding: Boolean,
    onApprove: () -> Unit,
    onReject: () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        tonalElevation = 3.dp,
    ) {
        Column(Modifier.fillMaxWidth().padding(12.dp)) {
            val count = approval?.count ?: 0
            Text(
                if (count > 1) "$count steps need your approval" else "A step needs your approval",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                "Review the proposed change in the chat above, then accept or reject.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = onReject,
                    enabled = !responding,
                    colors = ButtonDefaults.buttonColors(containerColor = RejectRed),
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(Icons.Filled.Close, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(approval?.rejectButton?.text?.takeIf { it.isNotBlank() }?.replaceFirstChar { it.uppercase() } ?: "Reject")
                }
                Button(
                    onClick = onApprove,
                    enabled = !responding,
                    colors = ButtonDefaults.buttonColors(containerColor = AcceptGreen),
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(Icons.Filled.Check, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(approval?.approveButton?.text?.takeIf { it.isNotBlank() }?.replaceFirstChar { it.uppercase() } ?: "Accept")
                }
            }
        }
    }
}

@Composable
private fun TypingIndicator() {
    val transition = rememberInfiniteTransition(label = "typing")
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(3) { i ->
            val alpha by transition.animateFloat(
                initialValue = 0.3f,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(
                    animation = tween(600, delayMillis = i * 150),
                    repeatMode = RepeatMode.Reverse,
                ),
                label = "dot$i",
            )
            Box(
                Modifier.size(7.dp).clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = alpha)),
            )
            Spacer(Modifier.width(5.dp))
        }
        Spacer(Modifier.width(4.dp))
        Text("Agent is working…", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ModelChipRow(currentModel: String?, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = CircleShape,
            onClick = onClick,
        ) {
            Row(
                Modifier.padding(start = 12.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    currentModel?.takeIf { it.isNotBlank() } ?: "Select model",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Icon(Icons.Filled.ExpandMore, "Change model", modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun ChatInputBar(sending: Boolean, onSend: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
        Row(
            Modifier.fillMaxWidth().padding(10.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Message the agent…") },
                shape = RoundedCornerShape(22.dp),
                maxLines = 6,
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = ImeAction.Default),
            )
            Spacer(Modifier.width(8.dp))
            val canSend = text.isNotBlank() && !sending
            IconButton(
                onClick = {
                    if (canSend) {
                        onSend(text)
                        text = ""
                    }
                },
                enabled = canSend,
                modifier = Modifier.size(52.dp).clip(CircleShape)
                    .background(if (canSend) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant),
            ) {
                if (sending) {
                    CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                } else {
                    Icon(
                        Icons.AutoMirrored.Filled.Send,
                        contentDescription = "Send",
                        tint = if (canSend) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
