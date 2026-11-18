package tv.tui.tuitv.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import tv.tui.core.Timed

/**
 * Tabelas locais. Os campos espelham packages/shared-models; endereços de listas e guias
 * ficam cifrados (colunas *Sealed, ver SecureText).
 */
@Entity(tableName = "playlists")
data class PlaylistEntity(
    @PrimaryKey val id: String,
    val name: String,
    /** "url" ou "file". */
    val source: String,
    val urlSealed: String?,
    val fileName: String?,
    val active: Boolean,
    val createdAt: Long,
    val updatedAt: Long,
    val itemCount: Int,
    val live: Int,
    val movie: Int,
    val series: Int,
    val epgUrlSealed: String?,
    val skipped: Int,
    /** Última tentativa de atualização automática que falhou (ms), para não repetir a cada abertura. */
    val failedAt: Long = 0,
    /**
     * null/"m3u": lista importada e guardada no aparelho; "xtream": login consultado sob demanda no servidor
     * (nada do catálogo é guardado; live/movie/series contam as categorias do servidor).
     */
    val provider: String? = null,
    /** Vencimento da assinatura informado pelo servidor (ms), 0 se desconhecido. */
    @ColumnInfo(defaultValue = "0") val expiresAt: Long = 0,
)

@Entity(
    tableName = "items",
    indices = [Index("playlistId"), Index("kind", "grp"), Index("playlistId", "seriesKey")],
)
data class ItemEntity(
    @PrimaryKey val id: String,
    val playlistId: String,
    val itemKey: String,
    /** "live", "movie" ou "series". */
    val kind: String,
    val name: String,
    /** Nome normalizado (sem acentos, minúsculas) para a busca local. */
    val norm: String,
    val url: String,
    val logo: String?,
    @ColumnInfo(name = "grp") val group: String?,
    val tvgId: String?,
    val tvgName: String?,
    val seriesTitle: String?,
    val seriesKey: String?,
    val season: Int?,
    val episode: Int?,
    val year: Int?,
    val duration: Int?,
    val description: String?,
    val ord: Int,
    /** Geração da importação: itens de gerações anteriores são removidos ao final de uma atualização. */
    val gen: Long,
)

@Entity(tableName = "favorites")
data class FavoriteEntity(
    /** Id do item ou da série (`${playlistId}:s:${seriesKey}`). */
    @PrimaryKey val id: String,
    val kind: String,
    val playlistId: String,
    val addedAt: Long,
    /** Nome e capa ao favoritar: itens de logins não ficam no aparelho e o favorito precisa se mostrar sozinho. */
    val name: String? = null,
    val logo: String? = null,
    @ColumnInfo(name = "grp") val group: String? = null,
    val year: Int? = null,
)

@Entity(tableName = "history", indices = [Index("playedAt")])
data class HistoryEntity(
    @PrimaryKey val itemId: String,
    val playlistId: String,
    val kind: String,
    val name: String,
    val logo: String?,
    val seriesId: String?,
    val playedAt: Long,
    /** Segundos. */
    val position: Long,
    val duration: Long,
    val completed: Boolean,
)

@Entity(tableName = "epg_sources")
data class EpgSourceEntity(
    @PrimaryKey val id: String,
    val name: String,
    val source: String,
    val urlSealed: String?,
    val fileName: String?,
    val updatedAt: Long,
    val channelCount: Int,
    val programmeCount: Int,
    val failedAt: Long = 0,
)

@Entity(tableName = "epg_channels", indices = [Index("sourceId")])
data class EpgChannelEntity(
    /** `${sourceId}|${channelId}` */
    @PrimaryKey val id: String,
    val sourceId: String,
    val channelId: String,
    /** Nomes separados por \u0001. */
    val displayNames: String,
    val icon: String?,
)

@Entity(tableName = "programmes", indices = [Index("sourceId", "channelId", "start")])
data class ProgrammeEntity(
    @PrimaryKey(autoGenerate = true) val rowId: Long = 0,
    val sourceId: String,
    val channelId: String,
    override val start: Long,
    override val stop: Long,
    val title: String,
    val description: String?,
    val category: String?,
) : Timed

/** Resumo de uma série para grades e fileiras. */
data class SeriesSummary(
    val playlistId: String,
    val seriesKey: String,
    val title: String,
    val logo: String?,
    @ColumnInfo(name = "grp") val group: String?,
    val year: Int?,
    val episodes: Int,
    val firstOrd: Int,
)

data class GroupRow(@ColumnInfo(name = "grp") val group: String?, val count: Int)
