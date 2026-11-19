package tv.tui.tuitv.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.background
import coil3.compose.AsyncImage
import coil3.compose.LocalPlatformContext
import coil3.request.ImageRequest
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import tv.tui.tuitv.ui.components.KeepScroll
import tv.tui.tuitv.ui.components.ColumnPivot
import tv.tui.tuitv.ui.components.EpisodeCard
import tv.tui.tuitv.ui.components.EpisodeTile
import tv.tui.tuitv.ui.components.FocusMemory
import tv.tui.tuitv.ui.components.ProgressLine
import tv.tui.tuitv.ui.components.RowPivot
import tv.tui.tuitv.ui.components.RowsFocusMemory
import tv.tui.tuitv.ui.components.rememberRowsFocusMemory
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.tui.core.ContentKind
import tv.tui.core.MediaItem
import tv.tui.core.EpisodeOrder
import tv.tui.core.EpisodeProgress
import tv.tui.core.SeriesGroup
import tv.tui.core.collapseSeriesHistory
import tv.tui.core.continueEpisode
import tv.tui.core.episodeTitle
import tv.tui.core.hasEpisodeDetails
import tv.tui.core.groupSeries
import tv.tui.core.nextEpisode
import tv.tui.core.seriesId
import tv.tui.tuitv.data.FavoriteEntry
import tv.tui.tuitv.data.HistoryEntry
import tv.tui.tuitv.data.RESUME_MIN_SEC
import tv.tui.tuitv.data.SearchResults
import tv.tui.tuitv.data.SeriesCard
import tv.tui.tuitv.ui.Navigator
import tv.tui.tuitv.ui.Route
import tv.tui.tuitv.ui.Txt
import tv.tui.tuitv.ui.components.ActionButton
import tv.tui.tuitv.ui.components.ChannelCard
import tv.tui.tuitv.ui.components.ConfirmDialog
import tv.tui.tuitv.ui.components.EmptyState
import tv.tui.tuitv.ui.components.Loading
import tv.tui.tuitv.ui.components.ListRow
import tv.tui.tuitv.ui.components.Muted
import tv.tui.tuitv.ui.components.PosterCard
import tv.tui.tuitv.ui.components.RemoteImage
import tv.tui.tuitv.ui.components.RequestFocus
import tv.tui.tuitv.ui.components.ScreenTitle
import tv.tui.tuitv.ui.components.SectionTitle
import tv.tui.tuitv.ui.components.TvTextField
import tv.tui.tuitv.ui.components.rememberFocusMemory
import tv.tui.tuitv.ui.library
import tv.tui.tuitv.ui.navigator
import tv.tui.tuitv.ui.play
import tv.tui.tuitv.ui.rememberFavoriteToggle
import tv.tui.tuitv.ui.theme.TuiColors
import tv.tui.tuitv.ui.toaster
import tv.tui.tuitv.data.RemoteCatalog
import tv.tui.tuitv.ui.components.ErrorText
import tv.tui.core.normalizeText
import tv.tui.tuitv.ui.device
import tv.tui.tuitv.ui.components.ButtonRow
import tv.tui.tuitv.ui.components.FillButtons
import tv.tui.tuitv.ui.components.Chip
import tv.tui.tuitv.ui.components.IconAction
import tv.tui.tuitv.ui.components.tapToClick
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign

private const val ROW = 20

/** Posição (s) a partir da qual vale oferecer "continuar". */
private const val RESUME_MIN = RESUME_MIN_SEC

private fun HistoryEntry.resumable() = !completed && position >= RESUME_MIN && kind != ContentKind.LIVE.id

private fun HistoryEntry.fraction() = if (duration > 0) position.toFloat() / duration else 0f

/** Abre o player a partir de uma entrada do histórico (retomando filmes e episódios). */
@Composable
fun rememberHistoryPlayer(): (HistoryEntry) -> Unit {
    val library = library()
    val navigator = navigator()
    val toaster = toaster()
    val scope = rememberCoroutineScope()
    return { entry ->
        scope.launch {
            val item = library.item(entry.itemId)
            if (item == null) {
                toaster.show("Este item não está mais nas suas listas.")
                return@launch
            }
            val resume = if (entry.resumable()) entry.position else null
            val queue = item.series?.let { library.episodes(item.playlistId, it.seriesKey).first() }?.let { eps ->
                groupSeries(eps).firstOrNull()?.seasons?.flatMap { it.episodes }
            } ?: listOf(item)
            navigator.play(queue, item, resume)
        }
    }
}

/**
 * Episódio para continuar a série (mesma regra da Web e da Samsung): o mais adiante já assistido
 * ou, se ele terminou, o seguinte — com a posição de retomada, quando houver.
 */
