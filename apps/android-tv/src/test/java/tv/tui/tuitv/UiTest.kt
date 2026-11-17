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
        waitFor("Filmes e séries")
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
}
