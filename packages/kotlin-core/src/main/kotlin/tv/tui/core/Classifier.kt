package tv.tui.core

/**
 * Classificação de conteúdo — porte fiel de packages/business-rules/src/classify.ts:
 *  1. Atributo explícito tvg-type/type.
 *  2. Caminho do endereço: /series/ → série, /movie(s)/ → filme, /live/ → ao vivo.
 *  3. Extensão de arquivo de vídeo: com marcação de episódio → série; senão → filme.
 *  4. Marcação de episódio + categoria de séries → série.
 *  5. Caso contrário → ao vivo.
 */
enum class ContentKind(val id: String) { LIVE("live"), MOVIE("movie"), SERIES("series") }

data class EpisodeMatch(val title: String, val season: Int, val episode: Int)
data class Classification(val kind: ContentKind, val episode: EpisodeMatch?)

private val VOD_EXT = Regex("(?iu)\\.(mp4|mkv|avi|mov|webm|m4v|wmv|flv|mpg|mpeg|ogv|3gp)$")
private val SERIES_GROUP = Regex("(?iu)(s[eé]ries?|novelas?|animes?|doramas?|temporadas?|tv shows?)")
private const val SEP = "(?:^|[ \\t._\\-\\[(|:])"
private val EPISODE_PATTERNS = listOf(
    Regex("(?iu)^(.*?)$SEP[ST](\\d{1,2})[ \\t._-]*E(?:P)?(\\d{1,4})(?![0-9])"),
    Regex("(?iu)^(.*?)$SEP(\\d{1,2})x(\\d{2,4})(?![0-9])"),
    Regex("(?iu)^(.*?)$SEP(?:temporada|season)[ \\t]*(\\d{1,2})[^0-9]{1,14}?(?:epis[oó]dio|episode|ep\\.?)[ \\t]*(\\d{1,4})"),
)
private val TITLE_TAIL = Regex("[ \\t._\\-|:\\[(]+$")
private val YEAR_BRACKET = Regex("[(\\[]((?:19|20)\\d{2})[)\\]]")
private val YEAR_TRAILING = Regex(" - ((?:19|20)\\d{2})$")
private val QUERY_START = Regex("[?#]")

fun urlPath(url: String): String {
    val afterScheme = url.indexOf("://")
    val rest = if (afterScheme >= 0) url.substring(afterScheme + 3) else url
    val end = QUERY_START.find(rest)?.range?.first ?: -1
    val noQuery = if (end >= 0) rest.substring(0, end) else rest
    val slash = noQuery.indexOf('/')
    return if (slash >= 0) noQuery.substring(slash) else "/"
}

fun matchEpisode(name: String): EpisodeMatch? {
    for (pattern in EPISODE_PATTERNS) {
        val m = pattern.find(name) ?: continue
        val title = TITLE_TAIL.replace(m.groupValues[1], "").jsTrim()
        return EpisodeMatch(title.ifEmpty { name.jsTrim() }, m.groupValues[2].toInt(), m.groupValues[3].toInt())
    }
    return null
}

fun extractYear(name: String): Int? = (YEAR_BRACKET.find(name) ?: YEAR_TRAILING.find(name))?.groupValues?.get(1)?.toInt()

private fun explicitKind(attrs: Map<String, String>): ContentKind? =
    when ((attrs["tvg-type"] ?: attrs["type"] ?: "").lowercase()) {
        "live", "stream", "channel" -> ContentKind.LIVE
        "movie", "movies", "vod" -> ContentKind.MOVIE
        "series", "serie", "tvshow" -> ContentKind.SERIES
        else -> null
    }

fun classifyEntry(name: String, url: String, attrs: Map<String, String>, groupTitle: String?): Classification {
    val episode = matchEpisode(name)
    explicitKind(attrs)?.let { return Classification(it, if (it == ContentKind.SERIES) episode else null) }

    val path = urlPath(url).lowercase()
    if (path.contains("/series/")) return Classification(ContentKind.SERIES, episode)
    if (path.contains("/movie/") || path.contains("/movies/")) return Classification(ContentKind.MOVIE, null)
    if (path.contains("/live/")) return Classification(ContentKind.LIVE, null)

    if (VOD_EXT.containsMatchIn(path)) {
        return if (episode != null) Classification(ContentKind.SERIES, episode) else Classification(ContentKind.MOVIE, null)
    }
    if (episode != null && SERIES_GROUP.containsMatchIn(groupTitle ?: "")) return Classification(ContentKind.SERIES, episode)
    return Classification(ContentKind.LIVE, null)
}
