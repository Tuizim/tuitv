package tv.tui.tuitv.ui.components

import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.BringIntoViewSpec
import androidx.compose.foundation.gestures.LocalBringIntoViewSpec
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.foundation.focusGroup
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

    /**
     * Grupo (fileira, lista): ao entrar nele vindo de fora, o foco vai direto ao item lembrado —
     * mesmo que o grupo tenha saído da tela e sido recriado. Se o item não existir, segue o padrão.
     */
    fun group(): Modifier = Modifier.focusProperties { onEnter = { requester.requestFocus() } }.focusGroup()

    companion object {
        val saver = Saver<FocusMemory, Int>(save = { it.index }, restore = { FocusMemory(it) })
    }
}

@Composable
fun rememberFocusMemory(vararg keys: Any?): FocusMemory = rememberSaveable(*keys, saver = FocusMemory.saver) { FocusMemory(0) }

/**
 * Foco de uma tela de fileiras (Início, Favoritos): lembra a fileira e o cartão em foco, para que
 * Voltar devolva o usuário exatamente ao cartão que ele abriu — e não ao primeiro da tela.
 */
@Stable
class RowsFocusMemory(row: String?, index: Int) {
    var row by mutableStateOf(row)
    var index by mutableIntStateOf(index)
    val requester = FocusRequester()

    /** [fallbackRow]: fileira que recebe o foco quando nada foi lembrado (ou a lembrada sumiu). */
    fun item(row: String, i: Int, fallbackRow: String?, rows: Set<String>): Modifier {
        val target = this.row?.takeIf { it in rows } ?: fallbackRow
        val isTarget = row == target && i == (if (this.row == target) index else 0)
        return (if (isTarget) Modifier.focusRequester(requester) else Modifier).onFocusChanged {
            if (it.isFocused) {
                this.row = row
                index = i
            }
        }
    }

    companion object {
        val saver = listSaver<RowsFocusMemory, Any?>(
            save = { listOf(it.row, it.index) },
            restore = { RowsFocusMemory(it[0] as String?, it[1] as Int) },
        )
    }
}

@Composable
fun rememberRowsFocusMemory(key: String): RowsFocusMemory = rememberSaveable(key, saver = RowsFocusMemory.saver) { RowsFocusMemory(null, 0) }

/** Curva de desaceleração usada em toda a rolagem pelo controle: rápida no início, suave no fim. */
private val ScrollEasing = CubicBezierEasing(0.2f, 0f, 0f, 1f)
private val ScrollSpec: AnimationSpec<Float> = tween(durationMillis = 260, easing = ScrollEasing)

/**
 * Rolagem com "ponto fixo" (como na Netflix): o item em foco é levado sempre à mesma posição do
 * contêiner — [fraction] da largura/altura, mais [offsetPx]. Assim o foco não "gruda" na borda e a
 * fileira desliza por baixo dele; nas pontas da lista a rolagem para naturalmente.
 */
private class PivotSpec(private val fraction: Float, private val offsetPx: Float) : BringIntoViewSpec {
    @Deprecated("Mantido pela interface")
    override val scrollAnimationSpec: AnimationSpec<Float> get() = ScrollSpec

    override fun calculateScrollDistance(offset: Float, size: Float, containerSize: Float): Float {
        // Item maior que o contêiner: alinha o início.
        if (size >= containerSize) return offset
        val target = containerSize * fraction + offsetPx
        // Mantém o item inteiro visível mesmo quando o ponto fixo o empurraria para fora.
        return offset - target.coerceAtMost(containerSize - size)
    }
}

@OptIn(ExperimentalFoundationApi::class)
/** Fileira horizontal: o cartão em foco fica sempre colado à esquerda da fileira. */
@Composable
fun RowPivot(startPx: Float, content: @Composable () -> Unit) =
    CompositionLocalProvider(LocalBringIntoViewSpec provides PivotSpec(0f, startPx), content = content)

@OptIn(ExperimentalFoundationApi::class)
/** Listas verticais: o item em foco para a cerca de 1/3 da altura, mostrando o que vem a seguir. */
@Composable
fun ColumnPivot(fraction: Float = 0.3f, offsetPx: Float = 0f, content: @Composable () -> Unit) =
    CompositionLocalProvider(LocalBringIntoViewSpec provides PivotSpec(fraction, offsetPx), content = content)
