package tv.tui.tuitv.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

private const val ACTIVE = "playlistId IN (SELECT id FROM playlists WHERE active = 1)"

@Dao
interface PlaylistDao {
    @Query("SELECT * FROM playlists ORDER BY createdAt")
    fun observe(): Flow<List<PlaylistEntity>>

    @Query("SELECT * FROM playlists ORDER BY createdAt")
    suspend fun all(): List<PlaylistEntity>

    @Query("SELECT * FROM playlists WHERE id = :id")
    suspend fun get(id: String): PlaylistEntity?

    @Upsert
    suspend fun upsert(playlist: PlaylistEntity)

    @Query("DELETE FROM playlists WHERE id = :id")
    suspend fun delete(id: String)
}

@Dao
interface ItemDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(items: List<ItemEntity>)

    @Query("DELETE FROM items WHERE playlistId = :playlistId AND gen != :gen")
    suspend fun deleteStale(playlistId: String, gen: Long)

    @Query("DELETE FROM items WHERE playlistId = :playlistId")
    suspend fun deleteForPlaylist(playlistId: String)

    @Query("SELECT * FROM items WHERE id = :id")
    suspend fun get(id: String): ItemEntity?

    @Query("SELECT * FROM items WHERE id IN (:ids)")
    suspend fun getMany(ids: List<String>): List<ItemEntity>

    @Query("SELECT * FROM items WHERE playlistId = :playlistId ORDER BY ord")
    suspend fun forPlaylist(playlistId: String): List<ItemEntity>

    @Query("SELECT grp, COUNT(*) AS count FROM items WHERE kind = :kind AND $ACTIVE GROUP BY grp ORDER BY MIN(playlistId), MIN(ord)")
    fun groups(kind: String): Flow<List<GroupRow>>

    @Query("SELECT * FROM items WHERE kind = :kind AND $ACTIVE ORDER BY playlistId, ord")
    fun byKind(kind: String): Flow<List<ItemEntity>>

    @Query("SELECT * FROM items WHERE kind = :kind AND grp = :group AND $ACTIVE ORDER BY playlistId, ord")
    fun byGroup(kind: String, group: String): Flow<List<ItemEntity>>

    @Query("SELECT * FROM items WHERE kind = :kind AND grp IS NULL AND $ACTIVE ORDER BY playlistId, ord")
    fun withoutGroup(kind: String): Flow<List<ItemEntity>>

    @Query("SELECT * FROM items WHERE kind = :kind AND $ACTIVE ORDER BY playlistId, ord LIMIT :limit")
    fun firstOfKind(kind: String, limit: Int): Flow<List<ItemEntity>>

    @Query(
        "SELECT playlistId, seriesKey, seriesTitle AS title, logo, grp, year, COUNT(*) AS episodes, MIN(ord) AS firstOrd " +
            "FROM items WHERE kind = 'series' AND $ACTIVE AND (:group IS NULL OR grp = :group) " +
            "GROUP BY playlistId, seriesKey ORDER BY playlistId, firstOrd",
    )
    fun series(group: String?): Flow<List<SeriesSummary>>

    @Query("SELECT * FROM items WHERE kind = 'series' AND playlistId = :playlistId AND seriesKey = :seriesKey ORDER BY ord")
    fun episodes(playlistId: String, seriesKey: String): Flow<List<ItemEntity>>

    @Query("SELECT * FROM items WHERE playlistId = :playlistId AND seriesKey = :seriesKey ORDER BY ord LIMIT 1")
    suspend fun forSeriesFirst(playlistId: String, seriesKey: String): ItemEntity?

    @Query("SELECT * FROM items WHERE norm LIKE '%' || :term || '%' AND $ACTIVE ORDER BY playlistId, ord LIMIT :limit")
    suspend fun searchTerm(term: String, limit: Int): List<ItemEntity>

    @Query("SELECT COUNT(*) FROM items WHERE $ACTIVE")
    fun countActive(): Flow<Int>
}

