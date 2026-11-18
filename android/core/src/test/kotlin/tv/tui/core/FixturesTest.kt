package tv.tui.core

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.json.JSONObject

/**
 * Arquivos de referência compartilhados entre plataformas (PRD RF-004).
 * O resultado canônico em fixtures/expected/ é gerado pela implementação TypeScript
 * (`pnpm fixtures:update`); este teste exige que o porte Kotlin produza exatamente o mesmo.
 */
class FixturesTest {
    private val dir = File(System.getProperty("tuitv.fixtures"))

    private fun JSONObject.nullable(key: String): Any? = if (isNull(key)) null else get(key)

    @Test
    fun `parser e classificacao coincidem com o TypeScript`() {
        val files = dir.listFiles { f -> f.extension == "m3u" }!!.sortedBy { it.name }
        assertTrue(files.size >= 4, "arquivos de referência ausentes")
        for (file in files) {
            val expected = JSONObject(File(dir, "expected/${file.nameWithoutExtension}.json").readText())
            val result = parseM3u(file.readText(Charsets.UTF_8))
            val label = file.name

            assertEquals(expected.getBoolean("headerFound"), result.header.found, "$label: cabeçalho")
            assertEquals(expected.getJSONObject("headerAttrs").toMap(), result.header.attrs, "$label: atributos do cabeçalho")

            val errors = expected.getJSONArray("errors")
            assertEquals(
                (0 until errors.length()).map { errors.getJSONObject(it).let { e -> e.getInt("line") to e.getString("code") } },
                result.errors.map { it.line to it.code },
                "$label: erros",
            )

            val items = ItemBuilder("p").add(result.entries)
            val expectedItems = expected.getJSONArray("items")
            assertEquals(expectedItems.length(), items.size, "$label: quantidade de itens")
            for (i in items.indices) {
                val e = expectedItems.getJSONObject(i)
                val item = items[i]
                val at = "$label #$i (${item.name})"
                assertEquals(e.getString("key"), item.key, "$at: chave")
                assertEquals(e.getString("kind"), item.kind.id, "$at: tipo")
                assertEquals(e.getString("name"), item.name, "$at: nome")
                assertEquals(e.getString("url"), item.url, "$at: endereço")
                assertEquals(e.nullable("logo"), item.logo, "$at: logotipo")
                assertEquals(e.nullable("group"), item.group, "$at: categoria")
                assertEquals(e.nullable("tvgId"), item.tvgId, "$at: tvg-id")
                assertEquals(e.nullable("seriesTitle"), item.series?.title, "$at: série")
                assertEquals(e.nullable("seriesKey"), item.series?.seriesKey, "$at: chave da série")
                assertEquals(e.nullable("season"), item.series?.season, "$at: temporada")
                assertEquals(e.nullable("episode"), item.series?.episode, "$at: episódio")
                assertEquals(e.nullable("year"), item.year, "$at: ano")
                assertEquals(e.nullable("duration"), item.duration, "$at: duração")
            }
        }
    }

    @Test
    fun `resultado independe do tamanho dos pedacos`() {
        for (file in dir.listFiles { f -> f.extension == "m3u" }!!) {
            val text = file.readText(Charsets.UTF_8)
            val whole = parseM3u(text)
            for (size in listOf(1, 7, 64, 1000)) {
                val parser = M3uParser()
                val entries = ArrayList<M3uEntry>()
                var i = 0
                while (i < text.length) {
                    entries.addAll(parser.push(text.substring(i, minOf(text.length, i + size))))
                    i += size
                }
                entries.addAll(parser.end())
                assertEquals(whole.entries, entries, "${file.name} em pedaços de $size")
                assertEquals(whole.errors, parser.errors)
            }
        }
    }

    @Test
    fun `restaura backup cifrado gerado pela versao Web`() {
        val text = File(dir, "backup/web-encrypted.json").readText()
        val data = Backup.open(text, "tuitv-fixture")
        val playlists = data.getJSONArray("playlists")
        assertEquals(1, playlists.length())
        assertEquals("Referência", playlists.getJSONObject(0).getJSONObject("playlist").getString("name"))
        assertEquals(6, playlists.getJSONObject(0).getJSONArray("items").length())
        assertEquals(1, data.getJSONArray("favorites").length())
        assertEquals("wrong-password", runCatching { Backup.open(text, "errada") }.exceptionOrNull().let { (it as Backup.BackupException).code })
        assertEquals("password-required", runCatching { Backup.open(text) }.exceptionOrNull().let { (it as Backup.BackupException).code })
    }
}
