package tv.tui.core

import java.io.File
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Mesmos casos de packages/business-rules/src/rules.test.ts para as regras portadas ao Kotlin. */
class PortedRulesTest {
    private val fixtures = File(System.getProperty("tuitv.fixtures"))
    private fun build(name: String) = ItemBuilder("p1").add(parseM3u(File(fixtures, name).readText()).entries)
    private fun utc(y: Int, mo: Int, d: Int, h: Int = 0, mi: Int = 0) =
        java.time.LocalDateTime.of(y, mo, d, h, mi).toEpochSecond(java.time.ZoneOffset.UTC) * 1000

    @Test
    fun `organiza series, temporadas e episodios`() {
        val items = build("vod.m3u")
        val series = groupSeries(items)
        assertEquals(listOf("A Série", "Aventura", "Coração Valente", "Minissérie Sem Marcação", "Risadas"), series.map { it.title }.sorted())
        val a = series.first { it.title == "A Série" }
        assertEquals(listOf(1 to listOf(1, 2), 2 to listOf(1)), a.seasons.map { s -> s.season to s.episodes.map { it.series!!.episode } })
        val risadas = series.first { it.title == "Risadas" }
        assertEquals(listOf(4, 5), risadas.seasons[0].episodes.map { it.series!!.episode })
        assertEquals("A Série S01E02", nextEpisode(a, a.seasons[0].episodes[0].id)?.name)
        assertNull(nextEpisode(a, a.seasons[1].episodes[0].id))
    }

    @Test
    fun `lista categorias com contagem`() {
        assertEquals(
            listOf(GroupCount("Abertos", 4), GroupCount("Esportes", 1), GroupCount("Notícias", 1)),
            listGroups(build("basic.m3u").map { it.group }),
        )
    }

    @Test
    fun `busca sem acentos e ordena por relevancia`() {
        val index = toSearchable(build("basic.m3u")) { it.name }
        assertEquals(listOf("Notícias 24h"), searchIn(index, "noticias").map { it.name })
        assertEquals(listOf("Canal Um HD", "Canal Um SD"), searchIn(index, "um canal").map { it.name })
        assertTrue(searchIn(index, "   ").isEmpty())
        assertEquals(2, searchIn(index, "canal", 2).size)
    }

    @Test
    fun `busca em 100 mil itens dentro da meta`() {
        val index = toSearchable((0 until 100_000).map { "Canal Número $it HD" }) { it }
        val started = System.nanoTime()
        assertEquals(listOf("Canal Número 99999 HD"), searchIn(index, "numero 99999"))
        assertTrue((System.nanoTime() - started) / 1_000_000 < 500)
    }

    private val xml = """<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="teste">
  <channel id="canal.um"><display-name lang="pt">Canal Um</display-name><display-name>Canal Um HD</display-name><icon src="https://example.org/um.png"/></channel>
  <channel id="Canal.Dois"><display-name>Canal Dois</display-name></channel>
  <programme start="20240501120000 +0000" stop="20240501130000 +0000" channel="canal.um"><title lang="pt">Jornal &amp; Not&#237;cias</title><desc>Resumo do dia.</desc><category>Jornalismo</category></programme>
  <programme start="20240501100000 -0300" stop="20240501110000 -0300" channel="canal.um"><title><![CDATA[Filme <Especial>]]></title></programme>
  <programme start="20240501140000 +0000" channel="Canal.Dois"><title>Sem fim</title></programme>
  <programme start="invalida" channel="canal.um"><title>Ruim</title></programme>
</tv>"""

    @Test
    fun `interpreta datas com fuso`() {
        assertEquals(utc(2024, 5, 1, 12), parseXmltvDate("20240501120000 +0000"))
        assertEquals(utc(2024, 5, 1, 13), parseXmltvDate("20240501100000 -0300"))
        assertEquals(utc(2024, 5, 1, 6, 30), parseXmltvDate("20240501120000 +0530"))
        assertEquals(utc(2024, 5, 1, 12), parseXmltvDate("202405011200"))
        assertEquals(utc(1999, 12, 31, 23, 59), parseXmltvDate("199912312359"))
        assertEquals(utc(2024, 2, 29), parseXmltvDate("20240229"))
        assertNull(parseXmltvDate("ontem"))
    }

    @Test
    fun `le canais e programas`() {
        val (channels, programmes) = parseXmltv(xml)
        assertEquals(
            listOf(
                XmltvChannel("canal.um", listOf("Canal Um", "Canal Um HD"), "https://example.org/um.png"),
                XmltvChannel("Canal.Dois", listOf("Canal Dois")),
            ),
            channels,
        )
        assertEquals(3, programmes.size)
        assertEquals(
            XmltvProgramme("canal.um", utc(2024, 5, 1, 12), utc(2024, 5, 1, 13), "Jornal & Notícias", "Resumo do dia.", "Jornalismo"),
            programmes[0],
        )
        assertEquals("Filme <Especial>", programmes[1].title)
        assertEquals(30 * 60_000L, programmes[2].stop - programmes[2].start)
    }

