package tv.tui.tuitv.ui

import androidx.compose.foundation.Image
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import tv.tui.tuitv.R
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
import androidx.compose.foundation.focusGroup
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
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
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Search
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import tv.tui.tuitv.ui.components.IconAction
import tv.tui.tuitv.ui.components.tapToClick
import tv.tui.tuitv.ui.components.ColumnPivot
import tv.tui.tuitv.ui.components.ProgressLine
import tv.tui.tuitv.ui.player.PlayerScreen
import tv.tui.tuitv.ui.screens.CatalogScreen
import tv.tui.tuitv.ui.screens.FavoritesScreen
import tv.tui.tuitv.ui.screens.GuideScreen
import tv.tui.tuitv.ui.screens.HistoryScreen
import tv.tui.tuitv.ui.screens.HomeScreen
import tv.tui.tuitv.ui.screens.MoreScreen
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

    val device = rememberDevice()
    CompositionLocalProvider(LocalNavigator provides navigator, LocalToaster provides toaster, LocalDevice provides device) {
        // Registrado antes do conteúdo: o player e os diálogos têm prioridade sobre ele.
        BackHandler(enabled = navigator.stack.size > 1) { navigator.back() }
        val current = navigator.current
        OrientationPolicy(device, playing = current is Route.Player)
        Box(Modifier.fillMaxSize().background(TuiColors.Navy)) {
            val list = playlists
            var shell = false
            when {
                !splashDone || list == null -> Box(Modifier.systemBarsPadding()) { Splash() }
                current is Route.Player -> PlayerScreen(current)
                list.isEmpty() && current != Route.Playlists && current != Route.Settings -> Box(Modifier.systemBarsPadding()) { WelcomeScreen() }
                device.tv -> MainShell(navigator)
                else -> {
                    shell = true
                    TouchShell(navigator)
                }
            }
            // No toque, avisos e progresso ficam acima da barra inferior.
            val bottom = if (device.tv) Modifier else Modifier.navigationBarsPadding().padding(bottom = if (shell) BottomBarHeight else 0.dp)
            JobsIndicator(Modifier.align(Alignment.BottomEnd).then(bottom).padding(if (device.compact) 12.dp else 24.dp))
            ToastHost(toaster.message, Modifier.align(Alignment.BottomCenter).then(bottom).padding(bottom = if (device.tv) 36.dp else 16.dp, start = 16.dp, end = 16.dp))
        }
    }
}

/**
 * Celular: navegação em pé (como o app da Netflix) e player deitado. Tablets e TVs giram livremente.
 */
@Composable
private fun OrientationPolicy(device: Device, playing: Boolean) {
    val activity = LocalContext.current.activity() ?: return
    DisposableEffect(device.phone, playing) {
        activity.requestedOrientation = when {
            !device.phone -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            playing -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            else -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
        onDispose { }
    }
}

tailrec fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.activity()
    else -> null
}

/** Altura da barra inferior (sem a área de gestos do sistema). */
val BottomBarHeight = 64.dp

/**
 * Celular e tablet: cabeçalho com a marca e a busca, conteúdo e barra inferior com as abas —
 * a mesma estrutura do app da Netflix no celular. Telas internas (ficha, Favoritos…) ganham Voltar.
 */
@Composable
private fun TouchShell(navigator: Navigator) {
    val holder = rememberSaveableStateHolder()
    val route = navigator.current
    val isTab = touchTabs.any { it.route == route }
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).fillMaxWidth().statusBarsPadding()) {
            TouchTopBar(
                back = !isTab,
                search = route != Route.Search,
                onBack = { navigator.back() },
                onSearch = { navigator.push(Route.Search) },
            )
            Box(Modifier.weight(1f).fillMaxWidth()) {
                holder.SaveableStateProvider(route.toString()) { Screen(route) }
            }
        }
        BottomBar(navigator)
    }
}

@Composable
private fun TouchTopBar(back: Boolean, search: Boolean, onBack: () -> Unit, onSearch: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (back) {
            IconAction(Icons.AutoMirrored.Filled.ArrowBack, "Voltar", onBack)
            Spacer(Modifier.width(4.dp))
        } else {
            Spacer(Modifier.width(8.dp))
        }
        // Celular: só o gato, como na Web (o logotipo com o nome fica para o menu da TV).
        Image(painterResource(R.drawable.tuitv_icone), contentDescription = "TuiTV", modifier = Modifier.size(36.dp), contentScale = ContentScale.Fit)
        Spacer(Modifier.weight(1f))
        if (search) IconAction(Icons.Filled.Search, Txt.SEARCH, onSearch)
    }
}