private fun continueTarget(series: SeriesGroup, history: Map<String, HistoryEntry>): Pair<MediaItem, Long?> {
    val target = continueEpisode(series) { id -> history[id]?.let { EpisodeProgress(it.position, it.completed) } }
        ?: return series.seasons.first().episodes.first() to null
    return target.episode to history[target.episode.id]?.takeIf { target.resume && it.resumable() }?.position
}

/** Continua, a partir do histórico, a série de um episódio (estilo Netflix). */
@Composable
fun rememberSeriesContinue(): (HistoryEntry) -> Unit {
    val library = library()
    val navigator = navigator()
    val toaster = toaster()
    val scope = rememberCoroutineScope()
    return { entry ->
        scope.launch {
            val sid = entry.seriesId
            val key = sid?.removePrefix("${entry.playlistId}:s:")
            // Login: os episódios vêm do servidor antes de escolher o episódio.
            val series = key?.let { groupSeries(library.episodes(entry.playlistId, it).first()).firstOrNull() }
            if (sid == null || series == null) {
                toaster.show("Esta série não está mais nas suas listas.")
                return@launch
            }
            val history = library.seriesHistory(sid).first().associateBy { it.itemId }
            val (episode, resume) = continueTarget(series, history)
            navigator.play(series.seasons.flatMap { it.episodes }, episode, resume)
        }
    }
}

/** Foco compartilhado pelas fileiras de uma tela: qual fileira/cartão lembrar e onde começar. */
private class RowsFocus(val memory: RowsFocusMemory, val rows: Set<String>) {
    val fallback = rows.firstOrNull()
}

/**
 * Margem lateral das fileiras: na TV, espaço para o cartão crescer e brilhar no foco sem ser
 * cortado; no toque, a margem da tela (as fileiras correm até a borda ao rolar, como na Netflix).
 */
@Composable
private fun rowInset() = if (device().tv) 14.dp else 16.dp

/**
 * Fileira horizontal com título, no estilo Netflix: o cartão em foco fica sempre na mesma posição
 * (a fileira desliza por baixo dele) e, ao voltar para a fileira com ▲▼, o foco retorna ao cartão
 * em que estava — em vez de cair no cartão "mais próximo" na tela.
 */
private fun <T> LazyListScope.contentRow(title: String, values: List<T>, key: (T) -> String, focus: RowsFocus?, card: @Composable (T, Modifier) -> Unit) {
    if (values.isEmpty()) return
    item(key = "title:$title") { SectionTitle(title, Modifier.padding(start = rowInset(), top = if (device().tv) 8.dp else 4.dp)) }
    item(key = "row:$title") {
        val inset = with(LocalDensity.current) { rowInset().toPx() }
        val tv = device().tv
        // Guardado pela própria lista vertical: sobrevive à fileira sair da tela e voltar.
        val entry = rememberFocusMemory("row:$title")
        RowPivot(inset) {
            LazyRow(
                Modifier.fillMaxWidth().then(entry.group()),
                horizontalArrangement = Arrangement.spacedBy(if (tv) 20.dp else 10.dp),
                contentPadding = PaddingValues(horizontal = rowInset(), vertical = if (tv) 16.dp else 8.dp),
            ) {
                itemsIndexed(values, key = { _, v -> key(v) }) { index, value ->
                    val screen = focus?.memory?.item(title, index, focus.fallback, focus.rows) ?: Modifier
                    card(value, screen.then(entry.item(index)))
                }
            }
        }
    }
}

/** Lista vertical de fileiras: a fileira em foco para logo abaixo do topo, com o título visível. */
@Composable
private fun RowsColumn(state: LazyListState = rememberLazyListState(), content: LazyListScope.() -> Unit) {
    val offset = with(LocalDensity.current) { 52.dp.toPx() }
    ColumnPivot(fraction = 0f, offsetPx = offset) {
        LazyColumn(Modifier.fillMaxSize(), state = state, contentPadding = PaddingValues(bottom = 64.dp), content = content)
    }
    // As fileiras chegam depois de a tela abrir: ao voltar de um título, a rolagem não se perde.
    KeepScroll(state)
}

