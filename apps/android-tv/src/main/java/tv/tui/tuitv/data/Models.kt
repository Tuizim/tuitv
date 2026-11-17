package tv.tui.tuitv.data

import tv.tui.core.ContentKind
import tv.tui.core.MediaItem
import tv.tui.core.SeriesInfo
import tv.tui.core.Xtream
import tv.tui.core.XtreamLogin
import tv.tui.core.normalizeText
import tv.tui.core.seriesId
import tv.tui.tuitv.data.db.EpgSourceEntity
import tv.tui.tuitv.data.db.HistoryEntity
import tv.tui.tuitv.data.db.ItemEntity
import tv.tui.tuitv.data.db.PlaylistEntity
import tv.tui.tuitv.data.db.ProgrammeEntity
import tv.tui.tuitv.data.db.SeriesSummary

/** Lista de reprodução com endereços já decifrados (apenas em memória). */
data class Playlist(
    val id: String,
    val name: String,
    val isFile: Boolean,
    val url: String?,
    val fileName: String?,
    val active: Boolean,
    val createdAt: Long,
    val updatedAt: Long,
    val itemCount: Int,
    val live: Int,
    val movie: Int,
    val series: Int,
    val epgUrl: String?,
    val skipped: Int,
    val failedAt: Long,
) {
    /** Login Xtream (host, usuário e senha) quando a lista foi adicionada por login. */
    val login: XtreamLogin? get() = url?.let(Xtream::parse)
}

data class EpgSource(
    val id: String,
    val name: String,
    val isFile: Boolean,
    val url: String?,
    val fileName: String?,
    val updatedAt: Long,
    val channelCount: Int,
    val programmeCount: Int,
    val failedAt: Long,
)

/** Série em uma grade (sem os episódios). */
data class SeriesCard(
    val id: String,
    val playlistId: String,
    val seriesKey: String,
    val title: String,
    val logo: String?,
    val group: String?,
    val year: Int?,
    val episodes: Int,
)

fun kindOf(id: String): ContentKind = ContentKind.entries.firstOrNull { it.id == id } ?: ContentKind.LIVE

fun PlaylistEntity.toModel() = Playlist(
    id, name, source == "file", SecureText.open(urlSealed), fileName, active, createdAt, updatedAt,
    itemCount, live, movie, series, SecureText.open(epgUrlSealed), skipped, failedAt,
)

fun EpgSourceEntity.toModel() = EpgSource(id, name, source == "file", SecureText.open(urlSealed), fileName, updatedAt, channelCount, programmeCount, failedAt)

fun SeriesSummary.toCard() = SeriesCard(seriesId(playlistId, seriesKey), playlistId, seriesKey, title, logo, group, year, episodes)

fun ItemEntity.toItem() = MediaItem(
    id = id,
    playlistId = playlistId,
    key = itemKey,
    kind = kindOf(kind),
    name = name,
    url = url,
    logo = logo,
    group = group,
    tvgId = tvgId,
    tvgName = tvgName,
    series = if (seriesKey != null) SeriesInfo(seriesTitle ?: name, seriesKey, season ?: 0, episode ?: 0) else null,
    year = year,
    duration = duration,
    description = description,
    order = ord,
)

fun MediaItem.toEntity(gen: Long) = ItemEntity(
    id = id,
    playlistId = playlistId,
    itemKey = key,
    kind = kind.id,
    name = name,
    norm = normalizeText(series?.title?.let { "$name $it" } ?: name),
    url = url,
    logo = logo,
    group = group,
    tvgId = tvgId,
    tvgName = tvgName,
    seriesTitle = series?.title,
    seriesKey = series?.seriesKey,
    season = series?.season,
    episode = series?.episode,
    year = year,
    duration = duration,
    description = description,
    ord = order,
    gen = gen,
)

val MediaItem.seriesIdOrNull: String? get() = series?.let { seriesId(playlistId, it.seriesKey) }

/** Programa do guia, já associado a um canal. */
typealias Programme = ProgrammeEntity

typealias HistoryEntry = HistoryEntity
