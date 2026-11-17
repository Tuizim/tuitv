package tv.tui.tuitv.data

import android.net.Uri
import android.util.Log
import androidx.room.withTransaction
import java.security.SecureRandom
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import tv.tui.core.ContentKind
import tv.tui.core.EpgIndex
import tv.tui.core.EpgIndexEntry
import tv.tui.core.GroupCount
import tv.tui.core.MediaItem
import tv.tui.core.NowNext
import tv.tui.core.Parental
import tv.tui.core.Playback
import tv.tui.core.buildEpgIndex
import tv.tui.core.cleanName
import tv.tui.core.nowNext
import tv.tui.core.normalizeText
import tv.tui.core.resolveEpgChannel
import tv.tui.core.searchIn
import tv.tui.core.toSearchable
import tv.tui.core.Xtream
import tv.tui.core.XtreamLogin
import tv.tui.tuitv.data.db.AppDatabase
import tv.tui.tuitv.data.db.EpgSourceEntity
import tv.tui.tuitv.data.db.FavoriteEntity
import tv.tui.tuitv.data.db.HistoryEntity
import tv.tui.tuitv.data.db.ItemEntity
import tv.tui.tuitv.data.db.PlaylistEntity

/** Tarefa de importação exibida na interface (listas, guias e backups). */
data class ImportJob(
    val id: String,
    val kind: Kind,
    val name: String,
    val progress: ImportProgress? = null,
    val error: ImportException? = null,
    val done: Boolean = false,
) {
    enum class Kind { PLAYLIST, EPG }
    val running get() = !done && error == null
}

/** Filtro de categoria nas telas de catálogo. */
sealed interface GroupFilter {
    data object All : GroupFilter
    data object None : GroupFilter
    data class Named(val name: String) : GroupFilter
}

data class SearchResults(val live: List<MediaItem>, val movies: List<MediaItem>, val series: List<SeriesCard>) {
    val isEmpty get() = live.isEmpty() && movies.isEmpty() && series.isEmpty()
}

/** Favorito já resolvido para exibição. */
sealed interface FavoriteEntry {
    val favorite: FavoriteEntity
    data class Item(override val favorite: FavoriteEntity, val item: MediaItem) : FavoriteEntry
    data class Series(override val favorite: FavoriteEntity, val series: SeriesCard) : FavoriteEntry
}

private const val HISTORY_LIMIT = 500
private const val RETRY_AFTER_FAILURE = 3_600_000L

fun newId(): String {
    val bytes = ByteArray(8).also(SecureRandom()::nextBytes)
    return bytes.joinToString("") { "%02x".format(it) }
}

