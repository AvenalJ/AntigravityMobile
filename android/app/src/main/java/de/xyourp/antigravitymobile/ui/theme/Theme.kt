package de.xyourp.antigravitymobile.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val DarkColors = darkColorScheme(
    primary = TealBright,
    onPrimary = Color(0xFF002019),
    primaryContainer = TealDeep,
    onPrimaryContainer = Color(0xFFD9FFF4),
    secondary = TealMid,
    onSecondary = Color(0xFF002019),
    // secondaryContainer drives the bottom-nav selected indicator — was unset, so
    // Material3 fell back to its purple baseline. Teal-derived values fix that.
    secondaryContainer = Color(0xFF1A4035),
    onSecondaryContainer = TealBright,
    tertiary = Color(0xFF5EC4A8),
    onTertiary = Color(0xFF001F18),
    tertiaryContainer = Color(0xFF0F2922),
    onTertiaryContainer = Color(0xFFB0EAD9),
    background = DarkBackground,
    onBackground = DarkOnSurface,
    surface = DarkSurface,
    onSurface = DarkOnSurface,
    surfaceVariant = DarkSurfaceVariant,
    onSurfaceVariant = DarkOnSurfaceVariant,
    surfaceTint = TealBright,
    surfaceContainerLowest = DarkBackground,
    surfaceContainerLow = Color(0xFF121817),
    surfaceContainer = DarkSurface,
    surfaceContainerHigh = DarkSurfaceVariant,
    surfaceContainerHighest = Color(0xFF283330),
    outline = DarkOutline,
    outlineVariant = DarkOutline,
    inverseSurface = DarkOnSurface,
    inverseOnSurface = DarkBackground,
    inversePrimary = TealDeep,
    scrim = Color(0xFF000000),
    error = RejectRed,
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
)

private val LightColors = lightColorScheme(
    primary = TealDeep,
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFB9F1E2),
    onPrimaryContainer = Color(0xFF00201A),
    secondary = TealMid,
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFB9F1E2),
    onSecondaryContainer = Color(0xFF00201A),
    tertiary = TealMid,
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFCDF9EA),
    onTertiaryContainer = Color(0xFF00201A),
    background = LightBackground,
    onBackground = LightOnSurface,
    surface = LightSurface,
    onSurface = LightOnSurface,
    surfaceVariant = LightSurfaceVariant,
    onSurfaceVariant = LightOnSurfaceVariant,
    surfaceTint = TealDeep,
    surfaceContainerLowest = LightSurface,
    surfaceContainerLow = Color(0xFFF2F6F5),
    surfaceContainer = LightSurfaceVariant,
    surfaceContainerHigh = Color(0xFFE0E8E5),
    surfaceContainerHighest = Color(0xFFD4DFDB),
    outline = LightOutline,
    outlineVariant = LightOutline,
    inverseSurface = LightOnSurface,
    inverseOnSurface = LightBackground,
    inversePrimary = TealBright,
    scrim = Color(0xFF000000),
    error = RejectRed,
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),
)

@Composable
fun AntigravityTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColors else LightColors
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            val controller = WindowCompat.getInsetsController(window, view)
            controller.isAppearanceLightStatusBars = colorScheme.background.luminance() > 0.5f
            controller.isAppearanceLightNavigationBars = colorScheme.background.luminance() > 0.5f
        }
    }
    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography(),
        content = content,
    )
}