    @Test
    fun `xmltv incremental e com janela de tempo`() {
        for (size in listOf(1, 13, 200)) {
            val parser = XmltvParser()
            var channels = 0
            var programmes = 0
            var i = 0
            while (i < xml.length) {
                val batch = parser.push(xml.substring(i, minOf(xml.length, i + size)))
                channels += batch.channels.size
                programmes += batch.programmes.size
                i += size
            }
            val last = parser.end()
            assertEquals(2, channels + last.channels.size)
            assertEquals(3, programmes + last.programmes.size)
            assertEquals(1, parser.skipped)
        }
        assertEquals(listOf("Sem fim"), parseXmltv(xml, XmltvWindow(from = utc(2024, 5, 1, 14, 15))).programmes.map { it.title })
        assertTrue(XmltvParser.looksLikeXmltv(xml))
        assertFalse(XmltvParser.looksLikeXmltv("#EXTM3U"))
    }

    @Test
    fun `associa canais por tvg-id e por nome`() {
        val index = buildEpgIndex(parseXmltv(xml).channels.map { EpgIndexEntry(it.id, it.id, it.displayNames) })
        assertEquals("canal.um", resolveEpgChannel("CANAL.UM", null, "x", index))
        assertEquals("Canal.Dois", resolveEpgChannel(null, null, "canal dois", index))
        assertEquals("canal.um", resolveEpgChannel(null, "Canal Um HD", "x", index))
        assertNull(resolveEpgChannel(null, null, "Desconhecido", index))
    }

    private data class P(override val start: Long, override val stop: Long, val title: String) : Timed

    @Test
    fun `programa atual e proximos`() {
        val list = listOf(P(0, 10, "A"), P(10, 20, "B"), P(20, 30, "C"), P(30, 40, "D"))
        val result = nowNext(list, 12, 1)
        assertEquals("B", result.current?.title)
        assertEquals(listOf("C"), result.next.map { it.title })
        assertNull(nowNext(list, 100).current)
        assertEquals(0.5f, programmeProgress(10, 20, 15))
    }

    @Test
    fun `pbkdf2 igual ao da JVM`() {
        val salt = "sal-de-teste".toByteArray()
        for ((secret, iterations) in listOf("1234" to 1, "senha çom acento" to 1000, "" to 3)) {
            val expected = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                .generateSecret(PBEKeySpec(secret.toCharArray(), salt, iterations, 256)).encoded
            assertContentEquals(expected, Crypto.pbkdf2Sha256(secret, salt, iterations, 256))
        }
        // RFC 7914 §11: P="passwd", S="salt", c=1, dkLen=64.
        val rfc = Crypto.pbkdf2Sha256("passwd", "salt".toByteArray(), 1, 512).joinToString("") { "%02x".format(it) }
        assertTrue(rfc.startsWith("55ac046e56e3089fec1691c22544b605"))
    }

    @Test
    fun `controle parental`() {
        val hashed = Parental.hashPin("1234")
        assertFalse(hashed.pinHash.contains("1234"))
        assertTrue(Parental.verifyPin("1234", hashed.pinHash, hashed.pinSalt))
        assertFalse(Parental.verifyPin("4321", hashed.pinHash, hashed.pinSalt))
        assertTrue(Parental.isValidPin("0000"))
        assertFalse(Parental.isValidPin("12a4"))

        assertTrue(Parental.isAdultLabel("Adultos +18"))
        assertTrue(Parental.isAdultLabel("Canais XXX"))
        assertFalse(Parental.isAdultLabel("Filmes | Ação"))
        assertFalse(Parental.isAdultLabel("Esportes"))
        val blocked = assertNotNull(Parental.restriction(true, true, listOf("terror"), unlocked = false))
        assertTrue(blocked("Adultos", "a"))
        assertTrue(blocked("Terror", "a"))
        assertFalse(blocked("Infantil", "a"))
        assertNull(Parental.restriction(true, true, listOf("terror"), unlocked = true))
        assertNull(Parental.restriction(false, true, listOf("terror"), unlocked = false))
    }

    @Test
    fun `variante hls e conclusao`() {
        assertEquals("http://h.example/live/u/p/1.m3u8", Playback.hlsVariant("http://h.example/live/u/p/1.ts"))
        assertEquals("http://h.example:8080/live/u/p/77.m3u8?x=1", Playback.hlsVariant("http://h.example:8080/u/p/77?x=1"))
        assertNull(Playback.hlsVariant("http://h.example/canal.m3u8"))
        assertTrue(Playback.isCompleted(93, 100, false))
        assertFalse(Playback.isCompleted(50, 100, false))
        assertTrue(Playback.isCompleted(0, 0, true))
    }
}
