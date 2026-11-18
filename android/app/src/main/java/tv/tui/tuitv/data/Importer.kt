package tv.tui.tuitv.data

import android.database.sqlite.SQLiteFullException
import androidx.room.withTransaction
import tv.tui.core.ItemBuilder
import tv.tui.core.M3uEntry
import tv.tui.core.M3uParser
import tv.tui.core.XmltvBatch
import tv.tui.core.XmltvParser
import tv.tui.core.XmltvWindow
import tv.tui.core.epgUrlFromHeader
import tv.tui.core.looksLikeM3u
import tv.tui.tuitv.data.db.AppDatabase
import tv.tui.tuitv.data.db.EpgChannelEntity
import tv.tui.tuitv.data.db.ItemEntity
import tv.tui.tuitv.data.db.ProgrammeEntity

data class ImportProgress(val loaded: Long, val total: Long?, val count: Int)

data class PlaylistImportResult(val count: Int, val live: Int, val movie: Int, val series: Int, val skipped: Int, val epgUrl: String?)

data class EpgImportResult(val channelCount: Int, val programmeCount: Int)

private const val BATCH = 2000

/** Janela de programas mantida localmente: 12 horas atrás até três dias à frente (como na Web). */
fun epgWindow(now: Long = System.currentTimeMillis()) = XmltvWindow(from = now - 12 * 3_600_000L, to = now + 72 * 3_600_000L)

/** Porte de web/app/src/lib/importer.ts sobre Room. */
class Importer(private val db: AppDatabase) {

    private suspend fun <T> storage(block: suspend () -> T): T = try {
        block()
    } catch (e: SQLiteFullException) {
        throw ImportException(ImportError.STORAGE, cause = e)
    }

    /**
     * Importa uma lista M3U/M3U8 de forma incremental: lê, interpreta e grava em lotes.
     * Ids determinísticos: gravar por cima de uma importação anterior não duplica itens.
     * Itens que não existem mais na lista só são removidos depois de uma importação completa.
     */
    suspend fun importPlaylist(playlistId: String, source: ByteSource, onProgress: (ImportProgress) -> Unit): PlaylistImportResult {
        val gen = System.currentTimeMillis()
        val parser = M3uParser()
        val builder = ItemBuilder(playlistId)
        var pending = ArrayList<ItemEntity>(BATCH)
        var loaded = 0L
        var total = source.total
        var checked = false
        val head = StringBuilder()

        suspend fun flush() {
            if (pending.isEmpty()) return
            val batch = pending
            pending = ArrayList(BATCH)
            storage { db.items().insertAll(batch) }
            onProgress(ImportProgress(loaded, total, builder.total))
        }

        fun accept(entries: List<M3uEntry>) {
            for (item in builder.add(entries)) pending.add(item.toEntity(gen))
        }

        readText(source, Limits.MAX_PLAYLIST_BYTES, { l, t -> loaded = l; total = t }) { text ->
            if (!checked) {
                head.append(text)
                if (head.length < 2048) return@readText
                if (!looksLikeM3u(head.toString())) throw ImportException(ImportError.NOT_M3U)
                checked = true
                accept(parser.push(head.toString()))
                head.clear()
            } else {
                accept(parser.push(text))
            }
            if (pending.size >= BATCH) flush() else onProgress(ImportProgress(loaded, total, builder.total))
        }
        if (!checked) {
            if (!looksLikeM3u(head.toString())) throw ImportException(ImportError.NOT_M3U)
            accept(parser.push(head.toString()))
        }
        accept(parser.end())
        if (builder.total == 0) throw ImportException(if (parser.isHlsManifest) ImportError.HLS_MANIFEST else ImportError.EMPTY)
        flush()
        storage { db.items().deleteStale(playlistId, gen) }
        onProgress(ImportProgress(loaded, total, builder.total))
        return PlaylistImportResult(builder.total, builder.live, builder.movies, builder.episodes, parser.errorCount, epgUrlFromHeader(parser.header))
    }

    /** Importa um guia XMLTV. O guia anterior só é substituído depois que o novo conteúdo se mostra válido. */
    suspend fun importEpg(sourceId: String, source: ByteSource, onProgress: (ImportProgress) -> Unit): EpgImportResult {
        val parser = XmltvParser(epgWindow())
        var channels = ArrayList<EpgChannelEntity>()
        var programmes = ArrayList<ProgrammeEntity>(BATCH)
        var channelCount = 0
        var loaded = 0L
        var total = source.total
        var checked = false
        var cleared = false
        val head = StringBuilder()

        suspend fun flush() {
            val c = channels
            val p = programmes
            channels = ArrayList()
            programmes = ArrayList(BATCH)
            storage {
                db.withTransaction {
                    if (!cleared) {
                        db.epg().deleteChannels(sourceId)
                        db.epg().deleteProgrammes(sourceId)
                        cleared = true
                    }
                    if (c.isNotEmpty()) db.epg().upsertChannels(c)
                    if (p.isNotEmpty()) db.epg().insertProgrammes(p)
                }
            }
            onProgress(ImportProgress(loaded, total, parser.programmeCount))
        }

        fun accept(batch: XmltvBatch) {
            for (channel in batch.channels) {
                channelCount++
                channels.add(
                    EpgChannelEntity(
                        id = "$sourceId|${channel.id}",
                        sourceId = sourceId,
                        channelId = channel.id,
                        displayNames = channel.displayNames.take(6).joinToString("\u0001"),
                        icon = channel.icon,
                    ),
                )
            }
            for (p in batch.programmes) {
                programmes.add(ProgrammeEntity(0, sourceId, p.channelId, p.start, p.stop, p.title, p.description, p.category))
            }
        }

        readText(source, Limits.MAX_EPG_BYTES, { l, t -> loaded = l; total = t }) { text ->
            if (!checked) {
                head.append(text)
                if (head.length < 2048) return@readText
                if (!XmltvParser.looksLikeXmltv(head.toString())) throw ImportException(ImportError.NOT_XMLTV)
                checked = true
                accept(parser.push(head.toString()))
                head.clear()
            } else {
                accept(parser.push(text))
            }
            if (programmes.size >= BATCH) flush() else onProgress(ImportProgress(loaded, total, parser.programmeCount))
        }
        if (!checked) {
            if (!XmltvParser.looksLikeXmltv(head.toString())) throw ImportException(ImportError.NOT_XMLTV)
            accept(parser.push(head.toString()))
        }
        accept(parser.end())
        if (channelCount == 0 && parser.programmeCount == 0) throw ImportException(ImportError.EMPTY)
        flush()
        return EpgImportResult(channelCount, parser.programmeCount)
    }
}
