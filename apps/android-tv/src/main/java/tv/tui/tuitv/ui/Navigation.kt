package tv.tui.tuitv.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import tv.tui.core.MediaItem

sealed interface Route {
    data object Home : Route
    data object Live : Route
    data object Movies : Route
    data object Series : Route
    data object Guide : Route
    data object Search : Route
    data object Favorites : Route
    data object History : Route
    data object Playlists : Route
    data object Settings : Route

    /** Celular e tablet: "Mais" reúne o que não cabe na barra inferior (favoritos, histórico, listas…). */
    data object More : Route
    data class MovieDetail(val itemId: String) : Route
    data class SeriesDetail(val playlistId: String, val seriesKey: String) : Route

    /** Reprodução: [queue] permite trocar de canal ou seguir para o próximo episódio. */
    data class Player(val queue: List<MediaItem>, val index: Int, val resumeAt: Long? = null) : Route
}

data class Destination(val route: Route, val label: String, val icon: ImageVector)

val destinations = listOf(
    Destination(Route.Home, Txt.HOME, Icons.Filled.Home),
    Destination(Route.Live, Txt.LIVE, TuiIcons.LiveTv),
    Destination(Route.Movies, Txt.MOVIES, TuiIcons.Movie),
    Destination(Route.Series, Txt.SERIES, TuiIcons.Series),
    Destination(Route.Guide, Txt.GUIDE, TuiIcons.Guide),
    Destination(Route.Search, Txt.SEARCH, Icons.Filled.Search),
    Destination(Route.Favorites, Txt.FAVORITES, Icons.Filled.Favorite),
    Destination(Route.History, Txt.HISTORY, TuiIcons.History),
    Destination(Route.Playlists, Txt.PLAYLISTS, TuiIcons.Playlists),
    Destination(Route.Settings, Txt.SETTINGS, Icons.Filled.Settings),
)

/** Abas da barra inferior (toque): Início, Ao vivo, Filmes, Séries e Mais. */
val touchTabs = listOf(
    Destination(Route.Home, Txt.HOME, Icons.Filled.Home),
    Destination(Route.Live, Txt.LIVE, TuiIcons.LiveTv),
    Destination(Route.Movies, Txt.MOVIES, TuiIcons.Movie),
    Destination(Route.Series, Txt.SERIES, TuiIcons.Series),
    Destination(Route.More, Txt.MORE, Icons.Filled.Menu),
)

/** Itens da tela "Mais", na ordem em que aparecem. */
val moreDestinations = listOf(
    Destination(Route.Favorites, Txt.FAVORITES, Icons.Filled.Favorite),
    Destination(Route.History, Txt.HISTORY, TuiIcons.History),
    Destination(Route.Guide, Txt.GUIDE, TuiIcons.Guide),
    Destination(Route.Playlists, Txt.PLAYLISTS, TuiIcons.Playlists),
    Destination(Route.Settings, Txt.SETTINGS, Icons.Filled.Settings),
)

/** Pilha de navegação simples: destinos principais substituem a pilha; detalhes e player empilham. */
@Stable
class Navigator {
    val stack = mutableStateListOf<Route>(Route.Home)
    val current: Route get() = stack.last()

    /** Destino principal da tela atual (para destacar no menu lateral). */
    val section: Route get() = stack.lastOrNull { r -> destinations.any { it.route == r } } ?: Route.Home

    /** Aba da barra inferior que fica acesa: o que veio de "Mais" acende "Mais". */
    val tab: Route get() = stack.lastOrNull { r -> touchTabs.any { it.route == r } || moreDestinations.any { it.route == r } }
        ?.let { r -> if (touchTabs.any { it.route == r }) r else Route.More } ?: Route.Home

    fun open(route: Route) {
        if (destinations.any { it.route == route } || route == Route.More) {
            stack.clear()
            stack.add(Route.Home)
            if (route != Route.Home) stack.add(route)
        } else {
            stack.add(route)
        }
    }

    /** Empilha sem limpar a pilha (ex.: de "Mais" para Favoritos: Voltar retorna a "Mais"). */
    fun push(route: Route) {
        stack.add(route)
    }

    fun replace(route: Route) {
        stack[stack.lastIndex] = route
    }

    fun back(): Boolean {
        if (stack.size <= 1) return false
        stack.removeAt(stack.lastIndex)
        return true
    }
}

/** Avisos curtos no canto da tela. */
@Stable
class Toaster(private val scope: CoroutineScope) {
    var message by mutableStateOf<String?>(null)
        private set
    private var job: Job? = null

    fun show(text: String, millis: Long = 2500) {
        job?.cancel()
        message = text
        job = scope.launch {
            delay(millis)
            message = null
        }
    }
}

val LocalNavigator = compositionLocalOf<Navigator> { error("Navigator ausente") }
val LocalToaster = compositionLocalOf<Toaster> { error("Toaster ausente") }

@Composable
fun navigator() = LocalNavigator.current

@Composable
fun toaster() = LocalToaster.current
