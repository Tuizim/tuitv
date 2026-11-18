package tv.tui.tuitv.data

import androidx.room.withTransaction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import tv.tui.core.Backup
import tv.tui.core.MediaItem
import tv.tui.core.SeriesInfo
import tv.tui.core.hasCredentials
import tv.tui.tuitv.data.db.EpgSourceEntity
import tv.tui.tuitv.data.db.FavoriteEntity
import tv.tui.tuitv.data.db.HistoryEntity
import tv.tui.tuitv.data.db.PlaylistEntity

data class RestoreSummary(val playlists: Int, val favorites: Int, val history: Int, val epgSources: Int)

/**
 * Backup no mesmo formato da Web (BackupData em web/packages/shared-models): um arquivo exportado
 * no navegador restaura no aparelho e vice-versa. O PIN parental nunca é exportado.
 */
class BackupService(private val library: Library) {
    private val db get() = library.database

    /** O backup terá endereços com credenciais (avisar antes de exportar sem senha). */
    suspend fun hasCredentials(): Boolean = withContext(Dispatchers.IO) {
        db.playlists().all().any { p -> SecureText.open(p.urlSealed)?.let(::hasCredentials) == true } ||
            db.epg().sources().any { s -> SecureText.open(s.urlSealed)?.let(::hasCredentials) == true }
    }

    suspend fun export(password: String?): String = withContext(Dispatchers.IO) {
        val playlists = JSONArray()
        for (p in db.playlists().all()) {
            val entry = JSONObject().put("playlist", playlistJson(p))
            // Listas importadas por arquivo não podem ser baixadas de novo: os itens acompanham o backup.
            if (p.source == "file") entry.put("items", JSONArray(db.items().forPlaylist(p.id).map { itemJson(it.toItem()) }))
            playlists.put(entry)
        }
        val data = JSONObject()
            .put("playlists", playlists)
            .put("favorites", JSONArray(db.favorites().all().map(::favoriteJson)))
            .put("history", JSONArray(db.history().all().map(::historyJson)))
            .put("epgSources", JSONArray(db.epg().sources().map(::epgJson)))
            .put("settings", library.settingsStore.current.toJson(includePin = false))
        Backup.create(data, "android-tv", password?.ifEmpty { null })
    }

    /** Restaura um backup. Os dados são mesclados aos atuais; o controle parental deste aparelho é mantido. */
    suspend fun restore(text: String, password: String?): RestoreSummary = withContext(Dispatchers.IO) {
        val data = Backup.open(text, password?.ifEmpty { null })
        val gen = System.currentTimeMillis()
        val toRefresh = ArrayList<String>()
        val epgToRefresh = ArrayList<String>()
        val playlists = data.getJSONArray("playlists")
        val favorites = data.getJSONArray("favorites")
        val history = data.getJSONArray("history")
        val epgSources = data.optJSONArray("epgSources") ?: JSONArray()
        db.withTransaction {
            for (i in 0 until playlists.length()) {
                val entry = playlists.getJSONObject(i)
                val p = entry.getJSONObject("playlist")
                val entity = playlistEntity(p)
                db.playlists().upsert(entity)
                val items = entry.optJSONArray("items")
                if (items != null) {
                    db.items().deleteForPlaylist(entity.id)
                    db.items().insertAll(List(items.length()) { itemFromJson(items.getJSONObject(it)).toEntity(gen) })
                } else if (entity.source == "url" && entity.provider != PROVIDER_XTREAM) {
                    // Login consultado sob demanda não tem conteúdo a baixar: conecta ao abrir.
                    toRefresh.add(entity.id)
                }
            }
            db.favorites().upsertAll(
                List(favorites.length()) { favorites.getJSONObject(it) }.map(::favoriteFromJson),
            )
            db.history().upsertAll(List(history.length()) { historyFromJson(history.getJSONObject(it)) })
            for (i in 0 until epgSources.length()) {
                val e = epgSources.getJSONObject(i)
                val entity = EpgSourceEntity(
                    id = e.getString("id"),
                    name = e.optString("name", "Guia"),
                    source = e.optString("source", "url"),
                    urlSealed = e.optStringOrNull("url")?.let(SecureText::seal),
                    fileName = e.optStringOrNull("fileName"),
                    updatedAt = 0,
                    channelCount = 0,
                    programmeCount = 0,
                )
                db.epg().upsertSource(entity)
                if (entity.source == "url") epgToRefresh.add(entity.id)
            }
        }
        val current = library.settingsStore.current
        library.settingsStore.update { Settings.fromJson(data.getJSONObject("settings")).copy(parental = current.parental) }
        // Listas por endereço e guias são baixados de novo em segundo plano.
        library.scope.launch(Dispatchers.IO) {
            for (id in toRefresh) runCatching { library.refreshPlaylist(id) }
            for (id in epgToRefresh) runCatching { library.refreshEpg(id) }
        }
        RestoreSummary(playlists.length(), favorites.length(), history.length(), epgSources.length())
    }

