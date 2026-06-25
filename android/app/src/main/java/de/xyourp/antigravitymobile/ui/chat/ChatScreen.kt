package de.xyourp.antigravitymobile.ui.chat

import android.annotation.SuppressLint
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.viewinterop.AndroidView

/**
 * Chat tab. Antigravity 2.0 dropped the `#cascade` HTML-mirror the native chat
 * used to scrape, so the chat now embeds the bridge's structured web chat page
 * (`/minimal.html`) in a WebView. That page renders the structured conversation,
 * agent activity, completion, multiple-choice prompts, approvals, artifacts, and
 * the conversation picker — all served by `/api/chat/structured` & friends.
 *
 * The web page provides its own input bar, model label, and action buttons, so
 * the native chrome (input/model/approval bars) is intentionally gone here.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ChatScreen(
    webChatUrl: String,
    modifier: Modifier = Modifier,
) {
    var loadedUrl by remember { mutableStateOf<String?>(null) }
    Box(modifier.fillMaxSize().imePadding()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                WebView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true   // localStorage auth token + theme
                    settings.loadWithOverviewMode = true
                    settings.useWideViewPort = true
                    setBackgroundColor(Color.Transparent.toArgb())
                    isVerticalScrollBarEnabled = true
                    webViewClient = WebViewClient()
                }
            },
            update = { web ->
                if (loadedUrl != webChatUrl && webChatUrl.startsWith("http")) {
                    loadedUrl = webChatUrl
                    web.loadUrl(webChatUrl)
                }
            },
        )
    }
}