@Dao
interface FavoriteDao {
    @Query("SELECT * FROM favorites ORDER BY addedAt DESC")
    fun observe(): Flow<List<FavoriteEntity>>

    @Query("SELECT * FROM favorites")
    suspend fun all(): List<FavoriteEntity>

    @Query("SELECT * FROM favorites WHERE id = :id")
    suspend fun get(id: String): FavoriteEntity?

    @Query("SELECT EXISTS(SELECT 1 FROM favorites WHERE id = :id)")
    fun isFavorite(id: String): Flow<Boolean>

    @Upsert
    suspend fun upsert(favorite: FavoriteEntity)

    @Upsert
    suspend fun upsertAll(favorites: List<FavoriteEntity>)

    @Query("DELETE FROM favorites WHERE id = :id")
    suspend fun delete(id: String)

    @Query("DELETE FROM favorites WHERE playlistId = :playlistId")
    suspend fun deleteForPlaylist(playlistId: String)
}

@Dao
interface HistoryDao {
    @Query("SELECT * FROM history ORDER BY playedAt DESC LIMIT 200")
    fun observe(): Flow<List<HistoryEntity>>

    @Query("SELECT * FROM history ORDER BY playedAt DESC")
    suspend fun all(): List<HistoryEntity>

    @Query("SELECT * FROM history WHERE itemId = :itemId")
    suspend fun get(itemId: String): HistoryEntity?

    @Query("SELECT * FROM history WHERE seriesId = :seriesId ORDER BY playedAt DESC LIMIT 1")
    fun lastOfSeries(seriesId: String): Flow<HistoryEntity?>

    @Query("SELECT * FROM history WHERE seriesId = :seriesId")
    fun ofSeries(seriesId: String): Flow<List<HistoryEntity>>

    @Upsert
    suspend fun upsert(entry: HistoryEntity)

    @Upsert
    suspend fun upsertAll(entries: List<HistoryEntity>)

    @Query("DELETE FROM history WHERE itemId = :itemId")
    suspend fun delete(itemId: String)

    @Query("DELETE FROM history")
    suspend fun clear()

    @Query("DELETE FROM history WHERE playlistId = :playlistId")
    suspend fun deleteForPlaylist(playlistId: String)

    /** Mantém o histórico limitado às entradas mais recentes. */
    @Query("DELETE FROM history WHERE itemId NOT IN (SELECT itemId FROM history ORDER BY playedAt DESC LIMIT :keep)")
    suspend fun trim(keep: Int)
}

@Dao
interface EpgDao {
    @Query("SELECT * FROM epg_sources ORDER BY name")
    fun observeSources(): Flow<List<EpgSourceEntity>>

    @Query("SELECT * FROM epg_sources")
    suspend fun sources(): List<EpgSourceEntity>

    @Query("SELECT * FROM epg_sources WHERE id = :id")
    suspend fun source(id: String): EpgSourceEntity?

    @Upsert
    suspend fun upsertSource(source: EpgSourceEntity)

    @Query("DELETE FROM epg_sources WHERE id = :id")
    suspend fun deleteSource(id: String)

    @Query("SELECT * FROM epg_channels")
    fun observeChannels(): Flow<List<EpgChannelEntity>>

    @Upsert
    suspend fun upsertChannels(channels: List<EpgChannelEntity>)

    @Insert
    suspend fun insertProgrammes(programmes: List<ProgrammeEntity>)

    @Query("DELETE FROM epg_channels WHERE sourceId = :sourceId")
    suspend fun deleteChannels(sourceId: String)

    @Query("DELETE FROM programmes WHERE sourceId = :sourceId")
    suspend fun deleteProgrammes(sourceId: String)

    @Query("DELETE FROM programmes WHERE stop < :before")
    suspend fun deleteEndedBefore(before: Long)

    @Query("SELECT * FROM programmes WHERE sourceId = :sourceId AND channelId = :channelId AND stop > :from AND start < :to ORDER BY start")
    suspend fun programmes(sourceId: String, channelId: String, from: Long, to: Long): List<ProgrammeEntity>
}