    private fun playlistJson(p: PlaylistEntity) = JSONObject()
        .put("id", p.id)
        .put("name", p.name)
        .put("source", p.source)
        .apply {
            SecureText.open(p.urlSealed)?.let { put("url", it) }
            p.fileName?.let { put("fileName", it) }
        }
        .put("active", p.active)
        .put("createdAt", p.createdAt)
        .put("updatedAt", p.updatedAt)
        .put("itemCount", p.itemCount)
        .put("counts", JSONObject().put("live", p.live).put("movie", p.movie).put("series", p.series))
        .apply {
            SecureText.open(p.epgUrlSealed)?.let { put("epgUrl", it) }
            put("skipped", p.skipped)
            if (p.provider == PROVIDER_XTREAM) {
                // Mesmo formato da Web (Playlist.account): no login sob demanda, as contagens são de categorias.
                put("provider", PROVIDER_XTREAM)
                put("itemCount", 0)
                put("counts", JSONObject().put("live", 0).put("movie", 0).put("series", 0))
                put(
                    "account",
                    JSONObject()
                        .put("categories", JSONObject().put("live", p.live).put("movie", p.movie).put("series", p.series))
                        .apply { if (p.expiresAt > 0) put("expiresAt", p.expiresAt) },
                )
            }
        }

    private fun playlistEntity(p: JSONObject): PlaylistEntity {
        val remote = p.optString("provider") == PROVIDER_XTREAM
        val account = p.optJSONObject("account")
        val counts = if (remote) account?.optJSONObject("categories") else p.optJSONObject("counts")
        return PlaylistEntity(
            id = p.getString("id"),
            name = p.optString("name", "Lista"),
            source = p.optString("source", "url"),
            urlSealed = p.optStringOrNull("url")?.let(SecureText::seal),
            fileName = p.optStringOrNull("fileName"),
            active = p.optBoolean("active", true),
            createdAt = p.optLong("createdAt", System.currentTimeMillis()),
            // Zero força a atualização das listas por endereço.
            updatedAt = if (p.optString("source") == "file") p.optLong("updatedAt") else 0,
            itemCount = p.optInt("itemCount"),
            live = counts?.optInt("live") ?: 0,
            movie = counts?.optInt("movie") ?: 0,
            series = counts?.optInt("series") ?: 0,
            epgUrlSealed = p.optStringOrNull("epgUrl")?.let(SecureText::seal),
            skipped = p.optInt("skipped"),
            provider = if (remote) PROVIDER_XTREAM else null,
            expiresAt = account?.optLong("expiresAt") ?: 0,
        )
    }

    private fun favoriteJson(f: FavoriteEntity) = JSONObject()
        .put("id", f.id)
        .put("kind", f.kind)
        .put("playlistId", f.playlistId)
        .put("addedAt", f.addedAt)
        .apply {
            if (f.name != null) {
                put(
                    "snapshot",
                    JSONObject().put("name", f.name).apply {
                        f.logo?.let { put("logo", it) }
                        f.group?.let { put("group", it) }
                        f.year?.let { put("year", it) }
                    },
                )
            }
        }

