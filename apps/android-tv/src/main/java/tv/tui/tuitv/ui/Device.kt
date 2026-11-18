package tv.tui.tuitv.ui

import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Tipo de aparelho e tamanho da tela. O mesmo APK roda em TV (controle remoto, D-pad) e em
 * celulares e tablets (toque): a TV mantém o menu lateral e a navegação por foco; no toque o
 * aplicativo usa barra inferior, cabeçalho e telas empilhadas, como o app da Netflix no celular.
 */
@Immutable
data class Device(
    /** TV, Google TV ou Fire TV: navegação pelo controle. */
    val tv: Boolean,
    /** Largura de celular em pé (< 600 dp): categorias em fileira, ficha empilhada. */
    val compact: Boolean,
    /** Menor lado da tela < 600 dp: celular (em pé na navegação, deitado no player). */
    val phone: Boolean,
) {
    val touch get() = !tv

    /** Margem lateral das telas de toque (na TV, a margem vem do contêiner). */
    val gutter: Dp get() = if (tv) 0.dp else 16.dp

    companion object {
        val Tv = Device(tv = true, compact = false, phone = false)
        val Phone = Device(tv = false, compact = true, phone = true)
    }
}

/** TV pelo modo de interface (Android TV, Google TV, Fire TV) ou pelo recurso "leanback". */
fun Context.isTelevision(): Boolean {
    val tv = Configuration.UI_MODE_TYPE_TELEVISION
    val mode = (getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager)?.currentModeType
    return (resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK) == tv || mode == tv ||
        packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK) ||
        packageManager.hasSystemFeature("amazon.hardware.fire_tv")
}

val LocalDevice = staticCompositionLocalOf { Device.Tv }

@Composable
fun device(): Device = LocalDevice.current

/** Calcula o aparelho a partir da tela atual (recalcula ao girar ou redimensionar a janela). */
@Composable
fun rememberDevice(): Device {
    val context = LocalContext.current
    val tv = remember(context) { context.isTelevision() }
    val config = LocalConfiguration.current
    return remember(tv, config.screenWidthDp, config.smallestScreenWidthDp) {
        Device(
            tv = tv,
            compact = !tv && config.screenWidthDp < 600,
            phone = !tv && config.smallestScreenWidthDp < 600,
        )
    }
}
