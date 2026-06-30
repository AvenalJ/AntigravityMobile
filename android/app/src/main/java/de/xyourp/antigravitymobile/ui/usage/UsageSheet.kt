package de.xyourp.antigravitymobile.ui.usage

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import de.xyourp.antigravitymobile.net.QuotaModelInfo
import de.xyourp.antigravitymobile.net.QuotaResponse
import de.xyourp.antigravitymobile.ui.theme.GitModifiedAmber
import de.xyourp.antigravitymobile.ui.theme.RejectRed

private data class ProviderUsage(
    val name: String,
    val remaining: Int,
    val used: Int,
    val resetIn: String?,
    val status: String,
    val modelCount: Int,
)

private fun providerOf(modelName: String): String = when {
    listOf("claude", "opus", "sonnet", "haiku", "anthropic").any { modelName.contains(it, true) } -> "Anthropic"
    modelName.contains("gemini", true) -> "Gemini"
    listOf("gpt", "openai", "oss").any { modelName.contains(it, true) } -> "OpenAI"
    else -> "Other"
}

/** Collapse models into one entry per provider (same-provider models share a quota). */
private fun groupByProvider(models: List<QuotaModelInfo>): List<ProviderUsage> {
    val order = listOf("Anthropic", "Gemini", "OpenAI", "Other")
    return models.groupBy { providerOf(it.name) }.map { (provider, list) ->
        // Within a provider the quota is shared; take the most-consumed as representative.
        val remaining = list.minOf { it.remainingPercent }.coerceIn(0, 100)
        ProviderUsage(
            name = provider,
            remaining = remaining,
            used = 100 - remaining,
            resetIn = list.firstNotNullOfOrNull { it.resetIn },
            status = list.minByOrNull { it.remainingPercent }?.status ?: "healthy",
            modelCount = list.size,
        )
    }.sortedBy { order.indexOf(it.name).let { i -> if (i < 0) order.size else i } }
}

@Composable
private fun statusColor(status: String): Color = when (status) {
    "danger", "exhausted" -> RejectRed
    "warning" -> GitModifiedAmber
    else -> MaterialTheme.colorScheme.primary
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UsageSheet(quota: QuotaResponse?, loading: Boolean, onDismiss: () -> Unit) {
    val sheetState = rememberModalBottomSheetState()
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Usage", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface)

            when {
                loading && quota == null -> Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                }
                quota?.available != true -> Text(
                    quota?.error ?: "Usage unavailable. Make sure Antigravity is running.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                else -> {
                    val providers = groupByProvider(quota.models)
                    val overallUsed = providers.maxOfOrNull { it.used } ?: 0

                    // 1) Overall weekly usage as a bar.
                    UsageBar(label = "Weekly usage", percentUsed = overallUsed, color = MaterialTheme.colorScheme.primary)

                    // 2) One card per provider — weekly bar + a single circle.
                    providers.forEach { p -> ProviderCard(p) }

                    Text(
                        "Daily breakdown isn't exposed by the quota API yet — these are the current weekly allowances.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun UsageBar(label: String, percentUsed: Int, color: Color) {
    val pct = percentUsed.coerceIn(0, 100)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("$pct% used", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold)
        }
        Box(
            Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(50))
                .background(MaterialTheme.colorScheme.surfaceVariant)
        ) {
            Box(
                Modifier.fillMaxWidth(pct / 100f).height(10.dp).clip(RoundedCornerShape(50)).background(color)
            )
        }
    }
}

@Composable
private fun ProviderCard(p: ProviderUsage) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Gauge(remaining = p.remaining, color = statusColor(p.status))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text(p.name, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                    Text(
                        "${p.modelCount} model${if (p.modelCount == 1) "" else "s"}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                UsageBar(label = "Weekly", percentUsed = p.used, color = statusColor(p.status))
                if (!p.resetIn.isNullOrBlank()) {
                    Text("Resets in ${p.resetIn}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

/** Circular remaining-quota gauge with the percentage in the centre. */
@Composable
private fun Gauge(remaining: Int, color: Color) {
    val pct = remaining.coerceIn(0, 100)
    val track = MaterialTheme.colorScheme.surface
    Box(Modifier.size(72.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(72.dp)) {
            val stroke = 8.dp.toPx()
            val inset = stroke / 2
            val arcSize = androidx.compose.ui.geometry.Size(size.width - stroke, size.height - stroke)
            val topLeft = androidx.compose.ui.geometry.Offset(inset, inset)
            drawArc(track, 0f, 360f, false, topLeft = topLeft, size = arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
            drawArc(color, -90f, 360f * (pct / 100f), false, topLeft = topLeft, size = arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
        }
        Text("$pct%", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Bold)
    }
}
