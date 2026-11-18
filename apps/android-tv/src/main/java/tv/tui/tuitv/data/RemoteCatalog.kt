package tv.tui.tuitv.data

import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import okhttp3.Request
import tv.tui.core.MediaItem
import tv.tui.core.RemoteCategory
import tv.tui.core.RemoteKind
import tv.tui.core.RemoteSeries
import tv.tui.core.XtreamAccount
import tv.tui.core.XtreamApi
import tv.tui.core.XtreamAuthException
import tv.tui.core.XtreamLogin
import tv.tui.core.XtreamNoApiException

/**
 * Catálogo de logins Xtream consultado sob demanda (player_api.php) — mesmo comportamento da Web
 * (apps/web/src/lib/xtream.ts): categorias ao conectar, conteúdo de uma categoria ao abri-la,
 * episódios ao abrir a série. Tudo fica só em memória; nada do catálogo é gravado no aparelho.
 */
class RemoteCatalog(private val net: Net, private val scope: CoroutineScope, private val timeoutSeconds: () -> Int) {
    class Connection(val account: XtreamAccount, val categories: Map<RemoteKind, List<RemoteCategory>>)

    /** Catálogo de um login nesta sessão. Listas por categoria preservam a ordem do servidor. */
    class Cache(val playlistId: String, val login: XtreamLogin, val categories: Map<RemoteKind, List<RemoteCategory>>) {
        val names: Map<RemoteKind, Map<String, String>> = categories.mapValues { (_, list) -> list.associate { it.id to it.name } }

        /** "LIVE|12" → canais da categoria 12; "LIVE|*" → todos. */
        @Volatile var lists: Map<String, List<MediaItem>> = emptyMap()

        @Volatile var seriesLists: Map<String, List<RemoteSeries>> = emptyMap()

        /** seriesKey → série completa e episódios. */
        @Volatile var episodes: Map<String, Pair<RemoteSeries, List<MediaItem>>> = emptyMap()

        fun categoryIds(kind: RemoteKind, group: String?): List<String?> =
            if (group == null) listOf(null) else categories[kind].orEmpty().filter { it.name == group }.map { it.id }

        private fun keyOf(kind: RemoteKind, id: String?) = "${kind.name}|${id ?: "*"}"

        fun isLoaded(kind: RemoteKind, id: String?): Boolean {
            val all = if (kind == RemoteKind.SERIES) seriesLists.containsKey(keyOf(kind, null)) else lists.containsKey(keyOf(kind, null))
            if (all) return true
            return if (kind == RemoteKind.SERIES) seriesLists.containsKey(keyOf(kind, id)) else lists.containsKey(keyOf(kind, id))
        }

        /** Conteúdo já carregado de uma categoria (group = null: todas). null se ainda não carregado. */
        fun items(kind: RemoteKind, group: String?): List<MediaItem>? {
            lists[keyOf(kind, null)]?.let { all -> return if (group == null) all else all.filter { it.group == group } }
            if (group == null) return null
            val ids = categoryIds(kind, group)
            if (ids.isEmpty()) return emptyList()
            val parts = ids.map { lists[keyOf(kind, it)] ?: return null }
            return parts.flatten()
        }

        fun series(group: String?): List<RemoteSeries>? {
            seriesLists[keyOf(RemoteKind.SERIES, null)]?.let { all -> return if (group == null) all else all.filter { it.group == group } }
            if (group == null) return null
            val ids = categoryIds(RemoteKind.SERIES, group)
            if (ids.isEmpty()) return emptyList()
            return ids.map { seriesLists[keyOf(RemoteKind.SERIES, it)] ?: return null }.flatten()
        }

        /** Tudo o que já foi carregado (para encontrar um item pelo id ou buscar). */
        fun loadedItems(): Sequence<MediaItem> =
            lists.values.asSequence().flatten() + episodes.values.asSequence().flatMap { it.second.asSequence() }

