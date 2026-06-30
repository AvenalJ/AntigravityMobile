package de.xyourp.antigravitymobile.ui.chat

import android.text.method.LinkMovementMethod
import android.widget.TextView
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.text.HtmlCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import de.xyourp.antigravitymobile.net.ActionButton
import de.xyourp.antigravitymobile.net.Artifact
import de.xyourp.antigravitymobile.net.AskPrompt
import de.xyourp.antigravitymobile.net.StructuredMessage
import de.xyourp.antigravitymobile.ui.components.EmptyState

@Composable
fun ChatScreen(vm: ChatViewModel, modifier: Modifier = Modifier) {
    val state by vm.state.collectAsStateWithLifecycle()

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().imePadding()) {
            ChatTopBar(
                model = state.chat.model,
                hideCot = state.hideCot,
                onToggleCot = vm::toggleCot,
                onOpenConversations = vm::openConversations,
            )

            Box(Modifier.weight(1f)) {
                val msgs = state.chat.messages
                when {
                    state.loading && msgs.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                        CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                    }
                    msgs.isEmpty() && state.chat.prompt == null -> EmptyState(
                        icon = Icons.AutoMirrored.Filled.List,
                        title = if (state.error != null) "Chat unavailable" else "No messages yet",
                        subtitle = state.error ?: "Send a message to start talking to the agent.",
                    )
                    else -> ChatBody(state, onAction = vm::clickAction, onOpenArtifact = vm::openArtifact,
                        onAnswerOption = vm::answerOption, onAnswerOther = vm::answerOther, onAnswerSkip = vm::answerSkip)
                }
            }

            ChatInputBar(sending = state.sending, onSend = vm::send)
        }

        state.openArtifact?.let { art ->
            ArtifactViewer(art, onNav = vm::navArtifact, onClose = vm::closeArtifact)
        }
    }

    if (state.showConversations) {
        ConversationSheet(
            state = state,
            onPick = vm::switchConversation,
            onNew = vm::newConversation,
            onDismiss = vm::closeConversations,
        )
    }
}