@Composable
fun HomeScreen() {
    val library = library()
    val navigator = navigator()
    val toggleFavorite = rememberFavoriteToggle()
    val playHistory = rememberHistoryPlayer()
    val history by library.history.collectAsStateWithLifecycle(emptyList())
    val favorites by library.favorites.collectAsStateWithLifecycle(emptyList())
    val live by remember { library.firstOfKind(ContentKind.LIVE, ROW) }.collectAsStateWithLifecycle(emptyList())
    val movies by remember { library.firstOfKind(ContentKind.MOVIE, ROW) }.collectAsStateWithLifecycle(emptyList())
    // Com login, a fileira traz a primeira categoria do servidor (não o catálogo inteiro).
    val series by remember { library.firstSeries(ROW) }.collectAsStateWithLifecycle(emptyList())
    val hasContent by library.hasContent.collectAsStateWithLifecycle(true)

    // Séries no estilo Netflix: um único cartão por série, que continua do episódio mais adiante já assistido.
    val resume by library.continueWatching.collectAsStateWithLifecycle(emptyList())
    // Cartões de "Continuar assistindo" abrem a página do item (a série com o botão no episódio certo).
    val openSeries = { entry: HistoryEntry -> navigator.open(Route.SeriesDetail(entry.playlistId, entry.seriesId!!.removePrefix("${entry.playlistId}:s:"))) }
    val recentChannels = history.filter { it.kind == ContentKind.LIVE.id }.take(ROW)
    val memory = rememberRowsFocusMemory("home")
    val rows = linkedMapOf(
        Txt.CONTINUE to resume, "Canais recentes" to recentChannels, Txt.FAVORITES to favorites,
        "Canais ao vivo" to live, Txt.MOVIES to movies, Txt.SERIES to series,
    ).filterValues { it.isNotEmpty() }.keys
    val focus = RowsFocus(memory, rows)
    val tv = device().tv

    RowsColumn {
        if (tv) {
            item(key = "header") { ScreenTitle(Txt.HOME, Modifier.padding(start = rowInset()), subtitle = Txt.TAGLINE) }
        } else {
            // Toque: o destaque grande no topo, como o "billboard" do app da Netflix.
            val movie = movies.firstOrNull { it.logo != null }
            val show = series.firstOrNull { it.logo != null }
            when {
                movie != null -> item(key = "billboard") {
                    Billboard(
                        title = movie.name,
                        image = movie.logo,
                        meta = listOfNotNull(movie.year?.toString(), movie.group).joinToString("  ·  "),
                        favoriteId = movie.id,
                        onOpen = { navigator.open(Route.MovieDetail(movie.id)) },
                        onPlay = { navigator.play(listOf(movie), movie) },
                        onFavorite = { toggleFavorite(movie.id, movie.kind, movie.playlistId) },
                    )
                }
                show != null -> item(key = "billboard") {
                    Billboard(
                        title = show.title,
                        image = show.logo,
                        meta = if (show.episodes > 0) Txt.plural(show.episodes, "episódio", "episódios") else show.year?.toString() ?: "",
                        favoriteId = show.id,
                        onOpen = { navigator.open(Route.SeriesDetail(show.playlistId, show.seriesKey)) },
                        onPlay = { navigator.open(Route.SeriesDetail(show.playlistId, show.seriesKey)) },
                        onFavorite = { toggleFavorite(show.id, ContentKind.SERIES, show.playlistId) },
                    )
                }
            }
        }
        if (!hasContent) item(key = "empty") { EmptyState(Txt.EMPTY_LIBRARY) }
        contentRow(Txt.CONTINUE, resume.take(ROW), { row -> row.entry.seriesId.takeIf { row.episodes != null } ?: row.entry.itemId }, focus) { row, m ->
            val entry = row.entry
            if (row.episodes != null) {
                val label = if ((entry.season ?: 0) > 0 || (entry.episode ?: 0) > 0) Txt.episodeLabel(entry.season ?: 0, entry.episode ?: 0) else null
                val caption = listOfNotNull(label, if (entry.resumable()) Txt.clock(entry.position) + " / " + Txt.clock(entry.duration) else null).joinToString(" · ")
                ChannelCard(entry.seriesTitle ?: entry.name, entry.seriesLogo ?: entry.logo, { openSeries(entry) }, m, caption = caption.ifEmpty { null }, progress = if (entry.resumable()) entry.fraction() else null)
            } else {
                // Filme: abre a ficha, como nas outras fileiras.
                ChannelCard(entry.name, entry.logo, { navigator.open(Route.MovieDetail(entry.itemId)) }, m, caption = Txt.clock(entry.position) + " / " + Txt.clock(entry.duration), progress = entry.fraction())
            }
        }
        contentRow("Canais recentes", recentChannels, { it.itemId }, focus) { entry, m ->
            ChannelCard(entry.name, entry.logo, { playHistory(entry) }, m)
        }
        contentRow(Txt.FAVORITES, favorites, { it.favorite.id }, focus) { fav, m ->
            FavoriteCard(fav, navigator, m)
        }
        contentRow("Canais ao vivo", live, { it.id }, focus) { item, m ->
            ChannelCard(item.name, item.logo, { navigator.play(live, item) }, m, onLongClick = { toggleFavorite(item.id, item.kind, item.playlistId) })
        }
        contentRow(Txt.MOVIES, movies, { it.id }, focus) { item, m ->
            PosterCard(item.name, item.logo, { navigator.open(Route.MovieDetail(item.id)) }, m, onLongClick = { toggleFavorite(item.id, item.kind, item.playlistId) }, caption = item.year?.toString())
        }
        contentRow(Txt.SERIES, series.take(ROW), { it.id }, focus) { s, m ->
            SeriesPoster(s, navigator, m)
        }
    }
    // Só na chegada à tela (ou quando a primeira fileira aparece): nunca rouba o foco depois.
    if (rows.isNotEmpty()) RequestFocus(memory.requester, rows.isNotEmpty())
}