/** Repositório do aplicativo: tudo é local; nenhuma função depende de servidor próprio. */
@OptIn(ExperimentalCoroutinesApi::class)
class Library(
    private val db: AppDatabase,
    val settingsStore: SettingsStore,
    val net: Net,
    internal val scope: CoroutineScope,
) {
    private val importer = Importer(db)
    private val refreshLock = Mutex()

    // ---------------------------------------------------------------- estado

    private val _jobs = MutableStateFlow<List<ImportJob>>(emptyList())
    val jobs: StateFlow<List<ImportJob>> = _jobs.asStateFlow()

    /** Sessão desbloqueada com o PIN (vale até o aplicativo ser fechado). */
    private val _unlocked = MutableStateFlow(false)
    val unlocked: StateFlow<Boolean> = _unlocked.asStateFlow()

    val settings get() = settingsStore.settings

    private val restriction: Flow<((String?, String) -> Boolean)?> = combine(settingsStore.settings, _unlocked) { s, unlocked ->
        Parental.restriction(s.parental.enabled, s.parental.hideAdult, s.parental.lockedGroups, unlocked)
    }.distinctUntilChanged()

    val playlists: StateFlow<List<Playlist>?> = db.playlists().observe()
        .map { list -> list.map { it.toModel() } }
        .flowOn(Dispatchers.Default)
        .stateIn(scope, SharingStarted.Eagerly, null)

    val epgSources: StateFlow<List<EpgSource>> = db.epg().observeSources()
        .map { list -> list.map { it.toModel() } }
        .flowOn(Dispatchers.Default)
        .stateIn(scope, SharingStarted.Eagerly, emptyList())

    private val epgIndex: StateFlow<EpgIndex?> = db.epg().observeChannels()
        .map { channels ->
            if (channels.isEmpty()) null
            else buildEpgIndex(channels.map { EpgIndexEntry(it.id, it.channelId, it.displayNames.split('\u0001')) })
        }
        .flowOn(Dispatchers.Default)
        .stateIn(scope, SharingStarted.Eagerly, null)

    /** Muda quando o guia é atualizado, para as telas recarregarem a programação. */
    val epgVersion: Flow<Int> = epgIndex.map { it?.byId?.size ?: 0 }

    // ---------------------------------------------------------------- catálogo

    private fun Flow<List<ItemEntity>>.visible(): Flow<List<MediaItem>> = combine(this, restriction) { list, blocked ->
        list.asSequence().filter { blocked == null || !blocked(it.group, it.name) }.map { it.toItem() }.toList()
    }.flowOn(Dispatchers.Default)

    fun groups(kind: ContentKind): Flow<List<GroupCount>> = combine(db.items().groups(kind.id), restriction) { rows, blocked ->
        rows.filter { row -> blocked == null || !blocked(row.group, "") }
            .map { GroupCount(it.group ?: "", it.count) }
    }.flowOn(Dispatchers.Default)

    fun items(kind: ContentKind, filter: GroupFilter): Flow<List<MediaItem>> = when (filter) {
        GroupFilter.All -> db.items().byKind(kind.id)
        GroupFilter.None -> db.items().withoutGroup(kind.id)
        is GroupFilter.Named -> db.items().byGroup(kind.id, filter.name)
    }.visible()

    fun firstOfKind(kind: ContentKind, limit: Int): Flow<List<MediaItem>> = db.items().firstOfKind(kind.id, limit * 2).visible().map { it.take(limit) }

    fun series(filter: GroupFilter): Flow<List<SeriesCard>> {
        val source = db.items().series((filter as? GroupFilter.Named)?.name)
        return combine(source, restriction) { rows, blocked ->
            rows.asSequence()
                .filter { filter !is GroupFilter.None || it.group == null }
                .filter { blocked == null || !blocked(it.group, it.title) }
                .map { it.toCard() }
                .toList()
        }.flowOn(Dispatchers.Default)
    }

    fun episodes(playlistId: String, seriesKey: String): Flow<List<MediaItem>> = db.items().episodes(playlistId, seriesKey).visible()

    val hasContent: Flow<Boolean> = db.items().countActive().map { it > 0 }.distinctUntilChanged()

    suspend fun item(id: String): MediaItem? = withContext(Dispatchers.IO) { db.items().get(id)?.toItem() }

    /** Busca local sem acentos: o banco filtra pelo primeiro termo e a ordenação segue as regras da Web. */
    suspend fun search(query: String, limit: Int = 60): SearchResults = withContext(Dispatchers.Default) {
        val terms = normalizeText(query).split(' ').filter { it.isNotEmpty() }
        if (terms.isEmpty()) return@withContext SearchResults(emptyList(), emptyList(), emptyList())
        val blocked = currentRestriction()
        val candidates = db.items().searchTerm(terms.maxBy { it.length }, 5000)
            .filter { blocked == null || !blocked(it.group, it.name) }
            .map { it.toItem() }
        val ranked = searchIn(toSearchable(candidates) { it.series?.let { s -> "${it.name} ${s.title}" } ?: it.name }, query, 5000)
        val series = LinkedHashMap<String, SeriesCard>()
        for (item in ranked) {
            val info = item.series ?: continue
            val id = tv.tui.core.seriesId(item.playlistId, info.seriesKey)
            if (!series.containsKey(id)) series[id] = SeriesCard(id, item.playlistId, info.seriesKey, info.title, item.logo, item.group, item.year, 0)
        }
        SearchResults(
            live = ranked.filter { it.kind == ContentKind.LIVE }.take(limit),
            movies = ranked.filter { it.kind == ContentKind.MOVIE }.take(limit),
            series = series.values.take(limit),
        )
    }

    private fun currentRestriction(): ((String?, String) -> Boolean)? {
        val p = settingsStore.current.parental
        return Parental.restriction(p.enabled, p.hideAdult, p.lockedGroups, _unlocked.value)
    }

    // ---------------------------------------------------------------- controle parental

    fun unlock(pin: String): Boolean {
        val p = settingsStore.current.parental
        val ok = Parental.verifyPin(pin, p.pinHash, p.pinSalt)
        if (ok) _unlocked.value = true
        return ok
    }

    fun lock() {
        _unlocked.value = false
    }

    // ---------------------------------------------------------------- favoritos e histórico

    val favorites: Flow<List<FavoriteEntry>> = combine(db.favorites().observe(), restriction) { favs, blocked -> favs to blocked }
        .mapLatest { (favs, blocked) ->
            val items = db.items().getMany(favs.filter { !it.id.contains(":s:") }.map { it.id }).associateBy { it.id }
            favs.mapNotNull { fav ->
                if (fav.id.contains(":s:")) {
                    val seriesKey = fav.id.substringAfter(":s:")
                    val first = db.items().forSeriesFirst(fav.playlistId, seriesKey) ?: return@mapNotNull null
                    if (blocked != null && blocked(first.group, first.seriesTitle ?: first.name)) return@mapNotNull null
                    FavoriteEntry.Series(fav, SeriesCard(fav.id, fav.playlistId, seriesKey, first.seriesTitle ?: first.name, first.logo, first.group, first.year, 0))
                } else {
                    val item = items[fav.id] ?: return@mapNotNull null
                    if (blocked != null && blocked(item.group, item.name)) return@mapNotNull null
                    FavoriteEntry.Item(fav, item.toItem())
                }
            }
        }
        .flowOn(Dispatchers.IO)

    fun isFavorite(id: String): Flow<Boolean> = db.favorites().isFavorite(id)

    /** Inverte o favorito e devolve o novo estado. */
    suspend fun toggleFavorite(id: String, kind: ContentKind, playlistId: String): Boolean = withContext(Dispatchers.IO) {
        val exists = db.favorites().isFavorite(id).first()
        if (exists) db.favorites().delete(id) else db.favorites().upsert(FavoriteEntity(id, kind.id, playlistId, System.currentTimeMillis()))
        !exists
    }

    fun toggleFavorite(id: String, kind: ContentKind, playlistId: String, favorite: Boolean) {
        scope.launch(Dispatchers.IO) {
            if (favorite) db.favorites().upsert(FavoriteEntity(id, kind.id, playlistId, System.currentTimeMillis()))
            else db.favorites().delete(id)
        }
    }

    /** Histórico visível (itens de categorias bloqueadas ficam ocultos). */
    val history: Flow<List<HistoryEntity>> = combine(db.history().observe(), restriction) { list, blocked -> list to blocked }
        .mapLatest { (list, blocked) ->
            if (blocked == null) return@mapLatest list
            val items = db.items().getMany(list.map { it.itemId }).associateBy { it.id }
            list.filter { entry -> items[entry.itemId]?.let { !blocked(it.group, it.name) } ?: !Parental.isAdultLabel(entry.name) }
        }
        .flowOn(Dispatchers.IO)

    suspend fun historyEntry(itemId: String): HistoryEntity? = withContext(Dispatchers.IO) { db.history().get(itemId) }

    fun seriesHistory(seriesId: String): Flow<List<HistoryEntity>> = db.history().ofSeries(seriesId)

    /** Registra a reprodução (posição e duração em segundos). Ao vivo guarda apenas o horário. */
    fun recordPlayback(item: MediaItem, positionSec: Long, durationSec: Long) {
        scope.launch(Dispatchers.IO) {
            val previous = db.history().get(item.id)
            val live = item.kind == ContentKind.LIVE
            val completed = !live && Playback.isCompleted(positionSec, durationSec, previous?.completed == true)
            db.history().upsert(
                HistoryEntity(
                    itemId = item.id,
                    playlistId = item.playlistId,
                    kind = item.kind.id,
                    name = item.name,
                    logo = item.logo,
                    seriesId = item.seriesIdOrNull,
                    playedAt = System.currentTimeMillis(),
                    position = if (live) 0 else positionSec.coerceAtLeast(0),
                    duration = if (live) 0 else durationSec.coerceAtLeast(0),
                    completed = completed,
                ),
            )
            db.history().trim(HISTORY_LIMIT)
            if (live) settingsStore.putString("lastChannel", item.id)
        }
    }

    fun removeHistory(itemId: String) = scope.launch(Dispatchers.IO) { db.history().delete(itemId) }
    fun clearHistory() = scope.launch(Dispatchers.IO) { db.history().clear() }

    val lastChannelId: String? get() = settingsStore.getString("lastChannel")

    // ---------------------------------------------------------------- guia de programação

    private fun epgKey(item: MediaItem): String? = epgIndex.value?.let { resolveEpgChannel(item.tvgId, item.tvgName, item.name, it) }

    suspend fun schedule(item: MediaItem, from: Long, to: Long): List<Programme> = withContext(Dispatchers.IO) {
        val key = epgKey(item) ?: return@withContext emptyList()
        val sourceId = key.substringBefore('|')
        val channelId = key.substringAfter('|')
        db.epg().programmes(sourceId, channelId, from, to)
    }

    suspend fun nowNext(item: MediaItem, now: Long = System.currentTimeMillis()): NowNext<Programme>? {
        if (item.kind != ContentKind.LIVE || epgIndex.value == null) return null
        val list = schedule(item, now, now + 12 * 3_600_000L)
        return if (list.isEmpty()) null else nowNext(list, now, 3)
    }

    // ---------------------------------------------------------------- importação

    private suspend fun <T> runJob(kind: ImportJob.Kind, name: String, block: suspend ((ImportProgress) -> Unit) -> T): T {
        val id = newId()
        _jobs.update { (it.filter { j -> j.running } + ImportJob(id, kind, name)).takeLast(6) }
        fun set(transform: (ImportJob) -> ImportJob) = _jobs.update { list -> list.map { if (it.id == id) transform(it) else it } }
        return try {
            val result = withContext(Dispatchers.IO) { block { p -> set { it.copy(progress = p) } } }
            set { it.copy(done = true) }
            result
        } catch (e: CancellationException) {
            _jobs.update { list -> list.filter { it.id != id } }
            throw e
        } catch (e: ImportException) {
            set { it.copy(error = e) }
            throw e
        } catch (e: Exception) {
            Log.e("TuiTV", "erro de importação: ${e.javaClass.simpleName}", e)
            val error = ImportException(ImportError.STORAGE, e.javaClass.simpleName, e)
            set { it.copy(error = error) }
            throw error
        }
    }

    fun dismissJob(id: String) = _jobs.update { list -> list.filter { it.id != id } }

    private suspend fun importPlaylistJob(entity: PlaylistEntity, isNew: Boolean, open: () -> ByteSource): Playlist =
        runJob(ImportJob.Kind.PLAYLIST, entity.name) { progress ->
            val source = open()
            val result = try {
                importer.importPlaylist(entity.id, source, progress)
            } catch (e: Exception) {
                if (isNew) db.items().deleteForPlaylist(entity.id)
                throw e
            }
            val updated = entity.copy(
                updatedAt = System.currentTimeMillis(),
                itemCount = result.count,
                live = result.live,
                movie = result.movie,
                series = result.series,
                skipped = result.skipped,
                epgUrlSealed = result.epgUrl?.let(SecureText::seal) ?: entity.epgUrlSealed,
                failedAt = 0,
            )
            db.playlists().upsert(updated)
            result.epgUrl?.let { addEpgFromPlaylistHeader(updated.name, it) }
            updated.toModel()
        }

    private fun defaultName(name: String, fallback: String) = cleanName(name).ifEmpty { cleanName(fallback, "Lista") }

    suspend fun addPlaylistUrl(name: String, url: String): Playlist {
        val s = settingsStore.current
        val checked = net.checkedUrl(url, s.allowPrivateHosts)
        val now = System.currentTimeMillis()
        val entity = PlaylistEntity(
            id = newId(), name = defaultName(name, Xtream.parse(checked)?.let { hostLabel(it.host) } ?: tv.tui.core.nameFromUrl(checked)), source = "url",
            urlSealed = SecureText.seal(checked), fileName = null, active = true, createdAt = now, updatedAt = now,
            itemCount = 0, live = 0, movie = 0, series = 0, epgUrlSealed = null, skipped = 0,
        )
        return importPlaylistJob(entity, isNew = true) { net.open(checked, s.connectionTimeout, Limits.MAX_PLAYLIST_BYTES) }
    }

    /**
     * Lista por login (Xtream Codes): monta o endereço get.php a partir de host, usuário e senha.
     * Se a lista não anunciar um guia, o guia xmltv.php do mesmo login é adicionado.
     */
    suspend fun addPlaylistLogin(name: String, host: String, username: String, password: String): Playlist {
        val login = loginOf(host, username, password)
        val playlist = addPlaylistUrl(name.ifBlank { hostLabel(login.host) }, Xtream.playlistUrl(login))
        if (playlist.epgUrl == null) withContext(Dispatchers.IO) { addEpgFromPlaylistHeader(playlist.name, Xtream.epgUrl(login)) }
        return playlist
    }

    private fun loginOf(host: String, username: String, password: String): XtreamLogin {
        if (host.isBlank() || username.isBlank() || password.isBlank()) throw ImportException(ImportError.LOGIN_MISSING)
        val base = Xtream.normalizeHost(host) ?: throw ImportException(ImportError.URL_MALFORMED)
        return XtreamLogin(base, username.trim(), password.trim())
    }

    private fun hostLabel(base: String) = runCatching { java.net.URI(base).host }.getOrNull() ?: base

    /** Troca o endereço (ou o login) de uma lista existente e baixa de novo; favoritos e histórico são mantidos. */
    suspend fun changePlaylistSource(id: String, url: String? = null, login: Triple<String, String, String>? = null): Playlist {
        val target = if (login != null) Xtream.playlistUrl(loginOf(login.first, login.second, login.third)) else url ?: ""
        val checked = net.checkedUrl(target, settingsStore.current.allowPrivateHosts)
        withContext(Dispatchers.IO) {
            val entity = db.playlists().get(id) ?: throw ImportException(ImportError.EMPTY)
            db.playlists().upsert(entity.copy(urlSealed = SecureText.seal(checked), failedAt = 0))
        }
        return refreshPlaylist(id)
    }

    suspend fun addPlaylistFile(uri: Uri, fileName: String, name: String): Playlist {
        val now = System.currentTimeMillis()
        val entity = PlaylistEntity(
            id = newId(), name = defaultName(name, fileName.substringBeforeLast('.')), source = "file",
            urlSealed = null, fileName = fileName, active = true, createdAt = now, updatedAt = now,
            itemCount = 0, live = 0, movie = 0, series = 0, epgUrlSealed = null, skipped = 0,
        )
        return importPlaylistJob(entity, isNew = true) { net.openUri(uri, Limits.MAX_PLAYLIST_BYTES) }
    }

    /** Baixa novamente uma lista adicionada por endereço. */
    suspend fun refreshPlaylist(id: String): Playlist {
        val entity = withContext(Dispatchers.IO) { db.playlists().get(id) } ?: throw ImportException(ImportError.EMPTY)
        val url = SecureText.open(entity.urlSealed) ?: throw ImportException(ImportError.URL_EMPTY)
        val s = settingsStore.current
        return try {
            importPlaylistJob(entity, isNew = false) { net.open(url, s.connectionTimeout, Limits.MAX_PLAYLIST_BYTES) }
        } catch (e: ImportException) {
            withContext(Dispatchers.IO) { db.playlists().get(id)?.let { db.playlists().upsert(it.copy(failedAt = System.currentTimeMillis())) } }
            throw e
        }
    }

    fun updatePlaylist(id: String, name: String? = null, active: Boolean? = null, url: String? = null) = scope.launch(Dispatchers.IO) {
        val entity = db.playlists().get(id) ?: return@launch
        db.playlists().upsert(
            entity.copy(
                name = name?.let { cleanName(it) }?.ifEmpty { null } ?: entity.name,
                active = active ?: entity.active,
                urlSealed = url?.let(SecureText::seal) ?: entity.urlSealed,
            ),
        )
    }

    suspend fun deletePlaylist(id: String) = withContext(Dispatchers.IO) {
        db.withTransaction {
            db.items().deleteForPlaylist(id)
            db.favorites().deleteForPlaylist(id)
            db.history().deleteForPlaylist(id)
            db.playlists().delete(id)
        }
    }

    private suspend fun addEpgFromPlaylistHeader(playlistName: String, url: String) {
        val exists = db.epg().sources().any { SecureText.open(it.urlSealed) == url }
        if (exists) return
        val check = tv.tui.core.validateRemoteUrl(url, settingsStore.current.allowPrivateHosts)
        if (!check.ok) return
        val entity = EpgSourceEntity(newId(), "Guia — $playlistName", "url", SecureText.seal(url), null, 0, 0, 0)
        db.epg().upsertSource(entity)
        // O guia anunciado pela lista é baixado em segundo plano; falhas aparecem na tela de listas.
        scope.launch { runCatching { refreshEpg(entity.id) } }
    }

    private suspend fun importEpgJob(entity: EpgSourceEntity, open: () -> ByteSource): EpgSource =
        runJob(ImportJob.Kind.EPG, entity.name) { progress ->
            val result = importer.importEpg(entity.id, open(), progress)
            val updated = entity.copy(
                updatedAt = System.currentTimeMillis(),
                channelCount = result.channelCount,
                programmeCount = result.programmeCount,
                failedAt = 0,
            )
            db.epg().upsertSource(updated)
            updated.toModel()
        }

    suspend fun addEpgUrl(name: String, url: String): EpgSource {
        val s = settingsStore.current
        val checked = net.checkedUrl(url, s.allowPrivateHosts)
        val entity = EpgSourceEntity(newId(), defaultName(name, "Guia"), "url", SecureText.seal(checked), null, 0, 0, 0)
        withContext(Dispatchers.IO) { db.epg().upsertSource(entity) }
        return try {
            importEpgJob(entity) { net.open(checked, s.connectionTimeout, Limits.MAX_EPG_BYTES) }
        } catch (e: Exception) {
            withContext(Dispatchers.IO) { db.epg().deleteSource(entity.id) }
            throw e
        }
    }

    suspend fun addEpgFile(uri: Uri, fileName: String, name: String): EpgSource {
        val entity = EpgSourceEntity(newId(), defaultName(name, fileName.substringBeforeLast('.')), "file", null, fileName, 0, 0, 0)
        withContext(Dispatchers.IO) { db.epg().upsertSource(entity) }
        return try {
            importEpgJob(entity) { net.openUri(uri, Limits.MAX_EPG_BYTES) }
        } catch (e: Exception) {
            withContext(Dispatchers.IO) { db.epg().deleteSource(entity.id) }
            throw e
        }
    }

    suspend fun refreshEpg(id: String): EpgSource {
        val entity = withContext(Dispatchers.IO) { db.epg().source(id) } ?: throw ImportException(ImportError.EMPTY)
        val url = SecureText.open(entity.urlSealed) ?: throw ImportException(ImportError.URL_EMPTY)
        val s = settingsStore.current
        return try {
            importEpgJob(entity) { net.open(url, s.connectionTimeout, Limits.MAX_EPG_BYTES) }
        } catch (e: ImportException) {
            withContext(Dispatchers.IO) { db.epg().source(id)?.let { db.epg().upsertSource(it.copy(failedAt = System.currentTimeMillis())) } }
            throw e
        }
    }

    suspend fun deleteEpg(id: String) = withContext(Dispatchers.IO) {
        db.withTransaction {
            db.epg().deleteProgrammes(id)
            db.epg().deleteChannels(id)
            db.epg().deleteSource(id)
        }
    }

    // ---------------------------------------------------------------- atualização automática

    /**
     * Baixa de novo listas e guias remotos mais antigos que o intervalo configurado.
     * Uma falha não apaga a biblioteca anterior e só é repetida depois de uma hora.
     */
    suspend fun autoRefresh() {
        if (!refreshLock.tryLock()) return
        try {
            val hours = settingsStore.current.autoRefreshHours
            withContext(Dispatchers.IO) { db.epg().deleteEndedBefore(System.currentTimeMillis() - 24 * 3_600_000L) }
            if (hours <= 0 || !net.isOnline()) return
            val now = System.currentTimeMillis()
            val maxAge = hours * 3_600_000L
            fun due(updatedAt: Long, failedAt: Long) = now - updatedAt > maxAge && now - failedAt > RETRY_AFTER_FAILURE
            val playlists = withContext(Dispatchers.IO) { db.playlists().all() }
            for (p in playlists) {
                if (p.source == "url" && p.active && due(p.updatedAt, p.failedAt)) runCatching { refreshPlaylist(p.id) }
            }
            val sources = withContext(Dispatchers.IO) { db.epg().sources() }
            for (s in sources) {
                if (s.source == "url" && due(s.updatedAt, s.failedAt)) runCatching { refreshEpg(s.id) }
            }
        } finally {
            refreshLock.unlock()
        }
    }

    fun startAutoRefresh() = scope.launch {
        while (true) {
            runCatching { autoRefresh() }
            delay(30 * 60_000L)
        }
    }

    // ---------------------------------------------------------------- acesso para o backup

    internal val database get() = db
}
