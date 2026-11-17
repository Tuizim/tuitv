package tv.tui.tuitv.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged

/**
 * Lembra qual item de uma lista/grade estava em foco, para devolver o foco a ele quando
 * o usuário volta à tela (botão Voltar do controle).
 */
@Stable
class FocusMemory(initial: Int) {
    var index by mutableIntStateOf(initial)
    val requester = FocusRequester()

    fun item(i: Int): Modifier =
        (if (i == index) Modifier.focusRequester(requester) else Modifier).onFocusChanged { if (it.isFocused) index = i }

    companion object {
        val saver = Saver<FocusMemory, Int>(save = { it.index }, restore = { FocusMemory(it) })
    }
}

@Composable
fun rememberFocusMemory(vararg keys: Any?): FocusMemory = rememberSaveable(*keys, saver = FocusMemory.saver) { FocusMemory(0) }