@Composable
private fun SeriesPoster(s: SeriesCard, navigator: Navigator, modifier: Modifier) {
    val toggleFavorite = rememberFavoriteToggle()
    PosterCard(
        s.title, s.logo, { navigator.open(Route.SeriesDetail(s.playlistId, s.seriesKey)) }, modifier,
        onLongClick = { toggleFavorite(s.id, ContentKind.SERIES, s.playlistId) },
        caption = if (s.episodes > 0) Txt.plural(s.episodes, "episódio", "episódios") else null,
    )
}

@Composable
private fun FavoriteCard(fav: FavoriteEntry, navigator: Navigator, modifier: Modifier) {
    val toggleFavorite = rememberFavoriteToggle()
    when (fav) {
        is FavoriteEntry.Series -> SeriesPoster(fav.series, navigator, modifier)
        is FavoriteEntry.Item -> {
            val item = fav.item
            if (item.kind == ContentKind.LIVE) {
                ChannelCard(item.name, item.logo, { navigator.play(listOf(item), item) }, modifier, onLongClick = { toggleFavorite(item.id, item.kind, item.playlistId) })
            } else {
                PosterCard(item.name, item.logo, { navigator.open(Route.MovieDetail(item.id)) }, modifier, onLongClick = { toggleFavorite(item.id, item.kind, item.playlistId) })
            }
        }
    }
}

@Composable
fun FavoritesScreen() {
    val library = library()
    val navigator = navigator()
    val toggleFavorite = rememberFavoriteToggle()
    val favorites by library.favorites.collectAsStateWithLifecycle(null)
    val list = favorites
    val memory = rememberRowsFocusMemory("favorites")
    val tv = device().tv
    Column(Modifier.fillMaxSize()) {
        ScreenTitle(Txt.FAVORITES, Modifier.padding(start = rowInset()), subtitle = Txt.longPressHint(tv).replace("favoritar", "remover"))
        if (list == null) return@Column
        if (list.isEmpty()) {
            EmptyState(Txt.emptyFavorites(tv))
            return@Column
        }
        val channels = list.mapNotNull { (it as? FavoriteEntry.Item)?.item?.takeIf { i -> i.kind == ContentKind.LIVE } }
        val movies = list.mapNotNull { (it as? FavoriteEntry.Item)?.item?.takeIf { i -> i.kind != ContentKind.LIVE } }
        val series = list.mapNotNull { (it as? FavoriteEntry.Series)?.series }
        val rows = linkedMapOf("Canais" to channels, Txt.MOVIES to movies, Txt.SERIES to series).filterValues { it.isNotEmpty() }.keys
        val rowsFocus = RowsFocus(memory, rows)
        RowsColumn {
            contentRow("Canais", channels, { it.id }, rowsFocus) { item, m ->
                ChannelCard(item.name, item.logo, { navigator.play(channels, item) }, m, onLongClick = { toggleFavorite(item.id, item.kind, item.playlistId) })
            }
            contentRow(Txt.MOVIES, movies, { it.id }, rowsFocus) { item, m ->
                PosterCard(item.name, item.logo, { navigator.open(Route.MovieDetail(item.id)) }, m, onLongClick = { toggleFavorite(item.id, item.kind, item.playlistId) })
            }
            contentRow(Txt.SERIES, series, { it.id }, rowsFocus) { s, m -> SeriesPoster(s, navigator, m) }
        }
        RequestFocus(memory.requester, rows.isNotEmpty())
    }
}

