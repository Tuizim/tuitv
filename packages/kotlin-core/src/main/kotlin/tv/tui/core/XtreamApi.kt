package tv.tui.core

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/**
 * Login Xtream Codes consultado sob demanda (player_api.php) — mesmas regras de apps/web/src/lib/xtream.ts.
 *
 * Só interpreta as respostas do servidor (a rede fica no aplicativo). Ids estáveis embutem o tipo e o id do
 * servidor, para favoritos e histórico reabrirem o conteúdo sem consultar o catálogo:
 *   canal    `${playlistId}:x:l:${streamId}`
 *   filme    `${playlistId}:x:m:${streamId}.${extensão}`
 *   episódio `${playlistId}:x:e:${seriesId}:${episodeId}.${extensão}`
 *   série    `${playlistId}:s:x${seriesId}` (seriesKey = "x${seriesId}")
 */
enum class RemoteKind(val content: ContentKind, val categoriesAction: String, val listAction: String) {
    LIVE(ContentKind.LIVE, "get_live_categories", "get_live_streams"),
    MOVIE(ContentKind.MOVIE, "get_vod_categories", "get_vod_streams"),
    SERIES(ContentKind.SERIES, "get_series_categories", "get_series"),
    ;

    companion object {
        fun of(kind: ContentKind) = entries.first { it.content == kind }
    }
}

data class RemoteCategory(val id: String, val name: String)

data class XtreamAccount(val status: String?, val expiresAt: Long?, val maxConnections: Int?)

/** Série de um login, sem os episódios (eles vêm ao abrir a série). */
data class RemoteSeries(
    val id: String,
    val playlistId: String,
    val seriesKey: String,
    val title: String,
    val logo: String?,
    val group: String?,
    val year: Int?,
    val plot: String?,
)

/** O servidor não oferece a API (resposta que não é a esperada): usar a lista M3U. */
class XtreamNoApiException : Exception("no-api")

/** Usuário ou senha recusados ([status] nulo) ou conta não ativa ([status] informado pelo servidor). */
class XtreamAuthException(val status: String?) : Exception("auth")

object XtreamApi {
    private val DIGITS = Regex("^\\d+$")
    private val EXT = Regex("^[a-zA-Z0-9]{1,5}$")
    private val LIVE_KEY = Regex("^x:l:(\\d+)$")
    private val MOVIE_KEY = Regex("^x:m:(\\d+)\\.([a-zA-Z0-9]{1,5})$")
    private val EPISODE_KEY = Regex("^x:e:(\\d+):(\\d+)\\.([a-zA-Z0-9]{1,5})$")
    private val SERIES_KEY = Regex("^x(\\d+)$")
    private val YEAR = Regex("\\d{4}")

    /** Endereço do player_api.php com as credenciais codificadas. */
    fun url(login: XtreamLogin, params: Map<String, String> = emptyMap()): String {
        val query = StringBuilder("username=${Xtream.encode(login.username)}&password=${Xtream.encode(login.password)}")
        for ((k, v) in params) query.append('&').append(k).append('=').append(Xtream.encode(v))
        return "${login.host}/player_api.php?$query"
    }

    private fun parse(body: String): Any? = try {
        if (body.isBlank()) null else JSONTokener(body).nextValue()
    } catch (_: Exception) {
        null
    }

    private fun str(value: Any?): String? {
        if (value == null || value == JSONObject.NULL) return null
        if (value !is String && value !is Number) return null
        val text = value.toString().jsTrim()
        return text.ifEmpty { null }
    }

    /** Alguns servidores respondem `{}` ou `null` no lugar de uma lista vazia. */
    private fun objects(value: Any?): List<JSONObject> {
        val array = value as? JSONArray ?: return emptyList()
        return (0 until array.length()).mapNotNull { array.opt(it) as? JSONObject }
    }

    private fun ext(value: Any?, fallback: String) = str(value)?.takeIf { EXT.matches(it) } ?: fallback

    private fun validYear(year: Int?) = year?.takeIf { it in 1901..2099 }

    private fun segment(value: String) = Xtream.encode(value)