@Composable
private fun ChatTopBar(model: String, hideCot: Boolean, onToggleCot: () -> Unit, onOpenConversations: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
        Row(
            Modifier.fillMaxWidth().padding(start = 14.dp, end = 6.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("Agent", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
                if (model.isNotBlank()) {
                    Text(model, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            IconButton(onClick = onToggleCot) {
                Icon(
                    Icons.Filled.Psychology,
                    contentDescription = if (hideCot) "Show thinking" else "Hide thinking",
                    tint = if (hideCot) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary,
                )
            }
            IconButton(onClick = onOpenConversations) {
                Icon(Icons.AutoMirrored.Filled.List, "Conversations", tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun ChatBody(
    state: ChatState,
    onAction: (String, String) -> Unit,
    onOpenArtifact: (Artifact) -> Unit,
    onAnswerOption: (String, String?) -> Unit,
    onAnswerOther: (String, String, String?) -> Unit,
    onAnswerSkip: (String) -> Unit,
) {
    val listState = rememberLazyListState()
    val msgs = state.chat.messages
    // Auto-scroll to the newest content as it streams in.
    LaunchedEffect(msgs.size, msgs.lastOrNull()?.text, state.chat.prompt) {
        val count = msgs.size + (if (state.chat.prompt != null) 1 else 0)
        if (count > 0) listState.animateScrollToItem(count - 1)
    }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        state.chat.artifact?.takeIf { it.open }?.let { art ->
            item(key = "artifact-banner") { ArtifactBanner(art) { onOpenArtifact(art) } }
        }
        items(msgs) { msg ->
            if (msg.role == "user") UserBubble(msg.text)
            else AgentMessage(msg, hideCot = state.hideCot, onAction = onAction)
        }
        state.chat.prompt?.let { prompt ->
            item(key = "prompt") {
                PromptCard(prompt, onAnswerOption = onAnswerOption, onAnswerOther = onAnswerOther, onAnswerSkip = onAnswerSkip)
            }
        }
    }
}

@Composable
private fun UserBubble(text: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Surface(
            color = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            shape = RoundedCornerShape(16.dp, 16.dp, 4.dp, 16.dp),
            modifier = Modifier.widthIn(max = 320.dp),
        ) {
            Text(text, Modifier.padding(horizontal = 14.dp, vertical = 10.dp), style = MaterialTheme.typography.bodyLarge)
        }
    }
}

@Composable
private fun AgentMessage(msg: StructuredMessage, hideCot: Boolean, onAction: (String, String) -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (msg.worked.isNotBlank() || msg.activity.isNotEmpty()) {
            WorkedPill(msg, hideCot)
        }
        if (msg.text.isNotBlank()) ProseHtml(msg.text)
        msg.changes?.let { ChangesRow(it.summary, it.add, it.del) }
        if (msg.actions.isNotEmpty()) ActionBar(msg.actions, onAction)
    }
}

@Composable
private fun WorkedPill(msg: StructuredMessage, hideCot: Boolean) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 9.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (msg.working) {
                    CircularProgressIndicator(
                        Modifier.size(13.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.primary,
                    )
                } else {
                    Icon(Icons.Filled.Check, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(15.dp))
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    msg.worked.ifBlank { if (msg.working) "Working…" else "Done" },
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (!hideCot && msg.activity.isNotEmpty()) {
                Spacer(Modifier.size(6.dp))
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    msg.activity.forEach { step ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                Modifier.size(5.dp).background(
                                    MaterialTheme.colorScheme.primary.copy(alpha = 0.6f),
                                    RoundedCornerShape(50),
                                )
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(
                                step.text,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Render the agent's whitelisted-HTML prose in a native TextView (no WebView). */
@Composable
private fun ProseHtml(html: String) {
    val textColor = MaterialTheme.colorScheme.onSurface.toArgb()
    val linkColor = MaterialTheme.colorScheme.primary.toArgb()
    AndroidView(
        modifier = Modifier.fillMaxWidth(),
        factory = { ctx ->
            TextView(ctx).apply {
                movementMethod = LinkMovementMethod.getInstance()
                textSize = 15f
                setLineSpacing(0f, 1.25f)
            }
        },
        update = { tv ->
            tv.setTextColor(textColor)
            tv.setLinkTextColor(linkColor)
            tv.text = HtmlCompat.fromHtml(html, HtmlCompat.FROM_HTML_MODE_COMPACT)
        },
    )
}

@Composable
private fun ChangesRow(summary: String, add: String?, del: String?) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(Icons.Filled.Description, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(15.dp))
        Text(summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (!add.isNullOrBlank()) Text("+$add", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
        if (!del.isNullOrBlank()) Text("−$del", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
    }
}

@Composable
private fun ActionBar(actions: List<ActionButton>, onAction: (String, String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        actions.forEach { a ->
            val reject = a.kind == "reject"
            val border = if (reject) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary
            Surface(
                onClick = { onAction(a.xpath, a.label) },
                shape = RoundedCornerShape(10.dp),
                color = if (a.kind == "accept") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
                contentColor = if (a.kind == "accept") MaterialTheme.colorScheme.onPrimary else border,
                border = androidx.compose.foundation.BorderStroke(1.5.dp, border),
            ) {
                Text(a.label, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

@Composable
private fun PromptCard(
    prompt: AskPrompt,
    onAnswerOption: (String, String?) -> Unit,
    onAnswerOther: (String, String, String?) -> Unit,
    onAnswerSkip: (String) -> Unit,
) {
    var other by remember { mutableStateOf("") }
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        border = androidx.compose.foundation.BorderStroke(1.5.dp, MaterialTheme.colorScheme.primary),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (prompt.question.isNotBlank()) {
                Text(prompt.question, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
            }
            prompt.options.forEach { opt ->
                Surface(
                    onClick = { onAnswerOption(opt.xpath, prompt.submitXpath) },
                    shape = RoundedCornerShape(10.dp),
                    color = MaterialTheme.colorScheme.surface,
                    contentColor = MaterialTheme.colorScheme.onSurface,
                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(opt.label, Modifier.padding(horizontal = 14.dp, vertical = 12.dp), style = MaterialTheme.typography.bodyLarge)
                }
            }
            prompt.otherXpath?.let { ox ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = other,
                        onValueChange = { other = it },
                        modifier = Modifier.weight(1f),
                        placeholder = { Text("Write your own answer…") },
                        shape = RoundedCornerShape(10.dp),
                        maxLines = 3,
                    )
                    IconButton(
                        onClick = { if (other.isNotBlank()) { onAnswerOther(ox, other.trim(), prompt.submitXpath); other = "" } },
                        enabled = other.isNotBlank(),
                    ) { Icon(Icons.AutoMirrored.Filled.Send, "Send answer", tint = MaterialTheme.colorScheme.primary) }
                }
            }
            prompt.skipXpath?.let { sx ->
                Text(
                    "Skip",
                    Modifier.clickable { onAnswerSkip(sx) }.padding(vertical = 4.dp),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun ArtifactBanner(art: Artifact, onOpen: () -> Unit) {
    Surface(
        onClick = onOpen,
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.primary),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Description, null, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(10.dp))
            Text(art.title.ifBlank { "Artifact" }, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("View", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
private fun ArtifactViewer(art: Artifact, onNav: (String) -> Unit, onClose: () -> Unit) {
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize()) {
            Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
                Row(Modifier.fillMaxWidth().padding(end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onClose) { Icon(Icons.Filled.Close, "Close artifact") }
                    Text(art.title.ifBlank { "Artifact" }, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    art.prevXpath?.let { IconButton(onClick = { onNav(it) }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Previous") } }
                    art.nextXpath?.let { IconButton(onClick = { onNav(it) }) { Icon(Icons.AutoMirrored.Filled.ArrowForward, "Next") } }
                }
            }
            Box(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp)) {
                ProseHtml(art.html)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConversationSheet(
    state: ChatState,
    onPick: (String) -> Unit,
    onNew: () -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState()
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Conversations", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface)
                Surface(
                    onClick = onNew,
                    shape = RoundedCornerShape(10.dp),
                    color = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ) {
                    Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Add, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("New", style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
            if (state.conversations.isEmpty()) {
                Text("No conversations", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                LazyColumn(Modifier.fillMaxWidth()) {
                    items(state.conversations, key = { it.id }) { c ->
                        Row(
                            Modifier.fillMaxWidth().clickable { onPick(c.id) }.padding(horizontal = 16.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            if (c.active) {
                                Box(Modifier.size(8.dp).background(MaterialTheme.colorScheme.primary, RoundedCornerShape(50)))
                                Spacer(Modifier.width(10.dp))
                            } else {
                                Spacer(Modifier.width(18.dp))
                            }
                            Text(
                                c.title.ifBlank { "Untitled" },
                                style = MaterialTheme.typography.bodyLarge,
                                color = if (c.active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                                maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatInputBar(sending: Boolean, onSend: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 3.dp) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Message the agent…") },
                shape = RoundedCornerShape(20.dp),
                maxLines = 5,
            )
            Spacer(Modifier.width(8.dp))
            val canSend = text.isNotBlank() && !sending
            IconButton(onClick = { if (canSend) { onSend(text); text = "" } }, enabled = canSend) {
                if (sending) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.primary)
                } else {
                    Icon(Icons.AutoMirrored.Filled.Send, "Send", tint = MaterialTheme.colorScheme.primary)
                }
            }
        }
    }
}
