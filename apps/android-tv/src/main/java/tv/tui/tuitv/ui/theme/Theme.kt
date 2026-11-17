package tv.tui.tuitv.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.tv.material3.LocalContentColor
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Typography
import androidx.tv.material3.darkColorScheme

/** Identidade visual oficial (packages/design-system/src/tokens.ts). */
object TuiColors {
    val Navy = Color(0xFF101827)
    val NavyRaised = Color(0xFF172B46)
    val NavyDeep = Color(0xFF0B111D)
    val Cyan = Color(0xFF38BDF8)
    val White = Color(0xFFFFFFFF)
    val Line = Color(0xFF22344F)
    val Muted = Color(0xFF93A4BB)
    val Danger = Color(0xFFF87171)
    val Success = Color(0xFF34D399)
    val Warning = Color(0xFFFBBF24)
    /** Superfície em foco (sobre o azul-marinho). */
    val Focus = Color(0xFF24456E)
}

private val scheme = darkColorScheme(
    primary = TuiColors.Cyan,
    onPrimary = TuiColors.Navy,
    primaryContainer = TuiColors.NavyRaised,
    onPrimaryContainer = TuiColors.White,
    secondary = TuiColors.Cyan,
    onSecondary = TuiColors.Navy,
    background = TuiColors.Navy,
    onBackground = TuiColors.White,
    surface = TuiColors.NavyRaised,
    onSurface = TuiColors.White,
    surfaceVariant = TuiColors.Line,
    onSurfaceVariant = TuiColors.Muted,
    inverseSurface = TuiColors.White,
    inverseOnSurface = TuiColors.Navy,
    border = TuiColors.Line,
    borderVariant = TuiColors.Cyan,
    error = TuiColors.Danger,
    onError = TuiColors.Navy,
)

private val typography = Typography().let { t ->
    t.copy(
        displaySmall = t.displaySmall.copy(fontWeight = FontWeight.ExtraBold),
        headlineMedium = t.headlineMedium.copy(fontWeight = FontWeight.Bold),
        headlineSmall = t.headlineSmall.copy(fontWeight = FontWeight.Bold),
        titleLarge = t.titleLarge.copy(fontWeight = FontWeight.SemiBold),
        titleMedium = t.titleMedium.copy(fontWeight = FontWeight.SemiBold),
        bodyLarge = TextStyle(fontSize = 18.sp, lineHeight = 26.sp),
        bodyMedium = TextStyle(fontSize = 16.sp, lineHeight = 22.sp),
        bodySmall = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    )
}

@Composable
fun TuiTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, typography = typography) {
        // Texto fora de superfícies (títulos sob os cartões, avisos) também fica claro.
        CompositionLocalProvider(LocalContentColor provides TuiColors.White, content = content)
    }
}