        fun loadedSeries(): Sequence<RemoteSeries> = seriesLists.values.asSequence().flatten().distinctBy { it.id }

        internal fun putList(kind: RemoteKind, id: String?, list: List<MediaItem>) {
            lists = lists + (keyOf(kind, id) to list)
        }

        internal fun putSeries(id: String?, list: List<RemoteSeries>) {
            seriesLists = seriesLists + (keyOf(RemoteKind.SERIES, id) to list)
        }

        internal fun putEpisodes(seriesKey: String, value: Pair<RemoteSeries, List<MediaItem>>) {
            episodes = episodes + (seriesKey to value)
        }
    }

    private val caches = ConcurrentHashMap<String, Cache>()
    private val inflight = ConcurrentHashMap<String, Deferred<Unit>>()

    /** Muda a cada conteúdo carregado: as telas recalculam a partir do cache. */
    private val _version = MutableStateFlow(0L)
    val version: StateFlow<Long> = _version.asStateFlow()

    /** Logins conectando agora (conta e categorias a caminho). */
    private val _connecting = MutableStateFlow<Set<String>>(emptySet())
    val connecting: StateFlow<Set<String>> = _connecting.asStateFlow()

    /** Última falha de cada login (conexão ou carregamento). */
    private val _errors = MutableStateFlow<Map<String, ImportException>>(emptyMap())
    val errors: StateFlow<Map<String, ImportException>> = _errors.asStateFlow()

    fun cached(playlistId: String): Cache? = caches[playlistId]

    fun forget(playlistId: String) {
        caches.remove(playlistId)
        _errors.update { it - playlistId }
        _version.update { it + 1 }
    }

    // ---------------------------------------------------------------- servidor

    private suspend fun fetch(login: XtreamLogin, params: Map<String, String>): String = withContext(Dispatchers.IO) {
        val url = XtreamApi.url(login, params)
        val timeout = timeoutSeconds().coerceAtLeast(20).toLong()
        val client = net.client.newBuilder().connectTimeout(timeout, TimeUnit.SECONDS).readTimeout(timeout, TimeUnit.SECONDS).build()
        val request = try {
            Request.Builder().url(url).header("User-Agent", net.userAgent).build()
        } catch (e: IllegalArgumentException) {
            throw ImportException(ImportError.URL_MALFORMED, cause = e)
        }
        val response = try {
            client.newCall(request).execute()
        } catch (e: IOException) {
            throw net.networkError(e, url)
        }
        response.use {
            when (it.code) {
                404 -> throw XtreamNoApiException()
                401, 403 -> throw ImportException(ImportError.LOGIN_INVALID)
            }
            if (!it.isSuccessful) throw ImportException(ImportError.HTTP, it.code.toString())
            try {
                it.body.string()
            } catch (e: IOException) {
                throw net.networkError(e, url)
            }
        }
    }

    /**
     * Valida a conta e lê as categorias. Lança [XtreamNoApiException] quando o servidor não oferece a API
     * (o login deve então ser importado como lista M3U).
     */
    suspend fun connect(login: XtreamLogin): Connection {
        val account = try {
            XtreamApi.account(fetch(login, emptyMap()))
        } catch (e: XtreamAuthException) {
            throw if (e.status == null) ImportException(ImportError.LOGIN_INVALID) else ImportException(ImportError.ACCOUNT_INACTIVE, e.status)
        }
        val categories = coroutineScope {
            RemoteKind.entries.map { kind -> kind to async { XtreamApi.categories(fetch(login, mapOf("action" to kind.categoriesAction))) } }
                .associate { (kind, job) -> kind to job.await() }
        }
        return Connection(account, categories)
    }

    /** Guarda as categorias de uma conexão já feita (ao adicionar ou atualizar o login). */
    fun seed(playlistId: String, login: XtreamLogin, connection: Connection) {
        caches[playlistId] = Cache(playlistId, login, connection.categories)
        _errors.update { it - playlistId }
        _version.update { it + 1 }
    }

