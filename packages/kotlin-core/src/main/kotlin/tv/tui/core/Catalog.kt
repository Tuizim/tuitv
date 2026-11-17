package tv.tui.core

/**
 * Organização da biblioteca e busca — porte de packages/business-rules/src/library.ts
 * (groupSeries, nextEpisode, listGroups, searchIn).
 */
data class SeriesSeason(val season: Int, val episodes: List<MediaItem>)

data class SeriesGroup(
    val id: String,
    val playlistId: String,
    val title: String,
    val logo: String?,
    val group: String?,
    val year: Int?,
    val seasons: List<SeriesSeason>,
    val episodeCount: Int,
)

/** Agrupa episódios em séries → temporadas → episódios ordenados, na ordem em que as séries aparecem. */
fun groupSeries(items: List<MediaItem>): List<SeriesGroup> {
    class Bucket(val first: MediaItem, val seasons: LinkedHashMap<Int, MutableList<MediaItem>>, var count: Int)
    val map = LinkedHashMap<String, Bucket>()
    for (item in items) {
        val series = item.series ?: continue
        if (item.kind != ContentKind.SERIES) continue
        val id = seriesId(item.playlistId, series.seriesKey)
        val bucket = map.getOrPut(id) { Bucket(item, LinkedHashMap(), 0) }
        bucket.seasons.getOrPut(series.season) { ArrayList() }.add(item)
        bucket.count++
    }
    return map.map { (id, bucket) ->
        val first = bucket.first
        SeriesGroup(
            id = id,
            playlistId = first.playlistId,
            title = first.series!!.title,
            logo = first.logo,
            group = first.group,
            year = first.year,
            seasons = bucket.seasons.entries.sortedBy { it.key }.map { (season, episodes) ->
                SeriesSeason(season, episodes.sortedWith(compareBy<MediaItem> { it.series!!.episode }.thenBy { it.order }))
            },
            episodeCount = bucket.count,
        )
    }
}

/** Próximo episódio na ordem da série, se existir. */
fun nextEpisode(series: SeriesGroup, currentItemId: String): MediaItem? {
    val flat = series.seasons.flatMap { it.episodes }
    val index = flat.indexOfFirst { it.id == currentItemId }
    return if (index >= 0) flat.getOrNull(index + 1) else null
}

data class GroupCount(val name: String, val count: Int)

/** Categorias na ordem em que aparecem, com contagem. */
fun listGroups(groups: Iterable<String?>): List<GroupCount> {
    val map = LinkedHashMap<String, Int>()
    for (group in groups) if (!group.isNullOrEmpty()) map[group] = (map[group] ?: 0) + 1
    return map.map { (name, count) -> GroupCount(name, count) }
}

data class Searchable<T>(val norm: String, val value: T)

fun <T> toSearchable(values: List<T>, text: (T) -> String): List<Searchable<T>> = values.map { Searchable(normalizeText(text(it)), it) }

/**
 * Busca local por termos (todas as palavras precisam aparecer).
 * Ordena: começa com o termo → palavra começa com o termo → contém.
 */
fun <T> searchIn(index: List<Searchable<T>>, query: String, limit: Int = 50): List<T> {
    val q = normalizeText(query)
    if (q.isEmpty()) return emptyList()
    val terms = q.split(' ')
    val ranked = List(3) { ArrayList<T>() }
    var found = 0
    for (entry in index) {
        val norm = entry.norm
        if (!terms.all { norm.contains(it) }) continue
        val rank = when {
            norm.startsWith(q) -> 0
            norm.contains(" ${terms[0]}") || norm.startsWith(terms[0]) -> 1
            else -> 2
        }
        val bucket = ranked[rank]
        if (bucket.size < limit) {
            bucket.add(entry.value)
            found++
        }
        if (ranked[0].size >= limit) break
        if (found >= limit * 3) break
    }
    return (ranked[0] + ranked[1] + ranked[2]).take(limit)
}
