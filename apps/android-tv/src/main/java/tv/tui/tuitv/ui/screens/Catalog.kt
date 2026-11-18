package tv.tui.tuitv.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import kotlinx.coroutines.delay
import tv.tui.core.ContentKind
import tv.tui.core.GroupCount
import tv.tui.core.MediaItem
import tv.tui.core.NowNext
import tv.tui.core.programmeProgress
import tv.tui.tuitv.data.GroupFilter
import tv.tui.tuitv.data.Programme
import tv.tui.tuitv.ui.Route
import tv.tui.tuitv.ui.Txt
import tv.tui.tuitv.ui.components.ColumnPivot
import tv.tui.tuitv.ui.components.EmptyState
import tv.tui.tuitv.ui.components.ListRow
import tv.tui.tuitv.ui.components.Loading
import tv.tui.tuitv.ui.components.Muted
import tv.tui.tuitv.ui.components.PosterCard
import tv.tui.tuitv.ui.components.RemoteImage
import tv.tui.tuitv.ui.components.RequestFocus
import tv.tui.tuitv.ui.components.ScreenTitle
import tv.tui.tuitv.ui.components.rememberFocusMemory
import tv.tui.tuitv.ui.library
import tv.tui.tuitv.ui.navigator
import tv.tui.tuitv.ui.play
import tv.tui.tuitv.ui.rememberFavoriteToggle
import tv.tui.tuitv.ui.theme.TuiColors
import tv.tui.tuitv.ui.device
import tv.tui.tuitv.ui.components.Chip
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.layout.widthIn

/** Filtro de categoria serializado em texto (para sobreviver à navegação): "*" todos, "" sem categoria. */
private fun filterOf(key: String): GroupFilter = when (key) {
    "*" -> GroupFilter.All
    "" -> GroupFilter.None
    else -> GroupFilter.Named(key)
}

private fun keyOf(group: GroupCount) = group.name

/** Login conectando: a categoria inicial ainda não é conhecida (nada é pedido ao servidor até lá). */
private const val PENDING = "\u0000pending"

/**
 * Categoria escolhida. Com login sob demanda, a tela abre na primeira categoria do servidor:
 * "Todas" pediria a lista inteira e fica só como opção.
 */
@Composable
private fun rememberGroupKey(key: Any, groups: List<GroupCount>?): Pair<String, (String) -> Unit> {
    val library = library()
    var chosen by rememberSaveable(key) { mutableStateOf<String?>(null) }
    val remote by library.hasRemote.collectAsStateWithLifecycle<Boolean?>(null)
    val current = chosen ?: when (remote) {
        null -> PENDING
        false -> "*"
        true -> groups?.let { it.firstOrNull()?.name ?: "*" } ?: PENDING
    }
    return current to { chosen = it }
}

/** Conteúdo da categoria; nada é consultado enquanto a categoria inicial não é conhecida. */
private fun itemsFor(library: tv.tui.tuitv.data.Library, kind: ContentKind, groupKey: String): kotlinx.coroutines.flow.Flow<List<MediaItem>?> =
    if (groupKey == PENDING) kotlinx.coroutines.flow.flowOf(null) else library.items(kind, filterOf(groupKey))

/** Categoria vazia — ou, com login, a falha ao consultar o servidor. */
@Composable
private fun emptyText(): String {
    val errors by library().remoteErrors.collectAsStateWithLifecycle()
    return errors.values.firstOrNull()?.let(Txt::importError) ?: Txt.EMPTY_GROUP
}

/**
 * Coluna de categorias. A categoria em foco é aplicada após uma breve pausa (navegação rápida
 * pelo controle não dispara consultas a cada passo); OK aplica na hora e leva o foco ao conteúdo.
 */
@Composable
private fun GroupColumn(groups: List<GroupCount>?, selected: String, onSelect: (String) -> Unit, onOpen: () -> Unit, modifier: Modifier = Modifier, width: Int = 260) {
    var pending by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(pending) {
        val key = pending ?: return@LaunchedEffect
        delay(350)
        onSelect(key)
    }
    val memory = rememberFocusMemory("groups")
    val state = rememberLazyListState()
    ColumnPivot {
    LazyColumn(
        // ◀ a partir do conteúdo volta sempre à categoria em que o usuário estava.
        modifier.width(width.dp).fillMaxHeight().focusRestorer(memory.requester),
        state = state,
        verticalArrangement = Arrangement.spacedBy(6.dp),
        contentPadding = PaddingValues(vertical = 8.dp, horizontal = 6.dp),
    ) {
        val all = listOf(GroupCount("*", groups?.sumOf { it.count } ?: 0)) + (groups ?: emptyList())
        itemsIndexed(all, key = { _, g -> "g:" + g.name }) { index, group ->
            val key = keyOf(group)
            val label = when (key) {
                "*" -> Txt.ALL
                "" -> Txt.NO_GROUP
                else -> key
            }
            ListRow(
                title = label,
                // Categorias de login ainda não carregadas não têm contagem.
                trailing = group.count.takeIf { it > 0 }?.let(Txt::number),
                selected = key == selected,
                onFocus = { pending = key },
                onClick = {
                    pending = null
                    onSelect(key)
                    onOpen()
                },
                modifier = memory.item(index),
            )
        }
    }
    }
}