    private fun streamUrl(login: XtreamLogin, path: String, file: String) =
        "${login.host}/$path/${segment(login.username)}/${segment(login.password)}/$file"

    /** Conta do login. Lança [XtreamNoApiException] sem a API e [XtreamAuthException] quando recusado. */
    fun account(body: String): XtreamAccount {
        val data = parse(body) as? JSONObject ?: throw XtreamNoApiException()
        val user = data.opt("user_info") as? JSONObject ?: throw XtreamNoApiException()
        if (str(user.opt("auth"))?.toIntOrNull() != 1) throw XtreamAuthException(null)
        val status = str(user.opt("status"))
        if (status != null && !status.equals("active", ignoreCase = true)) throw XtreamAuthException(status)
        val expires = str(user.opt("exp_date"))?.toLongOrNull()?.takeIf { it > 0 }?.let { it * 1000 }
        val connections = str(user.opt("max_connections"))?.toIntOrNull()?.takeIf { it > 0 }
        return XtreamAccount(status, expires, connections)
    }

    fun categories(body: String): List<RemoteCategory> {
        val seen = HashSet<String>()
        return objects(parse(body)).mapNotNull { entry ->
            val id = str(entry.opt("category_id")) ?: return@mapNotNull null
            if (!seen.add(id)) return@mapNotNull null
            RemoteCategory(id, cleanName(str(entry.opt("category_name")) ?: "", "Outros"))
        }
    }

    /** Canais ou filmes de uma resposta get_live_streams / get_vod_streams. */
    fun streams(body: String, playlistId: String, login: XtreamLogin, kind: ContentKind, names: Map<String, String>): List<MediaItem> {
        require(kind != ContentKind.SERIES)
        val live = kind == ContentKind.LIVE
        var order = 0
        return objects(parse(body)).mapNotNull { entry ->
            val sid = str(entry.opt("stream_id"))?.takeIf { DIGITS.matches(it) } ?: return@mapNotNull null
            val name = cleanName(str(entry.opt("name")) ?: "", if (live) "Canal $sid" else "Filme $sid")
            val extension = ext(entry.opt("container_extension"), "mp4")
            val key = if (live) "x:l:$sid" else "x:m:$sid.$extension"
            MediaItem(
                id = itemId(playlistId, key),
                playlistId = playlistId,
                key = key,
                kind = kind,
                name = name,
                url = if (live) streamUrl(login, "live", "$sid.ts") else streamUrl(login, "movie", "$sid.$extension"),
                logo = safeImageUrl(str(entry.opt("stream_icon"))),
                group = names[str(entry.opt("category_id")) ?: ""],
                tvgId = if (live) str(entry.opt("epg_channel_id")) else null,
                tvgName = null,
                series = null,
                year = if (live) null else validYear(str(entry.opt("year"))?.toIntOrNull() ?: extractYear(name)),
                duration = null,
                description = null,
                order = order++,
            )
        }
    }

    /** Séries de uma resposta get_series, ainda sem episódios. */
    fun seriesList(body: String, playlistId: String, names: Map<String, String>): List<RemoteSeries> =
        objects(parse(body)).mapNotNull { entry ->
            val sid = str(entry.opt("series_id"))?.takeIf { DIGITS.matches(it) } ?: return@mapNotNull null
            val title = cleanName(str(entry.opt("name")) ?: "", "Série $sid")
            val released = str(entry.opt("releaseDate")) ?: str(entry.opt("release_date")) ?: str(entry.opt("year")) ?: ""
            RemoteSeries(
                id = seriesId(playlistId, "x$sid"),
                playlistId = playlistId,
                seriesKey = "x$sid",
                title = title,
                logo = safeImageUrl(str(entry.opt("cover"))),
                group = names[str(entry.opt("category_id")) ?: ""],
                year = validYear(YEAR.find(released)?.value?.toInt() ?: extractYear(title)),
                plot = str(entry.opt("plot"))?.take(3000),
            )
        }

