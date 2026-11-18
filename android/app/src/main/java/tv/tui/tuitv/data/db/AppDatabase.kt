package tv.tui.tuitv.data.db

import android.content.Context
import androidx.room.AutoMigration
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        PlaylistEntity::class,
        ItemEntity::class,
        FavoriteEntity::class,
        HistoryEntity::class,
        EpgSourceEntity::class,
        EpgChannelEntity::class,
        ProgrammeEntity::class,
    ],
    version = 2,
    exportSchema = true,
    // 2: lista consultada sob demanda (provider, expiresAt) e nome/capa nos favoritos.
    autoMigrations = [AutoMigration(from = 1, to = 2)],
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun playlists(): PlaylistDao
    abstract fun items(): ItemDao
    abstract fun favorites(): FavoriteDao
    abstract fun history(): HistoryDao
    abstract fun epg(): EpgDao

    companion object {
        fun create(context: Context): AppDatabase =
            Room.databaseBuilder(context, AppDatabase::class.java, "tuitv.db")
                .setJournalMode(JournalMode.WRITE_AHEAD_LOGGING)
                .build()
    }
}
