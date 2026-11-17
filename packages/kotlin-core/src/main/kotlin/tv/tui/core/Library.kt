package tv.tui.core

import kotlin.math.roundToInt

data class SeriesInfo(val title: String, val seriesKey: String, val season: Int, val episode: Int)

/** Item da biblioteca — mesmos campos de MediaItem em packages/shared-models. */
data class MediaItem(
    /** `${playlistId}:${key}` */
    val id: String,
    val playlistId: String,
    /** Chave estável derivada dos metadados (não depende do endereço de reprodução). */
    val key: String,
    val kind: ContentKind,
    val name: String,
    val url: String,
    val logo: String?,
    val group: String?,
    val tvgId: String?,
    val tvgName: String?,
    val series: SeriesInfo?,
    val year: Int?,
    /** Duração em segundos, quando informada pela lista. */
    val duration: Int?,
    val description: String?,
    /** Posição original na lista. */
    val order: Int,
)

fun itemId(playlistId: String, key: String) = "$playlistId:$key"
fun seriesId(playlistId: String, seriesKey: String) = "$playlistId:s:$seriesKey"

/**
 * Chave estável de um registro. Depende de tvg-id, nome e (sem tvg-id) categoria —
 * nunca do endereço de reprodução, que costuma mudar entre atualizações.
 */
fun entryKey(name: String, tvgId: String?, groupTitle: String?): String {
    val id = tvgId ?: ""
    val group = if (id.isNotEmpty()) "" else normalizeText(groupTitle ?: "")
    return stableHash("$id\u0001${normalizeText(name)}\u0001$group")
}

/**
 * Converte registros do parser em itens da biblioteca, de forma incremental.
 * Registros repetidos recebem sufixo de ocorrência, mantendo ids determinísticos:
 * reimportar a mesma lista produz exatamente os mesmos ids (atualização sem duplicação).
 */
class ItemBuilder(private val playlistId: String) {
    var live = 0
        private set
    var movies = 0
        private set
    var episodes = 0
        private set
    var total = 0
        private set
    private val seen = HashMap<String, Int>()

    fun add(entries: List<M3uEntry>): List<MediaItem> {
        val out = ArrayList<MediaItem>(entries.size)
        for (entry in entries) {
            val name = cleanName(entry.name, "Sem nome")
            val base = entryKey(name, entry.tvgId, entry.groupTitle)
            val occurrence = (seen[base] ?: 0) + 1
            seen[base] = occurrence
            val key = if (occurrence == 1) base else "$base-$occurrence"
            val (kind, episode) = classifyEntry(name, entry.url, entry.attrs, entry.groupTitle)
            val vod = kind != ContentKind.LIVE
            val series = if (kind == ContentKind.SERIES) {
                val title = episode?.title ?: name
                SeriesInfo(title, stableHash(normalizeText(title)), episode?.season ?: 0, episode?.episode ?: 0)
            } else null
            out.add(
                MediaItem(
                    id = itemId(playlistId, key),
                    playlistId = playlistId,
                    key = key,
                    kind = kind,
                    name = name,
                    url = entry.url,
                    logo = safeImageUrl(entry.tvgLogo),
                    group = entry.groupTitle?.let { cleanName(it) },
                    tvgId = entry.tvgId,
                    tvgName = entry.tvgName,
                    series = series,
                    year = if (vod) extractYear(name) else null,
                    duration = if (vod && entry.duration > 0) entry.duration.roundToInt() else null,
                    description = if (vod) (entry.attrs["description"]?.ifEmpty { null } ?: entry.attrs["plot"]?.ifEmpty { null })?.take(2000) else null,
                    order = total++,
                ),
            )
            when (kind) {
                ContentKind.LIVE -> live++
                ContentKind.MOVIE -> movies++
                ContentKind.SERIES -> episodes++
            }
        }
        return out
    }
}