@Composable
fun HistoryScreen() {
    val library = library()
    val playHistory = rememberHistoryPlayer()
    val continueSeries = rememberSeriesContinue()
    val history by library.history.collectAsStateWithLifecycle(null)
    var confirmClear by remember { mutableStateOf(false) }
    val memory = rememberFocusMemory("history")
    // Séries no estilo Netflix: uma linha por série, representada pelo episódio mais adiante já assistido.
    val list = remember(history) {
        history?.let { h -> collapseSeriesHistory(h, { e -> e.seriesId.takeIf { e.kind == ContentKind.SERIES.id } }) { EpisodeOrder(it.season, it.episode, it.playedAt) } }
    }
    val device = device()
    Column(Modifier.fillMaxSize().padding(horizontal = device.gutter)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            ScreenTitle(Txt.HISTORY, Modifier.weight(1f), subtitle = if (device.tv) "Mantenha OK pressionado para remover um item." else "Toque e segure para remover um item.")
            if (!list.isNullOrEmpty()) {
                if (device.compact) IconAction(Icons.Filled.Delete, "Limpar histórico", { confirmClear = true })
                else ActionButton("Limpar histórico", { confirmClear = true }, icon = Icons.Filled.Delete)
            }
        }
        when {
            list == null -> Unit
            list.isEmpty() -> EmptyState(Txt.EMPTY_HISTORY)
            else -> {
                ColumnPivot {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp), contentPadding = PaddingValues(if (device.tv) 6.dp else 0.dp, 8.dp, if (device.tv) 6.dp else 0.dp, 48.dp)) {
                    itemsIndexed(list, key = { _, row -> row.entry.seriesId.takeIf { row.episodes != null } ?: row.entry.itemId }) { index, row ->
                        val entry = row.entry
                        val series = row.episodes != null
                        val kind = when {
                            entry.kind == ContentKind.LIVE.id -> "Canal"
                            entry.kind == ContentKind.MOVIE.id -> "Filme"
                            series -> "Série"
                            else -> "Episódio"
                        }
                        val episodeLabel = if (series && ((entry.season ?: 0) > 0 || (entry.episode ?: 0) > 0)) Txt.episodeLabel(entry.season ?: 0, entry.episode ?: 0) else null
                        val detail = when {
                            entry.kind == ContentKind.LIVE.id -> null
                            entry.completed -> "assistido"
                            entry.duration > 0 -> "${Txt.clock(entry.position)} de ${Txt.clock(entry.duration)}"
                            else -> null
                        }
                        val title = if (series) entry.seriesTitle ?: entry.name else entry.name
                        val logo = if (series) entry.seriesLogo ?: entry.logo else entry.logo
                        ListRow(
                            title = title,
                            subtitle = listOfNotNull(kind, episodeLabel, detail).joinToString(" · "),
                            trailing = Txt.ago(row.episodes?.first()?.playedAt ?: entry.playedAt),
                            progress = if (entry.resumable()) entry.fraction() else null,
                            onClick = { if (series) continueSeries(entry) else playHistory(entry) },
                            onLongClick = { if (series) library.removeSeriesHistory(entry.seriesId!!) else library.removeHistory(entry.itemId) },
                            leading = { RemoteImage(logo, title, Modifier.size(width = 72.dp, height = 44.dp)) },
                            modifier = memory.item(index),
                        )
                    }
                }
                }
                RequestFocus(memory.requester)
            }
        }
    }
    if (confirmClear) {
        ConfirmDialog("Limpar histórico", "Todo o histórico de reprodução deste aparelho será apagado.", "Limpar", {
            library.clearHistory()
            confirmClear = false
        }, { confirmClear = false })
    }
}

@Composable
fun SearchScreen() {
    val library = library()
    val navigator = navigator()
    val toggleFavorite = rememberFavoriteToggle()
    var query by rememberSaveable { mutableStateOf("") }
    var results by remember { mutableStateOf<SearchResults?>(null) }
    val hasRemote by library.hasRemote.collectAsStateWithLifecycle(false)
    val index by library.remoteSearchState.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    // A cada etapa do índice pronta, os resultados se atualizam (sem nova requisição).
    val indexStep = (index as? RemoteCatalog.IndexState.Loading)?.done ?: if (index is RemoteCatalog.IndexState.Ready) -1 else -2
    LaunchedEffect(query, indexStep) {
        delay(350)
        results = if (query.isBlank()) null else library.search(query)
        // Logins: o índice do servidor é preparado uma única vez, só quando a busca é usada de fato.
        if (hasRemote && normalizeText(query).length >= 2) library.prepareRemoteSearch()
    }
    val field = remember { FocusRequester() }
    RowsColumn {
        item(key = "header") {
            Column(Modifier.padding(horizontal = rowInset())) {
                ScreenTitle(Txt.SEARCH, subtitle = if (device().compact) "Canais, filmes e séries de todas as listas ativas." else "Canais, filmes e séries de todas as listas ativas. Sem acentos e sem diferenciar maiúsculas.")
                TvTextField(query, { query = it }, "Pesquisar", Modifier.widthIn(max = 560.dp).fillMaxWidth(), placeholder = "Nome do canal, filme ou série", imeAction = ImeAction.Search, focusRequester = field)
                Spacer(Modifier.height(16.dp))
                if (hasRemote && query.isNotBlank()) {
                    when (val st = index) {
                        is RemoteCatalog.IndexState.Loading -> Muted(
                            "Preparando a busca no catálogo do servidor (${st.done} de ${st.total})… Os resultados aparecem conforme ficam prontos.",
                            Modifier.padding(bottom = 12.dp),
                        )
                        is RemoteCatalog.IndexState.Failed -> Column(Modifier.padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            ErrorText("Não foi possível preparar a busca no servidor: ${Txt.importError(st.error)}")
                            ActionButton("Tentar novamente", { scope.launch { library.retryRemoteSearch() } }, icon = Icons.Filled.Refresh)
                        }
                        else -> Unit
                    }
                }
            }
        }
        val r = results
        if (r != null && r.isEmpty) item(key = "none") { EmptyState(Txt.NO_RESULTS) }
        if (r != null) {
            contentRow("Canais", r.live, { it.id }, null) { item, m ->
                ChannelCard(item.name, item.logo, { navigator.play(r.live, item) }, m, onLongClick = { toggleFavorite(item.id, item.kind, item.playlistId) }, caption = item.group)
            }
            contentRow(Txt.MOVIES, r.movies, { it.id }, null) { item, m ->
                PosterCard(item.name, item.logo, { navigator.open(Route.MovieDetail(item.id)) }, m, onLongClick = { toggleFavorite(item.id, item.kind, item.playlistId) }, caption = item.year?.toString())
            }
            contentRow(Txt.SERIES, r.series, { it.id }, null) { s, m -> SeriesPoster(s, navigator, m) }
        }
    }
    RequestFocus(field)
}