    /** Série e episódios de uma resposta get_series_info. */
    fun seriesEpisodes(
        body: String,
        playlistId: String,
        login: XtreamLogin,
        sid: String,
        stub: RemoteSeries?,
        names: Map<String, String>,
    ): Pair<RemoteSeries, List<MediaItem>> {
        val data = parse(body) as? JSONObject
        val info = data?.opt("info") as? JSONObject
        val title = stub?.title ?: cleanName(str(info?.opt("name")) ?: "", "Série $sid")
        val cover = stub?.logo ?: safeImageUrl(str(info?.opt("cover")))
        val group = stub?.group ?: names[str(info?.opt("category_id")) ?: ""]
        val series = RemoteSeries(
            id = seriesId(playlistId, "x$sid"),
            playlistId = playlistId,
            seriesKey = "x$sid",
            title = title,
            logo = cover,
            group = group,
            year = stub?.year,
            plot = str(info?.opt("plot"))?.take(3000) ?: stub?.plot,
        )
        // "episodes" costuma ser { "1": [...], "2": [...] }; alguns servidores usam uma lista de listas.
        val buckets: List<Any?> = when (val raw = data?.opt("episodes")) {
            is JSONObject -> raw.keys().asSequence().map { raw.opt(it) }.toList()
            is JSONArray -> (0 until raw.length()).map { raw.opt(it) }
            else -> emptyList()
        }
        var order = 0
        val episodes = buckets.flatMap { objects(it) }.mapNotNull { entry ->
            val epId = str(entry.opt("id"))?.takeIf { DIGITS.matches(it) } ?: return@mapNotNull null
            val extension = ext(entry.opt("container_extension"), "mp4")
            val season = str(entry.opt("season"))?.toIntOrNull() ?: 0
            val number = str(entry.opt("episode_num"))?.toIntOrNull() ?: 0
            val details = entry.opt("info") as? JSONObject
            val key = "x:e:$sid:$epId.$extension"
            MediaItem(
                id = itemId(playlistId, key),
                playlistId = playlistId,
                key = key,
                kind = ContentKind.SERIES,
                name = cleanName(str(entry.opt("title")) ?: "", if (season > 0) "T$season E$number" else "Episódio ${if (number > 0) number else epId}"),
                url = streamUrl(login, "series", "$epId.$extension"),
                logo = safeImageUrl(str(details?.opt("movie_image"))) ?: cover,
                group = group,
                tvgId = null,
                tvgName = null,
                series = SeriesInfo(title, "x$sid", season, number),
                year = null,
                duration = str(details?.opt("duration_secs"))?.toIntOrNull()?.takeIf { it > 0 },
                description = str(details?.opt("plot"))?.take(2000),
                order = order++,
            )
        }.sortedWith(compareBy({ it.series!!.season }, { it.series!!.episode }, { it.order }))
        return series to episodes
    }

    /** Id do servidor de uma série remota ("x77" → "77"). */
    fun remoteSeriesId(seriesKey: String): String? = SERIES_KEY.matchEntire(seriesKey)?.groupValues?.get(1)

    /**
     * Reconstrói um item remoto a partir do id (favoritos, histórico, último canal), sem consultar o servidor.
     * Nome e capa vêm do que foi guardado com o favorito/histórico.
     */
    fun itemFromId(playlistId: String, login: XtreamLogin, id: String, name: String, logo: String? = null, group: String? = null): MediaItem? {
        if (!id.startsWith("$playlistId:")) return null
        val key = id.removePrefix("$playlistId:")
        fun item(kind: ContentKind, url: String, series: SeriesInfo? = null) =
            MediaItem(id, playlistId, key, kind, name, url, logo, group, null, null, series, null, null, null, 0)
        LIVE_KEY.matchEntire(key)?.let { return item(ContentKind.LIVE, streamUrl(login, "live", "${it.groupValues[1]}.ts")) }
        MOVIE_KEY.matchEntire(key)?.let { return item(ContentKind.MOVIE, streamUrl(login, "movie", "${it.groupValues[1]}.${it.groupValues[2]}")) }
        EPISODE_KEY.matchEntire(key)?.let {
            val (sid, epId, extension) = it.destructured
            return item(ContentKind.SERIES, streamUrl(login, "series", "$epId.$extension"), SeriesInfo("", "x$sid", 0, 0))
        }
        return null
    }
}
