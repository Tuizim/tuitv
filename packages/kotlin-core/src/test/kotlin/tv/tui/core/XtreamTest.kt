package tv.tui.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Mesmos casos de "login Xtream" em packages/validation/src/validation.test.ts. */
class XtreamTest {
    @Test
    fun `normaliza o host digitado`() {
        assertEquals("http://servidor.example:8080", Xtream.normalizeHost("servidor.example:8080"))
        assertEquals("https://servidor.example", Xtream.normalizeHost(" https://servidor.example/ "))
        assertEquals("http://servidor.example:8080", Xtream.normalizeHost("http://servidor.example:8080/get.php?username=a&password=b"))
        assertEquals("http://servidor.example/painel", Xtream.normalizeHost("http://servidor.example/painel/player_api.php"))
        assertEquals("http://servidor.example", Xtream.normalizeHost("HTTP://Servidor.Example:80"))
        assertNull(Xtream.normalizeHost(""))
        assertNull(Xtream.normalizeHost("ftp://servidor.example"))
        assertNull(Xtream.normalizeHost("http://"))
    }

    @Test
    fun `monta os enderecos da lista e do guia`() {
        val login = XtreamLogin("http://servidor.example:8080", " joão ", "a&b c/+")
        assertEquals(
            "http://servidor.example:8080/get.php?username=jo%C3%A3o&password=a%26b%20c%2F%2B&type=m3u_plus&output=ts",
            Xtream.playlistUrl(login),
        )
        assertEquals("http://servidor.example:8080/xmltv.php?username=jo%C3%A3o&password=a%26b%20c%2F%2B", Xtream.epgUrl(login))
        assertTrue(hasCredentials(Xtream.playlistUrl(login)))
        assertFalse(maskUrl(Xtream.playlistUrl(login)).contains("jo%C3%A3o"))
        // Caracteres que o encodeURIComponent mantém sem codificar.
        assertEquals("~*'()-_.!", Xtream.encode("~*'()-_.!"))
    }

    @Test
    fun `recupera o login de um endereco get php`() {
        val url = Xtream.playlistUrl(XtreamLogin("http://servidor.example:8080", "joão", "a&b"))
        assertEquals(XtreamLogin("http://servidor.example:8080", "joão", "a&b"), Xtream.parse(url))
        assertNull(Xtream.parse("http://servidor.example/lista.m3u"))
        assertNull(Xtream.parse("http://servidor.example/get.php?username=a"))
    }
}