/**
 * Fundo das telas de detalhe (filmes e séries), como na Web e na Samsung: a capa preenche a tela,
 * bem desfocada e escurecida. O desfoque é barato: a capa é decodificada em 32x18 e apenas ampliada
 * (a interpolação já desfoca), sem filtro de GPU — que só existe no Android 12+ e pesa nas TVs.
 */
@Composable
private fun Backdrop(image: String?, modifier: Modifier = Modifier) {
    if (image == null) return
    val context = LocalPlatformContext.current
    val request = remember(image) { ImageRequest.Builder(context).data(image).size(32, 18).build() }
    Box(modifier.fillMaxSize()) {
        // Sem iniciais de reserva: se a imagem não carregar, o fundo fica só no azul-marinho.
        AsyncImage(request, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop, alpha = 0.9f)
        Box(Modifier.matchParentSize().background(TuiColors.Navy.copy(alpha = 0.45f)))
        Box(Modifier.matchParentSize().background(Brush.horizontalGradient(0f to TuiColors.Navy, 0.45f to TuiColors.Navy.copy(alpha = 0.75f), 1f to Color.Transparent)))
        Box(Modifier.matchParentSize().background(Brush.verticalGradient(0f to TuiColors.Navy.copy(alpha = 0.5f), 0.5f to Color.Transparent, 1f to TuiColors.Navy)))
    }
}

/**
 * Ficha do título: capa, nome, dados e sinopse (a tela antes do play, como na Netflix).
 * TV e tablet: capa à esquerda e texto ao lado. Celular: capa no topo sobre o fundo desfocado,
 * botões na largura da tela e sinopse embaixo. [actions] recebe o modificador de cada botão.
 */
@Composable
private fun TitleHeader(title: String, image: String?, meta: String, synopsis: String?, progress: Float? = null, actions: @Composable (Modifier) -> Unit) {
    val synopsisText = synopsis?.takeIf { it.isNotBlank() } ?: "Esta lista não informa a sinopse deste título."
    val synopsisColor = if (synopsis.isNullOrBlank()) TuiColors.Muted else TuiColors.White.copy(alpha = 0.9f)
    if (device().compact) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.fillMaxWidth().height(260.dp).clip(RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                if (image != null) AsyncImage(image, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop, alpha = 0.35f)
                Box(Modifier.matchParentSize().background(Brush.verticalGradient(0f to Color.Transparent, 1f to TuiColors.Navy)))
                Box(Modifier.width(160.dp).height(240.dp).clip(RoundedCornerShape(10.dp))) {
                    RemoteImage(image, title, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                    if (progress != null) ProgressLine(progress, Modifier.align(Alignment.BottomCenter), color = TuiColors.Danger)
                }
            }
            Text(title, style = MaterialTheme.typography.headlineSmall, maxLines = 3, overflow = TextOverflow.Ellipsis)
            if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.bodyMedium, color = TuiColors.Muted)
            FillButtons { Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { actions(Modifier.fillMaxWidth()) } }
            Text(synopsisText, style = MaterialTheme.typography.bodyMedium, color = synopsisColor)
        }
        return
    }
    Row(Modifier.fillMaxWidth().padding(top = 24.dp, start = rowInset())) {
        Box(Modifier.width(200.dp).height(300.dp).clip(RoundedCornerShape(12.dp))) {
            RemoteImage(image, title, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            if (progress != null) ProgressLine(progress, Modifier.align(Alignment.BottomCenter), color = TuiColors.Danger)
        }
        Spacer(Modifier.width(40.dp))
        Column(Modifier.weight(1f, fill = false).widthIn(max = 620.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = MaterialTheme.typography.displaySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.titleMedium, color = TuiColors.Muted)
            Text(synopsisText, style = MaterialTheme.typography.bodyLarge, color = synopsisColor, maxLines = 6, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(8.dp))
            ButtonRow(horizontalSpacing = 14.dp) { actions(Modifier) }
        }
    }
}

/**
 * Destaque do Início no toque: capa grande com título e os botões Assistir e Favoritar.
 * Tocar na capa abre a ficha.
 */