@Composable
private fun BottomBar(navigator: Navigator) {
    val current = navigator.tab
    Row(
        Modifier
            .fillMaxWidth()
            .background(TuiColors.NavyDeep)
            .navigationBarsPadding()
            .height(BottomBarHeight),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (tab in touchTabs) {
            val selected = tab.route == current
            val interaction = remember { MutableInteractionSource() }
            val pressed by interaction.collectIsPressedAsState()
            val color = if (selected) TuiColors.White else TuiColors.Muted
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .semantics(mergeDescendants = true) {
                        role = Role.Tab
                        this.selected = selected
                        onClick { navigator.open(tab.route); true }
                    }
                    .tapToClick(interaction) { navigator.open(tab.route) }
                    .graphicsLayer { val s = if (pressed) 0.92f else 1f; scaleX = s; scaleY = s },
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(tab.icon, contentDescription = null, tint = color, modifier = Modifier.size(24.dp))
                Spacer(Modifier.height(4.dp))
                Text(
                    tab.label,
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal),
                    color = color,
                    maxLines = 1,
                )
            }
        }
    }
}

@Composable
private fun Splash() {
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        CatMark(Modifier.height(112.dp))
        Spacer(Modifier.height(24.dp))
        Text(Txt.TAGLINE, style = MaterialTheme.typography.titleMedium, color = TuiColors.Muted)
    }
}

/** Gato do TuiTV (ícone): tela de abertura e menu recolhido. Imagens geradas por `pnpm brand` a partir de img/. */
@Composable
fun CatMark(modifier: Modifier = Modifier) {
    Image(painterResource(R.drawable.tuitv_icone), contentDescription = null, modifier = modifier, contentScale = ContentScale.Fit)
}

/** Logotipo com o nome (gato + "TuiTV"). */
@Composable
fun Brand(big: Boolean = false) {
    Image(
        painterResource(R.drawable.tuitv_logo),
        contentDescription = "TuiTV",
        modifier = Modifier.height(if (big) 96.dp else 40.dp),
        contentScale = ContentScale.Fit,
    )
}

@Composable
private fun MainShell(navigator: Navigator) {
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val holder = rememberSaveableStateHolder()
    // Ao entrar no menu, o foco vai sempre para a seção atual (e não para o item mais próximo).
    val sectionFocus = remember { FocusRequester() }
    ModalNavigationDrawer(
        drawerState = drawerState,
        scrimBrush = androidx.compose.ui.graphics.SolidColor(TuiColors.NavyDeep.copy(alpha = 0.7f)),
        drawerContent = { value ->
            // Rolável: com 10 destinos o menu não cabe inteiro em todas as resoluções (o foco rola até o item).
            Column(
                Modifier
                    .fillMaxHeight()
                    .background(TuiColors.NavyDeep)
                    .focusProperties { onEnter = { sectionFocus.requestFocus() } }
                    .focusGroup()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 12.dp),
            ) {
                Box(Modifier.padding(start = 8.dp, top = 4.dp, bottom = 8.dp)) {
                    if (value == DrawerValue.Open) Brand() else CatMark(Modifier.size(40.dp))
                }
                for (destination in destinations) {
                    val selected = navigator.section == destination.route
                    NavigationDrawerItem(
                        modifier = if (selected) Modifier.focusRequester(sectionFocus) else Modifier,
                        selected = selected,
                        onClick = { navigator.open(destination.route) },
                        leadingContent = { Icon(destination.icon, contentDescription = destination.label) },
                    ) {
                        Text(destination.label)
                    }
                }
            }
        },
    ) {
        // Ao sair do menu (▶), o foco volta exatamente ao elemento em que estava na tela.
        Box(Modifier.fillMaxSize().padding(start = 88.dp, top = 28.dp, end = 40.dp).focusRestorer()) {
            val route = navigator.current
            holder.SaveableStateProvider(route.toString()) {
                // Rolagem pelo controle em todas as telas: o item em foco para a 1/3 da altura.
                ColumnPivot { Screen(route) }
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
        Route.More -> MoreScreen()
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
            Modifier.widthIn(max = 320.dp).clip(RoundedCornerShape(12.dp)).background(TuiColors.NavyRaised).padding(16.dp),
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
