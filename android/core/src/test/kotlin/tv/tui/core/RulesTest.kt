package tv.tui.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.json.JSONArray
import org.json.JSONObject

class RulesTest {
    @Test
    fun `texto e hash`() {
        assertEquals("noticias sao joao", normalizeText("  Notícias   São João "))
        assertEquals("811c9dc59747b28c", stableHash(""))
        assertEquals(stableHash("abc"), stableHash("abc"))
    }

    @Test
    fun `marcacoes de episodio`() {
        assertEquals(EpisodeMatch("A Série", 1, 2), matchEpisode("A Série S01E02"))
        assertEquals(EpisodeMatch("A Série", 2, 10), matchEpisode("A Série - S02 E10 - Final"))
        assertEquals(EpisodeMatch("Risadas", 1, 5), matchEpisode("Risadas 1x05"))
        assertEquals(EpisodeMatch("Coração", 2, 13), matchEpisode("Coração Temporada 2 Episódio 13"))
        assertNull(matchEpisode("TNT Series"))
        assertEquals(2019, extractYear("Filme (2019)"))
        assertNull(extractYear("Blade Runner 2049"))
    }

    @Test
    fun `titulo do episodio sem o nome da serie nem a marcacao`() {
        assertEquals("O Retorno", episodeTitle("A Série S02 E01 - O Retorno", "A Série"))
        assertNull(episodeTitle("A Série S01E01", "A Série"))
        assertEquals("Piloto", episodeTitle("A Série - S01E02 - Piloto", "A Série"))
        assertEquals("A Festa", episodeTitle("Risadas 1x05: A Festa", "Risadas"))
        assertNull(episodeTitle("T1 E2", "Qualquer"))
        assertEquals("O Começo", episodeTitle("O Começo", "Outra Série"))
        assertEquals("O Começo", episodeTitle("Outra Série - O Começo", "Outra Série"))
    }

    @Test
    fun `dados proprios dos episodios decidem entre cartoes e grade`() {
        fun ep(logo: String? = null, description: String? = null) =
            MediaItem("p:e", "p", "e", ContentKind.SERIES, "E", "http://x", logo, null, null, null, null, null, null, description, 0)
        assertFalse(hasEpisodeDetails(listOf(ep(logo = "capa.jpg"), ep()), "capa.jpg"))
        assertTrue(hasEpisodeDetails(listOf(ep(logo = "capa.jpg"), ep(logo = "ep2.jpg")), "capa.jpg"))
        assertTrue(hasEpisodeDetails(listOf(ep(description = "  "), ep(description = "Sinopse")), null))
        assertFalse(hasEpisodeDetails(listOf(ep(description = "  ")), null))
    }

    @Test
    fun `id estavel quando apenas o endereco muda`() {
        val before = ItemBuilder("p").add(parseM3u("#EXTM3U\n#EXTINF:-1 tvg-id=\"x\" group-title=\"G\",Canal X\nhttp://a.b/1?token=AAA\n").entries)
        val after = ItemBuilder("p").add(parseM3u("#EXTM3U\n#EXTINF:-1 tvg-id=\"x\" group-title=\"Outro\",Canal X\nhttp://c.d/9?token=BBB\n").entries)
        assertEquals(before[0].id, after[0].id)
    }

    @Test
    fun `validacao de enderecos`() {
        assertTrue(validateRemoteUrl(" https://example.org/lista.m3u ").ok)
        assertEquals(UrlProblem.EMPTY, validateRemoteUrl("").problem)
        assertEquals(UrlProblem.SCHEME, validateRemoteUrl("file:///etc/passwd").problem)
        assertEquals(UrlProblem.MALFORMED, validateRemoteUrl("lista.m3u").problem)
        for (url in listOf("http://localhost/a", "http://127.0.0.1/a", "http://192.168.0.10/a", "http://10.1.2.3/a", "http://[::1]/a", "http://169.254.169.254/x", "http://roteador/a", "http://nas.local/a")) {
            assertEquals(UrlProblem.PRIVATE_HOST, validateRemoteUrl(url).problem, url)
            assertTrue(validateRemoteUrl(url, allowPrivate = true).ok, url)
        }
        assertFalse(isPrivateHost("172.32.0.1"))
        assertTrue(isPrivateHost("fd00::1"))
        assertTrue(isPrivateHost("::ffff:192.168.1.1"))
    }

    @Test
    fun `credenciais mascaradas`() {
        val url = "http://provedor.example.org:8080/get.php?username=joao&password=segredo&type=m3u_plus"
        assertTrue(hasCredentials(url))
        val masked = maskUrl(url)
        assertFalse(masked.contains("joao") || masked.contains("segredo"))
        assertTrue(masked.contains("type=m3u_plus"))
        assertEquals("http://x.example.org/live/•••/•••/12.ts", maskUrl("http://x.example.org/live/joao/segredo/12.ts"))
        assertEquals("http://x.example.org:8080/•••/•••/12", maskUrl("http://x.example.org:8080/joao/segredo/12"))
        assertTrue(hasCredentials("http://x.example.org/joao/segredo/12.ts"))
        assertFalse(hasCredentials("https://example.org/lista.m3u"))
        assertNull(safeImageUrl("javascript:alert(1)"))
    }

    @Test
    fun `backup com e sem senha`() {
        val data = JSONObject()
            .put("playlists", JSONArray().put(JSONObject().put("playlist", JSONObject().put("id", "p").put("name", "Lista"))))
            .put("favorites", JSONArray())
            .put("history", JSONArray())
            .put("epgSources", JSONArray())
            .put("settings", JSONObject().put("autoplay", false))
        val plain = Backup.create(data, "android", now = 123)
        assertEquals("Lista", Backup.open(plain).getJSONArray("playlists").getJSONObject(0).getJSONObject("playlist").getString("name"))

        val secret = Backup.create(data, "android", password = "correta")
        assertFalse(secret.contains("Lista"))
        assertEquals(false, Backup.open(secret, "correta").getJSONObject("settings").getBoolean("autoplay"))
        assertEquals("wrong-password", (runCatching { Backup.open(secret, "errada") }.exceptionOrNull() as Backup.BackupException).code)
        assertEquals("not-tuitv", (runCatching { Backup.open("{\"app\":\"outro\"}") }.exceptionOrNull() as Backup.BackupException).code)
    }
}