@Composable
private fun Billboard(title: String, image: String?, meta: String, favoriteId: String, onOpen: () -> Unit, onPlay: () -> Unit, onFavorite: () -> Unit) {
    val library = library()
    val favorite by remember(favoriteId) { library.isFavorite(favoriteId) }.collectAsStateWithLifecycle(false)
    val interaction = remember { MutableInteractionSource() }
    Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), contentAlignment = Alignment.TopCenter) {
        Box(
            Modifier
                .widthIn(max = 420.dp)
                .fillMaxWidth()
                .aspectRatio(0.72f)
                .clip(RoundedCornerShape(16.dp))
                .background(TuiColors.NavyRaised)
                .semantics(mergeDescendants = false) { onClick(label = title) { onOpen(); true } }
                .tapToClick(interaction, onClick = onOpen),
        ) {
            RemoteImage(image, title, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            Box(Modifier.matchParentSize().background(Brush.verticalGradient(0.45f to Color.Transparent, 1f to TuiColors.NavyDeep.copy(alpha = 0.96f))))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(title, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (meta.isNotEmpty()) Muted(meta, maxLines = 1)
                Spacer(Modifier.height(6.dp))
                FillButtons { Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ActionButton("Assistir", onPlay, Modifier.weight(1f), Icons.Filled.PlayArrow, primary = true)
                    ActionButton(if (favorite) "Favorito" else "Favoritar", onFavorite, Modifier.weight(1f), if (favorite) Icons.Filled.Check else Icons.Filled.Add)
                } }
            }
        }
    }
}

@Composable
fun MovieDetailScreen(itemId: String) {
    val library = library()
    val navigator = navigator()
    val toggleFavorite = rememberFavoriteToggle()
    val item by produceState<MediaItem?>(null, itemId) { value = library.item(itemId) }
    val entry by produceState<HistoryEntry?>(null, itemId) { value = library.historyEntry(itemId) }
    val favorite by remember(itemId) { library.isFavorite(itemId) }.collectAsStateWithLifecycle(false)
    val focus = remember { FocusRequester() }
    val movie = item ?: return
    val resume = entry?.takeIf { it.resumable() }
    val device = device()
    // Toque: a ficha rola (no celular ela é mais alta que a tela).
    val container = if (device.tv) Modifier.fillMaxSize() else Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = device.gutter).padding(bottom = 32.dp)
    Box(container) {
        if (!device.compact) Backdrop(movie.logo)
        TitleHeader(
            title = movie.name,
            image = movie.logo,
            meta = listOfNotNull(movie.year?.toString(), movie.duration?.let { Txt.duration(it) }, movie.group).joinToString("  ·  "),
            synopsis = movie.description,
            progress = resume?.fraction(),
        ) {
            m ->
            if (resume != null) {
                ActionButton("Continuar de ${Txt.clock(resume.position)}", { navigator.play(listOf(movie), movie, resume.position) }, m.focusRequester(focus), Icons.Filled.PlayArrow, primary = true)
                ActionButton("Do início", { navigator.play(listOf(movie), movie) }, m, icon = Icons.Filled.Refresh)
            } else {
                ActionButton("Assistir", { navigator.play(listOf(movie), movie) }, m.focusRequester(focus), Icons.Filled.PlayArrow, primary = true)
            }
            ActionButton(
                if (favorite) "Nos favoritos" else "Favoritar",
                { toggleFavorite(movie.id, movie.kind, movie.playlistId) },
                m,
                icon = if (favorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
            )
        }
    }
    RequestFocus(focus, resume != null)
}

