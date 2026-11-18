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
import android.util.JsonReader
import android.util.JsonToken
import kotlinx.coroutines.launch
import okhttp3.Request
import tv.tui.core.cleanName
import tv.tui.core.extractYear
import tv.tui.core.itemId
import tv.tui.core.normalizeText
import tv.tui.core.safeImageUrl
import tv.tui.core.seriesId
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
            lists.values.asSequence().flatten() + episodes.values.asSequence().flatMap { it.second.asSequence() } + picked.values.asSequence()

        fun loadedSeries(): Sequence<RemoteSeries> =
            (seriesLists.values.asSequence().flatten() + pickedSeries.values.asSequence()).distinctBy { it.id }

        /** Índice de busca por tipo (nomes e ids, sem os itens completos). */
        @Volatile var index: Map<RemoteKind, List<IndexEntry>> = emptyMap()

        /** Itens montados a partir do índice e mostrados na busca: a ficha/player os encontram pelo id. */
        @Volatile var picked: Map<String, MediaItem> = emptyMap()

        @Volatile var pickedSeries: Map<String, RemoteSeries> = emptyMap()

        internal fun remember(items: List<MediaItem>, series: List<RemoteSeries>) {
            // Limitado: só o que a busca mostrou recentemente.
            if (items.isNotEmpty()) picked = (picked + items.associateBy { it.id }).entries.toList().takeLast(PICKED_MAX).associate { it.key to it.value }
            if (series.isNotEmpty()) pickedSeries = (pickedSeries + series.associateBy { it.id }).entries.toList().takeLast(PICKED_MAX).associate { it.key to it.value }
        }

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

    /** Entrada do índice de busca: o mínimo para achar e, depois, montar o item. */
    class IndexEntry(val sid: String, val name: String, val norm: String, val category: String?, val icon: String?, val ext: String?, val year: Int?)

    /** Preparação do índice de busca dos logins (uma vez por sessão). */
    sealed interface IndexState {
        data object Idle : IndexState
        data class Loading(val done: Int, val total: Int) : IndexState
        data object Ready : IndexState
        data class Failed(val error: ImportException) : IndexState
    }

    private val _indexState = MutableStateFlow<IndexState>(IndexState.Idle)
    val indexState: StateFlow<IndexState> = _indexState.asStateFlow()

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

    // ---------------------------------------------------------------- busca

    private fun hasIndex(playlist: Playlist) = caches[playlist.id]?.index?.size == RemoteKind.entries.size

    /**
     * Prepara o índice de busca dos logins, sem bloquear quem chamou. O servidor Xtream não tem busca:
     * o único jeito é ler a lista completa de cada tipo. Para não pesar no aparelho nem no provedor:
     * - uma requisição por vez (nunca os três catálogos em paralelo);
     * - a resposta é lida em fluxo e só o índice enxuto fica na memória (sem a resposta inteira);
     * - uma vez por sessão; digitar não dispara nada de novo;
     * - após uma falha, só tenta outra vez quando o usuário pede ([retrySearchIndex]).
     */
    fun prepareSearchIndex(playlists: List<Playlist>) {
        if (playlists.isEmpty() || playlists.all(::hasIndex)) return
        when (_indexState.value) {
            is IndexState.Loading, is IndexState.Failed -> return
            else -> Unit
        }
        val pending = playlists.filter { !hasIndex(it) }
        val total = pending.sumOf { p -> RemoteKind.entries.count { caches[p.id]?.index?.containsKey(it) != true } }
        _indexState.value = IndexState.Loading(0, total)
        scope.launch(Dispatchers.IO) {
            var done = 0
            var failure: ImportException? = null
            outer@ for (playlist in pending) {
                val cache = ensure(playlist)
                if (cache == null) {
                    failure = _errors.value[playlist.id] ?: ImportException(ImportError.NETWORK)
                    break
                }
                for (kind in RemoteKind.entries) {
                    if (cache.index.containsKey(kind)) continue
                    try {
                        val entries = fetchStream(cache.login, mapOf("action" to kind.listAction)) { readIndex(it, kind) }
                        cache.index = cache.index + (kind to entries)
                    } catch (e: Exception) {
                        // Para tudo: insistir com o servidor fora do ar ou recusando é o que irrita o provedor.
                        failure = recordError(playlist.id, e)
                        break@outer
                    }
                    done++
                    _indexState.value = IndexState.Loading(done, total)
                    _version.update { it + 1 }
                }
            }
            _indexState.value = failure?.let { IndexState.Failed(it) } ?: IndexState.Ready
        }
    }

    /** O usuário pediu para tentar de novo. */
    fun retrySearchIndex(playlists: List<Playlist>) {
        if (_indexState.value is IndexState.Failed) _indexState.value = IndexState.Idle
        prepareSearchIndex(playlists)
    }

    private suspend fun <T> fetchStream(login: XtreamLogin, params: Map<String, String>, read: (JsonReader) -> T): T = withContext(Dispatchers.IO) {
        val url = XtreamApi.url(login, params)
        // Catálogos grandes demoram: o tempo limite vale para cada leitura, não para o download inteiro.
        val timeout = timeoutSeconds().coerceAtLeast(30).toLong()
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
                JsonReader(it.body.charStream()).use(read)
            } catch (e: IOException) {
                throw net.networkError(e, url)
            } catch (e: IllegalStateException) {
                // JSON inválido ou truncado: trata como resposta vazia do servidor.
                throw ImportException(ImportError.HTTP, "json")
            }
        }
    }

    private fun JsonReader.text(): String? = when (peek()) {
        JsonToken.STRING, JsonToken.NUMBER -> nextString()
        JsonToken.BOOLEAN -> nextBoolean().toString()
        JsonToken.NULL -> { nextNull(); null }
        else -> { skipValue(); null }
    }

    /** Lê get_live_streams / get_vod_streams / get_series em fluxo, guardando só o índice. */
    private fun readIndex(reader: JsonReader, kind: RemoteKind): List<IndexEntry> {
        if (reader.peek() != JsonToken.BEGIN_ARRAY) {
            reader.skipValue()
            return emptyList()
        }
        val out = ArrayList<IndexEntry>()
        val series = kind == RemoteKind.SERIES
        reader.beginArray()
        while (reader.hasNext()) {
            if (reader.peek() != JsonToken.BEGIN_OBJECT) {
                reader.skipValue()
                continue
            }
            var sid: String? = null
            var name: String? = null
            var icon: String? = null
            var category: String? = null
            var ext: String? = null
            var released: String? = null
            reader.beginObject()
            while (reader.hasNext()) {
                when (reader.nextName()) {
                    "stream_id" -> if (!series) sid = reader.text() else reader.skipValue()
                    "series_id" -> if (series) sid = reader.text() else reader.skipValue()
                    "name" -> name = reader.text()
                    "stream_icon", "cover" -> icon = reader.text() ?: icon
                    "category_id" -> category = reader.text()
                    "container_extension" -> ext = reader.text()
                    "year", "releaseDate", "release_date" -> released = reader.text()?.takeIf { it.isNotBlank() } ?: released
                    else -> reader.skipValue()
                }
            }
            reader.endObject()
            val id = sid?.takeIf { it.isNotEmpty() && it.all(Char::isDigit) } ?: continue
            if (out.size >= INDEX_MAX) continue
            val title = cleanName(name ?: "", "")
            if (title.isEmpty()) continue
            val year = released?.let { YEAR.find(it)?.value?.toIntOrNull() } ?: extractYear(title)
            out += IndexEntry(id, title, normalizeText(title), category, icon?.takeIf { it.isNotBlank() }, ext?.takeIf { EXT.matches(it) }, year?.takeIf { it in 1901..2099 })
        }
        reader.endArray()
        out.trimToSize()
        return out
    }

    class SearchHits(val live: List<MediaItem>, val movies: List<MediaItem>, val series: List<RemoteSeries>)

    /**
     * Busca nos logins sem consultar o servidor: no índice (se pronto) ou no que já foi carregado
     * nesta sessão. [blocked] aplica o controle parental (categoria, nome).
     */
    fun search(playlists: List<Playlist>, query: String, limit: Int, blocked: ((String?, String) -> Boolean)?): SearchHits {
        val terms = normalizeText(query).split(' ').filter { it.isNotEmpty() }
        if (terms.isEmpty()) return SearchHits(emptyList(), emptyList(), emptyList())
        val first = terms.first()
        /** 0: começa com o termo; 1: alguma palavra começa com ele; 2: contém. */
        fun rank(norm: String): Int = when {
            norm.startsWith(first) -> 0
            norm.contains(" $first") -> 1
            else -> 2
        }
        fun matches(norm: String) = terms.all { norm.contains(it) }

        val live = ArrayList<MediaItem>()
        val movies = ArrayList<MediaItem>()
        val series = ArrayList<RemoteSeries>()
        for (p in playlists) {
            val cache = caches[p.id] ?: continue
            for (kind in RemoteKind.entries) {
                val target = when (kind) {
                    RemoteKind.LIVE -> live
                    RemoteKind.MOVIE -> movies
                    RemoteKind.SERIES -> null
                }
                val names = cache.names[kind].orEmpty()
                val entries = cache.index[kind]
                if (entries != null) {
                    val hits = entries.asSequence()
                        .filter { matches(it.norm) }
                        .filter { blocked == null || !blocked(names[it.category ?: ""], it.name) }
                        .take(limit * 20)
                        .sortedBy { rank(it.norm) }
                        .take(limit)
                        .toList()
                    if (kind == RemoteKind.SERIES) {
                        series += hits.map { e ->
                            RemoteSeries(seriesId(p.id, "x${e.sid}"), p.id, "x${e.sid}", e.name, safeImageUrl(e.icon), names[e.category ?: ""], e.year, null)
                        }
                    } else {
                        target!! += hits.mapNotNull { e ->
                            val key = if (kind == RemoteKind.LIVE) "x:l:${e.sid}" else "x:m:${e.sid}.${e.ext ?: "mp4"}"
                            XtreamApi.itemFromId(p.id, cache.login, itemId(p.id, key), e.name, safeImageUrl(e.icon), names[e.category ?: ""])
                                ?.copy(year = if (kind == RemoteKind.MOVIE) e.year else null)
                        }
                    }
                } else if (kind == RemoteKind.SERIES) {
                    series += cache.loadedSeries().filter { matches(normalizeText(it.title)) && (blocked == null || !blocked(it.group, it.title)) }.take(limit)
                } else {
                    target!! += cache.lists.values.asSequence().flatten().filter { it.kind == kind.content }.distinctBy { it.id }
                        .filter { matches(normalizeText(it.name)) && (blocked == null || !blocked(it.group, it.name)) }.take(limit)
                }
            }
            cache.remember(live.filter { it.playlistId == p.id } + movies.filter { it.playlistId == p.id }, series.filter { it.playlistId == p.id })
        }
        return SearchHits(live.take(limit), movies.take(limit), series.take(limit))
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

/** Itens da busca lembrados por login (ficha e player os acham pelo id). */
private const val PICKED_MAX = 600

/** Teto por tipo e login: protege a memória em catálogos fora do comum. */
private const val INDEX_MAX = 400_000

private val YEAR = Regex("\\d{4}")
private val EXT = Regex("^[a-zA-Z0-9]{1,5}$")
