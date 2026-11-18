package tv.tui.tuitv

import android.graphics.Bitmap
import android.net.Uri
import android.view.KeyEvent as NativeKeyEvent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.isFocused
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performKeyPress
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import tv.tui.tuitv.data.GroupFilter
import tv.tui.tuitv.ui.Route
import tv.tui.tuitv.ui.TuiRoot
import tv.tui.tuitv.ui.Txt
import tv.tui.tuitv.ui.theme.TuiTheme

/**
 * Telas renderizadas em 1920x1080 (TV), com capturas salvas em build/screenshots
 * para conferência visual, e navegação pelo controle remoto (D-pad).
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
@Config(qualifiers = "w960dp-h540dp-land-television-xhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class UiTest {
    @get:Rule
    val compose = createComposeRule()

    private val app get() = ApplicationProvider.getApplicationContext<TuiApp>()
    private val fixtures = File(System.getProperty("tuitv.fixtures")!!)

    private fun seed() = runBlocking {
        app.library.addPlaylistFile(Uri.fromFile(File(fixtures, "basic.m3u")), "basic.m3u", "Referência")
        app.library.addPlaylistFile(Uri.fromFile(File(fixtures, "vod.m3u")), "vod.m3u", "Filmes e séries")
    }

    private var route by mutableStateOf<Route?>(null)

    /** A regra só aceita um setContent por teste: trocar [route] recria a raiz na nova tela. */
    private fun show(target: Route = Route.Home) {
        val first = route == null
        route = target
        if (first) compose.setContent { TuiTheme { key(route) { TuiRoot(initial = route!!, splash = false) } } }
        compose.waitForIdle()
    }

    private fun waitFor(text: String, substring: Boolean = false) {
        compose.waitUntil(10_000) { compose.onAllNodesWithText(text, substring = substring).fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle()
    }

    private fun shot(name: String) {
        compose.mainClock.advanceTimeBy(600)
        compose.waitForIdle()
        val dir = File(System.getProperty("tuitv.screenshots")!!).apply { mkdirs() }
        val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
        File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun press(keyCode: Int) {
        compose.onRoot().performKeyPress(KeyEvent(NativeKeyEvent(NativeKeyEvent.ACTION_DOWN, keyCode)))
        compose.onRoot().performKeyPress(KeyEvent(NativeKeyEvent(NativeKeyEvent.ACTION_UP, keyCode)))
        compose.waitForIdle()
    }

    @Test
    fun boasVindasSemListas() {
        show()
        waitFor(Txt.WELCOME_TITLE)
        shot("01-boas-vindas")
    }

    @Test
    fun inicioComFileiras() {
        seed()
        show()
        waitFor("Canais ao vivo")
        waitFor(Txt.MOVIES)
        shot("02-inicio")
    }

    @Test
    fun aoVivoEPlayerPeloControle() {
        seed()
        show(Route.Live)
        waitFor("Canal Um HD")
        shot("03-ao-vivo")
        // OK no canal em foco abre o player; a sobreposição mostra os atalhos do controle.
        press(NativeKeyEvent.KEYCODE_DPAD_CENTER)
        // (Sem captura: a SurfaceView do vídeo não é capturável no Robolectric.)
        waitFor("trocar canal", substring = true)
        // ▲ troca de canal dentro da categoria.
        press(NativeKeyEvent.KEYCODE_DPAD_UP)
        waitFor("2  ", substring = true)
    }

    @Test
    fun filmesESeries() {
        seed()
        show(Route.Movies)
        waitFor("O Grande Filme (2019)")
        shot("05-filmes")
        val s = runBlocking { app.library.series(GroupFilter.All).first().first { it.title == "A Série" } }
        show(Route.SeriesDetail(s.playlistId, s.seriesKey))
        waitFor("Temporada 2")
        shot("06-serie")
    }

    @Test
    fun historicoMostraASerieUmaVezEContinua() {
        seed()
        val episodes = runBlocking {
            val s = app.library.series(GroupFilter.All).first().first { it.title == "A Série" }
            app.library.episodes(s.playlistId, s.seriesKey).first().sortedBy { it.order }
        }
        // E1 até o fim e o E2 pela metade; depois, o E1 de novo: o histórico continua no E2 (o mais adiante).
        app.library.recordPlayback(episodes[0], 2900, 3000)
        app.library.recordPlayback(episodes[1], 1200, 3000)
        Thread.sleep(20)
        app.library.recordPlayback(episodes[0], 100, 3000)
        compose.waitUntil(10_000) { runBlocking { app.library.history.first().count { it.seriesId != null } } == 2 }
        show(Route.History)
        waitFor("A Série")
        assertEquals(1, compose.onAllNodesWithText("A Série").fetchSemanticsNodes().size)
        assertTrue(compose.onAllNodesWithText("S01E0", substring = true).fetchSemanticsNodes().isEmpty())
        waitFor(Txt.episodeLabel(1, 2), substring = true)
        shot("15-historico")
        // OK abre o player no episódio mais adiante já assistido (E2).
        press(NativeKeyEvent.KEYCODE_DPAD_CENTER)
        waitFor("A Série S01E02", substring = true)
    }

    @Test
    fun inicioContinuarAssistindoMostraASerieUmaVez() {
        seed()
        val episodes = runBlocking {
            val s = app.library.series(GroupFilter.All).first().first { it.title == "A Série" }
            app.library.episodes(s.playlistId, s.seriesKey).first().sortedBy { it.order }
        }
        app.library.recordPlayback(episodes[0], 2900, 3000)
        Thread.sleep(20)
        app.library.recordPlayback(episodes[1], 1200, 3000)
        compose.waitUntil(10_000) { runBlocking { app.library.continueWatching.first().isNotEmpty() } }
        show()
        waitFor(Txt.CONTINUE)
        waitFor(Txt.episodeLabel(1, 2), substring = true)
        // Um cartão para a série (não um por episódio): nenhum nome de episódio na fileira.
        assertTrue(compose.onAllNodesWithText("S01E0", substring = true).fetchSemanticsNodes().isEmpty())
        assertEquals(1, compose.onAllNodesWithText(Txt.episodeLabel(1, 2), substring = true).fetchSemanticsNodes().size)
        shot("16-inicio-continuar")
        // OK no cartão (primeiro da primeira fileira) abre o episódio mais adiante já assistido.
        press(NativeKeyEvent.KEYCODE_DPAD_CENTER)
        waitFor("A Série S01E02", substring = true)
    }

    @Test
    fun adicionarListaPorLogin() {
        seed()
        show(Route.Playlists)
        waitFor(Txt.ADD_PLAYLIST)
        compose.onAllNodesWithText(Txt.ADD_PLAYLIST).onFirst().performSemanticsAction(SemanticsActions.OnClick)
        waitFor("Link da lista (M3U/M3U8)")
        compose.onNodeWithText("Login (host, usuário e senha)").performSemanticsAction(SemanticsActions.OnClick)
        waitFor("Host (servidor)")
        waitFor("Usuário")
        waitFor("Senha")
        compose.onNode(isDialog()).captureToImage().asAndroidBitmap().let { bitmap ->
            val dir = File(System.getProperty("tuitv.screenshots")!!).apply { mkdirs() }
            File(dir, "11-adicionar-por-login.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
    }

    @Test
    fun listasConfiguracoesBuscaEGuia() {
        seed()
        show(Route.Playlists)
        // Os botões padronizados (48 dp) deixam só a primeira lista visível na tela.
        waitFor("Referência")
        shot("07-listas")
        show(Route.Settings)
        waitFor("Reprodução automática")
        shot("08-configuracoes")
        show(Route.Search)
        waitFor("Pesquisar")
        shot("09-busca")
        show(Route.Guide)
        waitFor("Canal Um HD")
        shot("10-guia")
    }

    /** Texto do elemento que está com o foco do controle. */
    private fun focused(): String {
        compose.waitForIdle()
        val node = compose.onNode(isFocused()).fetchSemanticsNode()
        return node.config.getOrElse(SemanticsProperties.Text) { emptyList() }.joinToString(" ") { it.text }
    }

    @Test
    fun categoriasNaoRoubamOFoco() {
        seed()
        show(Route.Live)
        waitFor("Canal Um HD")
        assertTrue(focused(), focused().contains("Canal"))
        // ◀ leva às categorias, na categoria em uso.
        press(NativeKeyEvent.KEYCODE_DPAD_LEFT)
        assertTrue(focused(), focused().startsWith(Txt.ALL))
        // ▼ percorre as categorias; a lista troca após a pausa, mas o foco continua na coluna.
        press(NativeKeyEvent.KEYCODE_DPAD_DOWN)
        val category = focused()
        compose.mainClock.advanceTimeBy(1500)
        assertEquals(category, focused())
        press(NativeKeyEvent.KEYCODE_DPAD_DOWN)
        val second = focused()
        compose.mainClock.advanceTimeBy(1500)
        assertEquals(second, focused())
        // OK confirma a categoria e leva o foco ao primeiro canal dela.
        press(NativeKeyEvent.KEYCODE_DPAD_CENTER)
        compose.mainClock.advanceTimeBy(800)
        assertTrue(focused(), !focused().startsWith(second.substringBefore(' ')))
        // ◀ volta exatamente à categoria escolhida.
        press(NativeKeyEvent.KEYCODE_DPAD_LEFT)
        assertEquals(second, focused())
        shot("12-ao-vivo-categoria")
    }

    @Test
    fun fileirasLembramOCartao() {
        seed()
        show()
        waitFor("Canais ao vivo")
        waitFor(Txt.MOVIES)
        val first = focused()
        press(NativeKeyEvent.KEYCODE_DPAD_RIGHT)
        press(NativeKeyEvent.KEYCODE_DPAD_RIGHT)
        val third = focused()
        assertNotEquals(first, third)
        shot("13-inicio-foco")
        // ▼ e ▲: volta ao mesmo cartão da fileira, não ao "mais próximo" na tela.
        press(NativeKeyEvent.KEYCODE_DPAD_DOWN)
        val below = focused()
        assertNotEquals(third, below)
        press(NativeKeyEvent.KEYCODE_DPAD_UP)
        assertEquals(third, focused())
    }

    @Test
    fun detalheDoFilmeEPlayer() {
        seed()
        val movie = runBlocking { app.library.items(tv.tui.core.ContentKind.MOVIE, GroupFilter.All).first().first() }
        show(Route.MovieDetail(movie.id))
        waitFor("Assistir")
        assertTrue(focused(), focused().contains("Assistir"))
        shot("14-detalhe-filme")
        press(NativeKeyEvent.KEYCODE_DPAD_RIGHT)
        assertTrue(focused(), focused().contains("Favoritar"))
        press(NativeKeyEvent.KEYCODE_DPAD_LEFT)
        press(NativeKeyEvent.KEYCODE_DPAD_CENTER)
        // Player próprio: controles com botões e tempo restante.
        waitFor("Áudio e legendas")
    }
}