/** Celular: categorias numa fileira de pílulas acima do conteúdo; toque escolhe na hora. */
@Composable
private fun GroupChips(groups: List<GroupCount>?, selected: String, onSelect: (String) -> Unit) {
    val all = listOf(GroupCount("*", 0)) + (groups ?: emptyList())
    val state = rememberLazyListState()
    LazyRow(
        Modifier.fillMaxWidth(),
        state = state,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = PaddingValues(bottom = 12.dp),
    ) {
        itemsIndexed(all, key = { _, g -> "c:" + g.name }) { _, group ->
            val key = keyOf(group)
            val label = when (key) {
                "*" -> Txt.ALL
                "" -> Txt.NO_GROUP
                else -> key
            }
            Chip(label, key == selected, { onSelect(key) }, Modifier.widthIn(max = 240.dp))
        }
    }
    // A categoria escolhida fica à vista (ex.: ao voltar para a tela).
    LaunchedEffect(groups != null) {
        val index = all.indexOfFirst { keyOf(it) == selected }
        if (index > 0) state.scrollToItem(index)
    }
}

/**
 * Categorias conforme a tela: coluna à esquerda (TV e tablet) ou pílulas no topo (celular),
 * com o conteúdo ocupando o resto.
 */
@Composable
private fun WithGroups(
    groups: List<GroupCount>?,
    selected: String,
    onSelect: (String) -> Unit,
    onOpen: () -> Unit,
    columnWidth: Int = 260,
    content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit,
) {
    if (device().compact) {
        GroupChips(groups, selected, onSelect)
        Row(Modifier.fillMaxSize(), content = content)
    } else {
        Row(Modifier.fillMaxSize()) {
            GroupColumn(groups, selected, onSelect, onOpen = onOpen, width = if (device().tv) columnWidth else minOf(columnWidth, 220))
            Spacer(Modifier.width(if (device().tv) 20.dp else 12.dp))
            content()
        }
    }
}

/**
 * Quando o conteúdo deve receber o foco: ao abrir a tela e ao confirmar uma categoria com OK.
 * Navegar pelas categorias (que troca o conteúdo após uma pausa) nunca tira o foco da coluna.
 */
@Composable
private fun rememberContentFocus() = remember { mutableStateOf(true) }

@Composable
fun LiveScreen() {
    val library = library()
    val navigator = navigator()
    val toggleFavorite = rememberFavoriteToggle()
    val groups by remember { library.groups(ContentKind.LIVE) }.collectAsStateWithLifecycle(null)
    val (groupKey, setGroup) = rememberGroupKey("live", groups)
    val items by remember(groupKey) { itemsFor(library, ContentKind.LIVE, groupKey) }.collectAsStateWithLifecycle(null)
    val epgVersion by library.epgVersion.collectAsStateWithLifecycle(0)
    val memory = rememberFocusMemory("channels", groupKey)
    val listState = rememberLazyListState()
    var focusContent by rememberContentFocus()

    val device = device()
    Column(Modifier.fillMaxSize().padding(horizontal = device.gutter)) {
        ScreenTitle(Txt.LIVE, subtitle = items?.let { Txt.plural(it.size, "canal", "canais") + " · " + Txt.longPressHint(device.tv) })
        WithGroups(groups, groupKey, setGroup, onOpen = { focusContent = true }) {
            val list = items
            when {
                list == null -> Loading(Modifier.weight(1f))
                list.isEmpty() -> EmptyState(emptyText(), Modifier.weight(1f))
                else -> {
                    ColumnPivot {
                    LazyColumn(
                        Modifier.weight(1f).fillMaxHeight().focusRestorer(memory.requester),
                        state = listState,
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                        contentPadding = if (device.tv) PaddingValues(vertical = 8.dp, horizontal = 6.dp) else PaddingValues(bottom = 24.dp),
                    ) {
                        itemsIndexed(list, key = { _, item -> item.id }) { index, item ->
                            ChannelRow(
                                number = index + 1,
                                item = item,
                                epgVersion = epgVersion,
                                onClick = { navigator.play(list, item) },
                                onLongClick = { toggleFavorite(item.id, item.kind, item.playlistId) },
                                modifier = memory.item(index),
                            )
                        }
                    }
                    }
                    LaunchedEffect(groupKey) {
                        if (memory.index >= list.size) memory.index = 0
                        listState.scrollToItem(memory.index)
                    }
                    if (focusContent) RequestFocus(memory.requester, groupKey) { focusContent = false }
                }
            }
        }
    }
}

