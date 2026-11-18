package tv.tui.tuitv

import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
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
 * Celular em pé (411x891 dp), tudo pelo toque: `performClick` injeta um toque de verdade na tela
 * (os testes de TV usam a ação semântica, que não passa pelo toque). Capturas em build/screenshots.
 */
@RunWith(AndroidJUnit4::class)
@Config(qualifiers = "w411dp-h891dp-port-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PhoneUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val app get() = ApplicationProvider.getApplicationContext<TuiApp>()
    private val fixtures = File(System.getProperty("tuitv.fixtures")!!)

    private fun seed() = runBlocking {
        app.library.addPlaylistFile(Uri.fromFile(File(fixtures, "basic.m3u")), "basic.m3u", "Referência")
        app.library.addPlaylistFile(Uri.fromFile(File(fixtures, "vod.m3u")), "vod.m3u", "Filmes e séries")
    }

    private var route by mutableStateOf<Route?>(null)

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

    private fun tap(text: String) {
        compose.onAllNodesWithText(text).onFirst().performClick()
        compose.mainClock.advanceTimeBy(400)
        compose.waitForIdle()
    }

    private fun tab(label: String) {
        compose.onNode(hasText(label) and SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab)).performClick()
        compose.waitForIdle()
    }

    private fun save(name: String, bitmap: Bitmap) {
        val dir = File(System.getProperty("tuitv.screenshots")!!).apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun shot(name: String) {
        compose.mainClock.advanceTimeBy(600)
        compose.waitForIdle()
        save(name, compose.onRoot().captureToImage().asAndroidBitmap())
    }

    @Test
    fun boasVindasAdicionarListaPeloToque() {
        show()
        waitFor(Txt.WELCOME_TITLE)
        shot("celular-01-boas-vindas")
        // O problema relatado: no celular o botão não respondia ao toque.
        tap(Txt.ADD_PLAYLIST)
        waitFor("Link da lista (M3U/M3U8)")
        tap("Login")
        waitFor("Host (servidor)")
        waitFor("Senha")
        save("celular-02-adicionar-login", compose.onNode(isDialog()).captureToImage().asAndroidBitmap())
    }

    @Test
    fun inicioFilmesFichaEPlayer() {
        seed()
        show()
        waitFor("Canais ao vivo")
        waitFor(Txt.MOVIES)
        shot("celular-03-inicio")
        tab(Txt.MOVIES)
        waitFor("O Grande Filme (2019)")
        shot("celular-04-filmes")
        tap("O Grande Filme (2019)")
        waitFor("Assistir")
        shot("celular-05-ficha")
        tap("Favoritar")
        waitFor("Nos favoritos")
        tap("Assistir")
        waitFor("Áudio e legendas")
    }

    @Test
    fun aoVivoComCategoriasEmPilulas() {
        seed()
        show()
        waitFor("Canais ao vivo")
        tab(Txt.LIVE)
        waitFor("Canal Um HD")
        waitFor(Txt.ALL)
        shot("celular-06-ao-vivo")
        tap("Canal Um HD")
        // Player no toque: botão de sair e de opções no topo.
        compose.waitUntil(10_000) { compose.onAllNodesWithContentDescription("Sair do player").fetchSemanticsNodes().isNotEmpty() }
    }

    @Test
    fun maisListasEAdicionar() {
        seed()
        show()
        waitFor("Canais ao vivo")
        tab(Txt.MORE)
        waitFor(Txt.PLAYLISTS)
        shot("celular-07-mais")
        tap(Txt.PLAYLISTS)
        waitFor("Referência")
        shot("celular-08-listas")
        tap(Txt.ADD_PLAYLIST)
        waitFor("Link da lista (M3U/M3U8)")
    }

    @Test
    fun fichaDaSerie() {
        seed()
        val s = runBlocking { app.library.series(GroupFilter.All).first().first { it.title == "A Série" } }
        show(Route.SeriesDetail(s.playlistId, s.seriesKey))
        waitFor("Temporada 2")
        shot("celular-09-serie")
        tap("Temporada 2")
        shot("celular-10-serie-t2")
    }
}