    private fun recordError(playlistId: String, error: Throwable): ImportException {
        val e = when (error) {
            is ImportException -> error
            is XtreamNoApiException -> ImportException(ImportError.HTTP, "404")
            else -> ImportException(ImportError.NETWORK, cause = error)
        }
        _errors.update { it + (playlistId to e) }
        return e
    }

    /** Executa uma vez por chave enquanto estiver em andamento. */
    private suspend fun once(key: String, block: suspend () -> Unit) {
        val job = inflight.computeIfAbsent(key) {
            scope.async(Dispatchers.IO) {
                try {
                    block()
                } finally {
                    inflight.remove(key)
                }
            }
        }
        job.await()
    }

    /** Cache do login, conectando se ainda não estiver conectado. null se a conexão falhar. */
    suspend fun ensure(playlist: Playlist): Cache? {
        caches[playlist.id]?.let { return it }
        val login = playlist.login ?: return null
        _connecting.update { it + playlist.id }
        try {
            once("connect|${playlist.id}") {
                val connection = connect(login)
                caches[playlist.id] = Cache(playlist.id, login, connection.categories)
                _errors.update { it - playlist.id }
                _version.update { it + 1 }
            }
        } catch (e: Exception) {
            recordError(playlist.id, e)
        } finally {
            _connecting.update { it - playlist.id }
        }
        return caches[playlist.id]
    }

    /** Carrega do servidor uma categoria (ou todas, com group = null) dos logins indicados. */
    suspend fun load(playlists: List<Playlist>, kind: RemoteKind, group: String?) {
        val failures = coroutineScope {
            playlists.map { playlist ->
                async {
                    runCatching {
                        val cache = ensure(playlist) ?: return@runCatching
                        val pending = cache.categoryIds(kind, group).filter { !cache.isLoaded(kind, it) }
                        pending.map { id ->
                            async {
                                once("load|${playlist.id}|${kind.name}|${id ?: "*"}") {
                                    val params = buildMap {
                                        put("action", kind.listAction)
                                        if (id != null) put("category_id", id)
                                    }
                                    val body = fetch(cache.login, params)
                                    val names = cache.names[kind].orEmpty()
                                    if (kind == RemoteKind.SERIES) cache.putSeries(id, XtreamApi.seriesList(body, playlist.id, names))
                                    else cache.putList(kind, id, XtreamApi.streams(body, playlist.id, cache.login, kind.content, names))
                                }
                            }
                        }.awaitAll()
                        if (pending.isNotEmpty()) _version.update { it + 1 }
                    }.exceptionOrNull()?.let { recordError(playlist.id, it) }
                }
            }.awaitAll().filterNotNull()
        }
        // Com mais de um login, a falha de um não esconde o conteúdo dos outros.
        if (failures.size == playlists.size && failures.isNotEmpty()) throw failures.first()
    }

    /** Série completa (temporadas e episódios) de um login. */
    suspend fun loadSeries(playlist: Playlist, seriesKey: String) {
        val sid = XtreamApi.remoteSeriesId(seriesKey) ?: return
        val cache = ensure(playlist) ?: throw _errors.value[playlist.id] ?: ImportException(ImportError.NETWORK)
        if (cache.episodes.containsKey(seriesKey)) return
        try {
            once("series|${playlist.id}|$sid") {
                val body = fetch(cache.login, mapOf("action" to "get_series_info", "series_id" to sid))
                val stub = cache.loadedSeries().firstOrNull { it.seriesKey == seriesKey }
                cache.putEpisodes(seriesKey, XtreamApi.seriesEpisodes(body, playlist.id, cache.login, sid, stub, cache.names[RemoteKind.SERIES].orEmpty()))
            }
            _version.update { it + 1 }
        } catch (e: Exception) {
            throw recordError(playlist.id, e)
        }
    }
}
