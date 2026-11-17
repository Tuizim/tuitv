package tv.tui.tuitv.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.DrawerValue
import androidx.tv.material3.Icon
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.ModalNavigationDrawer
import androidx.tv.material3.NavigationDrawerItem
import androidx.tv.material3.Text
import androidx.tv.material3.rememberDrawerState
import kotlinx.coroutines.delay
import tv.tui.core.ContentKind
import tv.tui.tuitv.ui.components.ProgressLine
import tv.tui.tuitv.ui.player.PlayerScreen
import tv.tui.tuitv.ui.screens.CatalogScreen
import tv.tui.tuitv.ui.screens.FavoritesScreen
import tv.tui.tuitv.ui.screens.GuideScreen
import tv.tui.tuitv.ui.screens.HistoryScreen
import tv.tui.tuitv.ui.screens.HomeScreen
import tv.tui.tuitv.ui.screens.LiveScreen
import tv.tui.tuitv.ui.screens.MovieDetailScreen
import tv.tui.tuitv.ui.screens.PlaylistsScreen
import tv.tui.tuitv.ui.screens.SearchScreen
import tv.tui.tuitv.ui.screens.SeriesDetailScreen
import tv.tui.tuitv.ui.screens.SettingsScreen
import tv.tui.tuitv.ui.screens.WelcomeScreen
import tv.tui.tuitv.ui.theme.TuiColors

@Composable
fun TuiRoot(initial: Route = Route.Home, splash: Boolean = true) {
    val library = library()
    val scope = rememberCoroutineScope()
    val navigator = remember { Navigator().apply { if (initial != Route.Home) open(initial) } }
    val toaster = remember { Toaster(scope) }
    val playlists by library.playlists.collectAsStateWithLifecycle()
    var splashDone by remember { mutableStateOf(!splash) }
    LaunchedEffect(Unit) {
        delay(900)
        splashDone = true
    }

    CompositionLocalProvider(LocalNavigator provides navigator, LocalToaster provides toaster) {
        // Registrado antes do conteúdo: o player e os diálogos têm prioridade sobre ele.
        BackHandler(enabled = navigator.stack.size > 1) { navigator.back() }
        Box(Modifier.fillMaxSize().background(TuiColors.Navy)) {
            val current = navigator.current
            val list = playlists
            when {
                !splashDone || list == null -> Splash()
                current is Route.Player -> PlayerScreen(current)
                list.isEmpty() && current != Route.Playlists && current != Route.Settings -> WelcomeScreen()
                else -> MainShell(navigator)
            }
            JobsIndicator(Modifier.align(Alignment.BottomEnd).padding(24.dp))
            ToastHost(toaster.message, Modifier.align(Alignment.BottomCenter).padding(bottom = 36.dp))
        }
    }
}

@Composable
private fun Splash() {
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Brand(big = true)
        Spacer(Modifier.height(16.dp))
        Text(Txt.TAGLINE, style = MaterialTheme.typography.titleMedium, color = TuiColors.Muted)
    }
}

@Composable
fun Brand(big: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(TuiIcons.Logo, contentDescription = null, tint = androidx.compose.ui.graphics.Color.Unspecified, modifier = Modifier.size(if (big) 72.dp else 36.dp))
        Spacer(Modifier.width(if (big) 16.dp else 10.dp))
        val style = if (big) MaterialTheme.typography.displayMedium else MaterialTheme.typography.headlineSmall
        Text("Tui", style = style, color = TuiColors.White)
        Text("TV", style = style, color = TuiColors.Cyan)
    }
}

@Composable
private fun MainShell(navigator: Navigator) {
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val holder = rememberSaveableStateHolder()
    ModalNavigationDrawer(
        drawerState = drawerState,
        scrimBrush = androidx.compose.ui.graphics.SolidColor(TuiColors.NavyDeep.copy(alpha = 0.7f)),
        drawerContent = { value ->
            // Rolável: com 10 destinos o menu não cabe inteiro em todas as resoluções (o foco rola até o item).
            Column(
                Modifier.fillMaxHeight().background(TuiColors.NavyDeep).verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 12.dp),
            ) {
                Box(Modifier.padding(start = 8.dp, top = 4.dp, bottom = 8.dp)) {
                    if (value == DrawerValue.Open) Brand() else Icon(TuiIcons.Logo, null, tint = androidx.compose.ui.graphics.Color.Unspecified, modifier = Modifier.size(36.dp))
                }
                for (destination in destinations) {
                    NavigationDrawerItem(
                        selected = navigator.section == destination.route,
                        onClick = { navigator.open(destination.route) },
                        leadingContent = { Icon(destination.icon, contentDescription = destination.label) },
                    ) {
                        Text(destination.label)
                    }
                }
            }
        },
    ) {
        Box(Modifier.fillMaxSize().padding(start = 88.dp, top = 28.dp, end = 40.dp)) {
            val route = navigator.current
            holder.SaveableStateProvider(route.toString()) {
                Screen(route)
            }
        }
    }
}

@Composable
private fun Screen(route: Route) {
    when (route) {
        Route.Home -> HomeScreen()
        Route.Live -> LiveScreen()
        Route.Movies -> CatalogScreen(ContentKind.MOVIE)
        Route.Series -> CatalogScreen(ContentKind.SERIES)
        Route.Guide -> GuideScreen()
        Route.Search -> SearchScreen()
        Route.Favorites -> FavoritesScreen()
        Route.History -> HistoryScreen()
        Route.Playlists -> PlaylistsScreen()
        Route.Settings -> SettingsScreen()
        is Route.MovieDetail -> MovieDetailScreen(route.itemId)
        is Route.SeriesDetail -> SeriesDetailScreen(route.playlistId, route.seriesKey)
        is Route.Player -> Unit
    }
}

/** Progresso das importações em andamento (não recebe foco). */
@Composable
private fun JobsIndicator(modifier: Modifier) {
    val jobs by library().jobs.collectAsStateWithLifecycle()
    val running = jobs.filter { it.running }
    AnimatedVisibility(running.isNotEmpty(), modifier, enter = fadeIn(), exit = fadeOut()) {
        Column(
            Modifier.width(320.dp).clip(RoundedCornerShape(12.dp)).background(TuiColors.NavyRaised).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            for (job in running) {
                val p = job.progress
                Text("Importando ${job.name}", style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                val total = p?.total
                if (p != null && total != null && total > 0) ProgressLine(p.loaded.toFloat() / total)
                Text(
                    if (p == null) Txt.LOADING else "${Txt.number(p.count)} itens",
                    style = MaterialTheme.typography.bodySmall,
                    color = TuiColors.Muted,
                )
            }
        }
    }
}

@Composable
private fun ToastHost(message: String?, modifier: Modifier) {
    AnimatedVisibility(message != null, modifier, enter = fadeIn(), exit = fadeOut()) {
        Text(
            message ?: "",
            style = MaterialTheme.typography.bodyLarge,
            color = TuiColors.Navy,
            modifier = Modifier.clip(RoundedCornerShape(24.dp)).background(TuiColors.Cyan).padding(horizontal = 24.dp, vertical = 12.dp),
        )
    }
}