@Composable
fun SeriesDetailScreen(playlistId: String, seriesKey: String) {
    val library = library()
    val navigator = navigator()
    val toggleFavorite = rememberFavoriteToggle()
    val id = seriesId(playlistId, seriesKey)
    val episodes by remember(id) { library.episodes(playlistId, seriesKey) }.collectAsStateWithLifecycle(null)
    val history by remember(id) { library.seriesHistory(id) }.collectAsStateWithLifecycle(emptyList())
    val favorite by remember(id) { library.isFavorite(id) }.collectAsStateWithLifecycle(false)
    val group = remember(episodes) { episodes?.let { groupSeries(it).firstOrNull() } }
    var seasonIndex by rememberSaveable(id) { mutableIntStateOf(-1) }
    val playFocus = remember { FocusRequester() }
    val memory = rememberFocusMemory(id, seasonIndex)
    // Entrar na fileira de temporadas leva sempre à temporada escolhida.
    val seasonFocus = remember { FocusMemory(0) }
    val errors by library.remoteErrors.collectAsStateWithLifecycle()
    val series = group ?: run {
        when {
            // Série de login: episódios a caminho do servidor.
            episodes == null -> Loading()
            episodes?.isEmpty() == true -> EmptyState(errors[playlistId]?.let(Txt::importError) ?: Txt.EMPTY_GROUP)
        }
        return
    }
    val byItem = history.associateBy { it.itemId }
    val flat = series.seasons.flatMap { it.episodes }
    // Mesma regra do histórico: o episódio mais adiante já assistido ou, se ele terminou, o seguinte.
    val target = continueTarget(series, byItem)
    if (seasonIndex < 0) seasonIndex = series.seasons.indexOfFirst { s -> s.episodes.any { it.id == target.first.id } }.coerceAtLeast(0)
    val season = series.seasons.getOrNull(seasonIndex) ?: series.seasons.first()
    // Grade de episódios (listas sem dados por episódio): colunas pela largura do aparelho.
    val screen = device()
    val gridColumns = when {
        screen.compact -> 2
        screen.tv -> 5
        else -> 4
    }
    val gridGap = if (screen.tv) 16.dp else 10.dp

    Box(Modifier.fillMaxSize()) {
    // Mesmo fundo da ficha do filme: a capa da série desfocada.
    if (!device().compact) Backdrop(series.logo)
    ColumnPivot {
    LazyColumn(Modifier.fillMaxSize().focusRestorer(), verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(rowInset(), 8.dp, rowInset(), 48.dp)) {
        item(key = "header") {
            val (ep, position) = target
            TitleHeader(
                title = series.title,
                image = series.logo,
                meta = listOfNotNull(Txt.plural(series.seasons.size, "temporada", "temporadas"), Txt.plural(series.episodeCount, "episódio", "episódios"), series.group).joinToString("  ·  "),
                synopsis = flat.firstNotNullOfOrNull { it.description?.takeIf { d -> d.isNotBlank() } },
            ) { m ->
                val label = (if (position != null) "Continuar " else "Assistir ") + Txt.episodeLabel(ep.series!!.season, ep.series!!.episode)
                ActionButton(label, { navigator.play(flat, ep, position) }, m.focusRequester(playFocus), Icons.Filled.PlayArrow, primary = true)
                ActionButton(
                    if (favorite) "Nos favoritos" else "Favoritar",
                    { toggleFavorite(id, ContentKind.SERIES, playlistId) },
                    m,
                    icon = if (favorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                )
            }
        }
        if (series.seasons.size > 1) {
            item(key = "seasons") {
                // ▲ a partir dos episódios volta à temporada escolhida (não à mais próxima na tela).
                val tv = device().tv
                LazyRow(Modifier.then(seasonFocus.group()), horizontalArrangement = Arrangement.spacedBy(if (tv) 12.dp else 8.dp), contentPadding = PaddingValues(horizontal = if (tv) rowInset() else 0.dp, vertical = if (tv) 16.dp else 8.dp)) {
                    itemsIndexed(series.seasons, key = { _, s -> s.season }) { index, s ->
                        val label = if (s.season > 0) "Temporada ${s.season}" else "Episódios"
                        val m = if (index == seasonIndex) Modifier.focusRequester(seasonFocus.requester) else Modifier
                        if (tv) ActionButton(label, { seasonIndex = index }, m, primary = index == seasonIndex)
                        else Chip(label, index == seasonIndex, { seasonIndex = index }, m)
                    }
                }
            }
        }
        // Com miniaturas ou sinopses próprias, cartões no estilo Netflix; sem, uma grade compacta e fácil de percorrer.
        if (hasEpisodeDetails(season.episodes, series.logo)) {
            itemsIndexed(season.episodes, key = { _, e -> e.id }) { index, ep ->
                val h = byItem[ep.id]
                val number = ep.series!!.episode
                EpisodeCard(
                    number = number,
                    title = episodeTitle(ep.name, series.title) ?: if (number > 0) "Episódio $number" else ep.name,
                    image = ep.logo ?: series.logo,
                    onClick = { navigator.play(flat, ep, h?.takeIf { it.resumable() }?.position) },
                    modifier = memory.item(index),
                    duration = ep.duration?.let { Txt.duration(it) },
                    synopsis = ep.description,
                    watched = h?.completed == true,
                    progress = h?.takeIf { it.resumable() }?.fraction(),
                )
            }
        } else {
            val columns = gridColumns
            val rows = season.episodes.withIndex().chunked(columns)
            items(rows, key = { row -> "grid:" + row.first().value.id }) { row ->
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(gridGap)) {
                    for ((index, ep) in row) {
                        val h = byItem[ep.id]
                        EpisodeTile(
                            number = ep.series!!.episode,
                            title = episodeTitle(ep.name, series.title),
                            onClick = { navigator.play(flat, ep, h?.takeIf { it.resumable() }?.position) },
                            modifier = Modifier.weight(1f).then(memory.item(index)),
                            duration = ep.duration?.let { Txt.duration(it) },
                            watched = h?.completed == true,
                            next = ep.id == target.first.id,
                            progress = h?.takeIf { it.resumable() }?.fraction(),
                        )
                    }
                    repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
    }
    }
    RequestFocus(playFocus)
}