@Composable
private fun ChannelRow(number: Int, item: MediaItem, epgVersion: Int, onClick: () -> Unit, onLongClick: () -> Unit, modifier: Modifier = Modifier) {
    val library = library()
    val epg by produceState<NowNext<Programme>?>(null, item.id, epgVersion) { value = library.nowNext(item) }
    val current = epg?.current
    ListRow(
        title = item.name,
        subtitle = current?.let { "${Txt.time(it.start)}  ${it.title}" } ?: item.group,
        progress = current?.let { programmeProgress(it.start, it.stop, System.currentTimeMillis()) },
        onClick = onClick,
        onLongClick = onLongClick,
        modifier = modifier,
        leading = {
            val compact = device().compact
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(number.toString(), style = MaterialTheme.typography.bodyMedium, color = TuiColors.Muted, modifier = Modifier.width(if (compact) 32.dp else 44.dp))
                RemoteImage(item.logo, item.name, Modifier.size(width = if (compact) 60.dp else 72.dp, height = if (compact) 38.dp else 44.dp))
            }
        },
    )
}

/** Filmes ou séries: categorias à esquerda e grade de capas. */
@Composable
fun CatalogScreen(kind: ContentKind) {
    val library = library()
    val navigator = navigator()
    val toggleFavorite = rememberFavoriteToggle()
    val groups by remember(kind) { library.groups(kind) }.collectAsStateWithLifecycle(null)
    val (groupKey, setGroup) = rememberGroupKey(kind, groups)
    val memory = rememberFocusMemory(kind, groupKey)
    val gridState = rememberLazyGridState()
    var focusContent by rememberContentFocus()
    val title = if (kind == ContentKind.MOVIE) Txt.MOVIES else Txt.SERIES

    val movies by remember(groupKey, kind) {
        if (kind == ContentKind.MOVIE) itemsFor(library, kind, groupKey) else kotlinx.coroutines.flow.flowOf(emptyList())
    }.collectAsStateWithLifecycle(null)
    val series by remember(groupKey, kind) {
        when {
            kind != ContentKind.SERIES -> kotlinx.coroutines.flow.flowOf(emptyList())
            groupKey == PENDING -> kotlinx.coroutines.flow.flowOf(null)
            else -> library.series(filterOf(groupKey))
        }
    }.collectAsStateWithLifecycle(null)

    val count = if (kind == ContentKind.MOVIE) movies?.size else series?.size
    val device = device()
    Column(Modifier.fillMaxSize().padding(horizontal = device.gutter)) {
        ScreenTitle(title, subtitle = count?.let { if (kind == ContentKind.MOVIE) Txt.plural(it, "filme", "filmes") else Txt.plural(it, "série", "séries") })
        WithGroups(groups, groupKey, setGroup, onOpen = { focusContent = true }) {
            val loaded = if (kind == ContentKind.MOVIE) movies != null else series != null
            when {
                !loaded -> Loading(Modifier.weight(1f))
                count == 0 -> EmptyState(emptyText(), Modifier.weight(1f))
                else -> {
                    ColumnPivot {
                    // Celular: 3 capas por linha (como a Netflix); tablet e TV: quantas couberem.
                    LazyVerticalGrid(
                        columns = GridCells.Adaptive(if (device.compact) 100.dp else if (device.tv) 140.dp else 128.dp),
                        state = gridState,
                        modifier = Modifier.weight(1f).fillMaxHeight().focusRestorer(memory.requester),
                        contentPadding = if (device.tv) PaddingValues(16.dp) else PaddingValues(top = 4.dp, bottom = 24.dp),
                        horizontalArrangement = Arrangement.spacedBy(if (device.tv) 22.dp else 10.dp),
                        verticalArrangement = Arrangement.spacedBy(if (device.tv) 24.dp else 16.dp),
                    ) {
                        if (kind == ContentKind.MOVIE) {
                            itemsIndexed(movies!!, key = { _, m -> m.id }) { index, movie ->
                                PosterCard(
                                    title = movie.name,
                                    image = movie.logo,
                                    caption = movie.year?.toString(),
                                    onClick = { navigator.open(Route.MovieDetail(movie.id)) },
                                    onLongClick = { toggleFavorite(movie.id, movie.kind, movie.playlistId) },
                                    modifier = memory.item(index),
                                    fill = true,
                                )
                            }
                        } else {
                            itemsIndexed(series!!, key = { _, s -> s.id }) { index, s ->
                                PosterCard(
                                    title = s.title,
                                    image = s.logo,
                                    // Séries de login mostram os episódios ao abrir; até lá, o ano.
                                    caption = if (s.episodes > 0) Txt.plural(s.episodes, "episódio", "episódios") else s.year?.toString(),
                                    onClick = { navigator.open(Route.SeriesDetail(s.playlistId, s.seriesKey)) },
                                    onLongClick = { toggleFavorite(s.id, ContentKind.SERIES, s.playlistId) },
                                    modifier = memory.item(index),
                                    fill = true,
                                )
                            }
                        }
                    }
                    }
                    LaunchedEffect(groupKey) {
                        if (memory.index >= (count ?: 0)) memory.index = 0
                        gridState.scrollToItem(memory.index)
                    }
                    if (focusContent) RequestFocus(memory.requester, groupKey) { focusContent = false }
                }
            }
        }
    }
}

