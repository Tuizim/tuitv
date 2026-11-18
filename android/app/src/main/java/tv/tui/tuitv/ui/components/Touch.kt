package tv.tui.tuitv.ui.components

import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Espera antes de marcar "pressionado": um arrasto de rolagem não pisca o elemento. */
private const val PRESS_DELAY_MS = 90L

/**
 * Toque e toque longo para os componentes do Compose for TV, que só respondem ao controle
 * (OK do D-pad). Sem foco: na TV o elemento continua com um único ponto de parada do D-pad.
 * O estado "pressionado" vai para [interaction], então a superfície encolhe/clareia no toque;
 * o toque longo vibra (como segurar um título na Netflix).
 */
fun Modifier.tapToClick(
    interaction: MutableInteractionSource,
    enabled: Boolean = true,
    onLongClick: (() -> Unit)? = null,
    onClick: () -> Unit,
): Modifier = if (!enabled) this else composed {
    val haptics = LocalHapticFeedback.current
    val click by rememberUpdatedState(onClick)
    val longClick by rememberUpdatedState(onLongClick)
    val hasLong = onLongClick != null
    pointerInput(interaction, hasLong) {
        coroutineScope {
            detectTapGestures(
                onPress = { offset ->
                    val press = PressInteraction.Press(offset)
                    val marking = launch {
                        delay(PRESS_DELAY_MS)
                        interaction.emit(press)
                    }
                    val released = tryAwaitRelease()
                    val wasMarked = marking.isCompleted
                    marking.cancel()
                    if (wasMarked) interaction.emit(if (released) PressInteraction.Release(press) else PressInteraction.Cancel(press))
                },
                onLongPress = if (hasLong) {
                    {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        longClick?.invoke()
                    }
                } else null,
                onTap = { click() },
            )
        }
    }
}