    private fun favoriteFromJson(o: JSONObject): FavoriteEntity {
        val snapshot = o.optJSONObject("snapshot")
        return FavoriteEntity(
            id = o.getString("id"),
            kind = o.getString("kind"),
            playlistId = o.getString("playlistId"),
            addedAt = o.optLong("addedAt"),
            name = snapshot?.optStringOrNull("name"),
            logo = snapshot?.optStringOrNull("logo"),
            group = snapshot?.optStringOrNull("group"),
            year = snapshot?.takeIf { it.has("year") }?.optInt("year"),
        )
    }

    private fun itemJson(item: MediaItem) = JSONObject()
        .put("id", item.id)
        .put("playlistId", item.playlistId)
        .put("key", item.key)
        .put("kind", item.kind.id)
        .put("name", item.name)
        .put("url", item.url)
        .put("order", item.order)
        .apply {
            item.logo?.let { put("logo", it) }
            item.group?.let { put("group", it) }
            item.tvgId?.let { put("tvgId", it) }
            item.tvgName?.let { put("tvgName", it) }
            item.series?.let { put("series", JSONObject().put("title", it.title).put("seriesKey", it.seriesKey).put("season", it.season).put("episode", it.episode)) }
            item.year?.let { put("year", it) }
            item.duration?.let { put("duration", it) }
            item.description?.let { put("description", it) }
        }

    private fun itemFromJson(o: JSONObject) = MediaItem(
        id = o.getString("id"),
        playlistId = o.getString("playlistId"),
        key = o.getString("key"),
        kind = kindOf(o.getString("kind")),
        name = o.getString("name"),
        url = o.getString("url"),
        logo = o.optStringOrNull("logo"),
        group = o.optStringOrNull("group"),
        tvgId = o.optStringOrNull("tvgId"),
        tvgName = o.optStringOrNull("tvgName"),
        series = o.optJSONObject("series")?.let { SeriesInfo(it.getString("title"), it.getString("seriesKey"), it.optInt("season"), it.optInt("episode")) },
        year = if (o.has("year")) o.optInt("year") else null,
        duration = if (o.has("duration")) o.optInt("duration") else null,
        description = o.optStringOrNull("description"),
        order = o.optInt("order"),
    )

    private fun historyJson(h: HistoryEntity) = JSONObject()
        .put("itemId", h.itemId)
        .put("playlistId", h.playlistId)
        .put("kind", h.kind)
        .put("name", h.name)
        .apply {
            h.logo?.let { put("logo", it) }
            h.seriesId?.let { put("seriesId", it) }
            h.seriesTitle?.let { put("seriesTitle", it) }
            h.seriesLogo?.let { put("seriesLogo", it) }
            h.season?.let { put("season", it) }
            h.episode?.let { put("episode", it) }
        }
        .put("playedAt", h.playedAt)
        .put("position", h.position)
        .put("duration", h.duration)
        .put("completed", h.completed)

    private fun historyFromJson(o: JSONObject) = HistoryEntity(
        itemId = o.getString("itemId"),
        playlistId = o.getString("playlistId"),
        kind = o.optString("kind", "live"),
        name = o.optString("name"),
        logo = o.optStringOrNull("logo"),
        seriesId = o.optStringOrNull("seriesId"),
        playedAt = o.optLong("playedAt"),
        position = o.optLong("position"),
        duration = o.optLong("duration"),
        completed = o.optBoolean("completed"),
        seriesTitle = o.optStringOrNull("seriesTitle"),
        seriesLogo = o.optStringOrNull("seriesLogo"),
        season = if (o.has("season")) o.optInt("season") else null,
        episode = if (o.has("episode")) o.optInt("episode") else null,
    )

    private fun epgJson(e: EpgSourceEntity) = JSONObject()
        .put("id", e.id)
        .put("name", e.name)
        .put("source", e.source)
        .apply {
            SecureText.open(e.urlSealed)?.let { put("url", it) }
            e.fileName?.let { put("fileName", it) }
        }
        .put("updatedAt", e.updatedAt)
        .put("channelCount", e.channelCount)
        .put("programmeCount", e.programmeCount)
}

private fun JSONObject.optStringOrNull(key: String): String? = if (has(key) && !isNull(key)) optString(key).ifEmpty { null } else null