/** Guia de programação: categorias, canais com o programa atual e a grade do canal em foco. */
@Composable
fun GuideScreen() {
    val library = library()
    val navigator = navigator()
    val sources by library.epgSources.collectAsStateWithLifecycle()
    val groups by remember { library.groups(ContentKind.LIVE) }.collectAsStateWithLifecycle(null)
    val (groupKey, setGroup) = rememberGroupKey("guide", groups)
    val items by remember(groupKey) { itemsFor(library, ContentKind.LIVE, groupKey) }.collectAsStateWithLifecycle(null)
    val epgVersion by library.epgVersion.collectAsStateWithLifecycle(0)
    var focused by remember { mutableStateOf<MediaItem?>(null) }
    val memory = rememberFocusMemory("guide", groupKey)
    var focusContent by rememberContentFocus()

    val device = device()
    Column(Modifier.fillMaxSize().padding(horizontal = device.gutter)) {
        ScreenTitle(Txt.GUIDE, subtitle = if (sources.isEmpty()) "Nenhum guia (XMLTV) adicionado. Adicione um em Listas." else null)
        WithGroups(groups, groupKey, setGroup, onOpen = { focusContent = true }, columnWidth = 220) {
            val list = items
            when {
                list == null -> Loading(Modifier.weight(1f))
                list.isEmpty() -> EmptyState(emptyText(), Modifier.weight(1f))
                else -> {
                    ColumnPivot {
                    // Celular: só os canais com o programa atual (a grade não cabe ao lado).
                    LazyColumn(
                        (if (device.compact) Modifier.weight(1f) else Modifier.width(if (device.tv) 360.dp else 300.dp)).fillMaxHeight().focusRestorer(memory.requester),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                        contentPadding = PaddingValues(vertical = 8.dp, horizontal = 6.dp),
                    ) {
                        itemsIndexed(list, key = { _, item -> item.id }) { index, item ->
                            ChannelRow(
                                number = index + 1,
                                item = item,
                                epgVersion = epgVersion,
                                onClick = { navigator.play(list, item) },
                                onLongClick = {},
                                modifier = memory.item(index).onFocusChanged { if (it.isFocused) focused = item },
                            )
                        }
                    }
                    }
                    if (focusContent) RequestFocus(memory.requester, groupKey) { focusContent = false }
                    if (!device.compact) {
                        Spacer(Modifier.width(20.dp))
                        Schedule(focused, epgVersion, Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun Schedule(item: MediaItem?, epgVersion: Int, modifier: Modifier) {
    val library = library()
    val programmes by produceState<List<Programme>?>(null, item?.id, epgVersion) {
        val now = System.currentTimeMillis()
        value = item?.let { library.schedule(it, now - 3_600_000L, now + 24 * 3_600_000L) }
    }
    Column(modifier.fillMaxHeight().padding(top = 8.dp)) {
        if (item == null) return@Column
        Text(item.name, style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        val list = programmes
        when {
            list == null -> Muted(Txt.LOADING)
            list.isEmpty() -> Muted("Sem programação para este canal.")
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                val now = System.currentTimeMillis()
                itemsIndexed(list, key = { _, p -> p.rowId }) { _, p ->
                    val live = p.start <= now && p.stop > now
                    Column(Modifier.fillMaxWidth()) {
                        Text(
                            "${Txt.time(p.start)} – ${Txt.time(p.stop)}   ${p.title}",
                            style = MaterialTheme.typography.bodyLarge,
                            color = if (live) TuiColors.Cyan else TuiColors.White,
                        )
                        p.description?.let { Muted(it, maxLines = 2) }
                    }
                }
            }
        }
    }
}
