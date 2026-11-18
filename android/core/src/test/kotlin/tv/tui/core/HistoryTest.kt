package tv.tui.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Mesmos casos de web/packages/business-rules/src/history.test.ts. */
class HistoryTest {
    private data class Entry(val itemId: String, val playedAt: Long, val seriesId: String? = null, val season: Int? = null, val episode: Int? = null)

    private fun ep(season: Int, n: Int, playedAt: Long, id: String = "p:e${season}x$n", sid: String = "p:s:serie") = Entry(id, playedAt, sid, season, n)
    private fun collapse(list: List<Entry>) = collapseSeriesHistory(list, { it.seriesId }) { EpisodeOrder(it.season, it.episode, it.playedAt) }

    private fun episode(season: Int, n: Int) = MediaItem(
        "p:e${season}x$n", "p", "e${season}x$n", ContentKind.SERIES, "Ep ${season}x$n", "http://x/$season/$n",
        null, null, null, null, SeriesInfo("Série", "serie", season, n), null, null, null, season * 100 + n,
    )

    private val series = groupSeries(listOf(episode(1, 1), episode(1, 2), episode(2, 1), episode(2, 2))).first()
    private fun progress(vararg pairs: Pair<String, EpisodeProgress>): (String) -> EpisodeProgress? = pairs.toMap()::get

    @Test
    fun `serie aparece uma vez, no lugar do episodio visto por ultimo, representada pelo mais adiante`() {
        val rows = collapse(listOf(ep(1, 2, 90), Entry("p:filme", 80), ep(2, 1, 70), Entry("p:canal", 60), ep(1, 1, 50)))
        assertEquals(listOf("p:e2x1", "p:filme", "p:canal"), rows.map { it.entry.itemId })
        assertEquals(listOf("p:e1x2", "p:e2x1", "p:e1x1"), rows[0].episodes!!.map { it.itemId })
    }

    @Test
    fun `sem temporada e episodio conhecidos vale o visto por ultimo`() {
        val rows = collapse(listOf(ep(0, 0, 90, id = "p:a"), ep(0, 0, 50, id = "p:b")))
        assertEquals(listOf("p:a"), rows.map { it.entry.itemId })
    }

    @Test
    fun `series diferentes ficam em linhas diferentes`() {
        assertEquals(2, collapse(listOf(ep(1, 1, 90), ep(1, 1, 80, id = "p:outra", sid = "p:s:outra"))).size)
    }

    @Test
    fun `retoma o episodio mais adiante iniciado`() {
        val target = continueEpisode(series, progress("p:e2x1" to EpisodeProgress(300, false), "p:e1x1" to EpisodeProgress(0, true)))!!
        assertEquals("p:e2x1", target.episode.id)
        assertTrue(target.resume)
    }

    @Test
    fun `episodio mais adiante concluido segue para o proximo`() {
        val target = continueEpisode(series, progress("p:e1x2" to EpisodeProgress(0, true)))!!
        assertEquals("p:e2x1", target.episode.id)
        assertFalse(target.resume)
    }

    @Test
    fun `nada assistido ou serie inteira vista comeca do primeiro`() {
        assertEquals("p:e1x1", continueEpisode(series, progress())!!.episode.id)
        assertEquals("p:e1x1", continueEpisode(series, progress("p:e2x2" to EpisodeProgress(0, true)))!!.episode.id)
    }
}
