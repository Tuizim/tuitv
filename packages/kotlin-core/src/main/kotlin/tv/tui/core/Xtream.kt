package tv.tui.core

import java.net.URI
import java.net.URLDecoder

/**
 * Login no formato Xtream Codes (host + usuário + senha) — mesmas regras de
 * packages/validation/src/index.ts (normalizeXtreamHost, xtreamPlaylistUrl, xtreamEpgUrl, parseXtreamUrl).
 */
data class XtreamLogin(
    /** Base normalizada, sem barra final (ex.: "http://servidor.com:8080"). */
    val host: String,
    val username: String,
    val password: String,
)

object Xtream {
    private val SCHEME = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://")
    private val ENDPOINT = Regex("(?i)/(get|player_api|xmltv)\\.php$")
    private val TRAILING_SLASHES = Regex("/+$")
    private val GET_PHP = Regex("(?i)/get\\.php$")

    /** Host digitado → base http(s) sem barra final; sem esquema assume http://. Null se inválido. */
    fun normalizeHost(input: String): String? {
        var raw = input.jsTrim()
        if (raw.isEmpty()) return null
        if (!SCHEME.containsMatchIn(raw)) raw = "http://$raw"
        val uri = try {
            URI(raw)
        } catch (_: Exception) {
            return null
        }
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host?.lowercase()?.ifEmpty { null } ?: return null
        val defaultPort = if (scheme == "http") 80 else 443
        val port = if (uri.port >= 0 && uri.port != defaultPort) ":${uri.port}" else ""
        val path = TRAILING_SLASHES.replace(ENDPOINT.replace(uri.rawPath ?: "", ""), "")
        return "$scheme://$host$port$path"
    }

    /** Equivalente a encodeURIComponent do JavaScript (após remover espaços nas pontas). */
    fun encode(value: String): String {
        val out = StringBuilder()
        for (byte in value.jsTrim().toByteArray(Charsets.UTF_8)) {
            val c = byte.toInt() and 0xff
            val ch = c.toChar()
            if (ch in 'A'..'Z' || ch in 'a'..'z' || ch in '0'..'9' || ch in "-_.!~*'()") out.append(ch)
            else out.append('%').append("%02X".format(c))
        }
        return out.toString()
    }

    fun playlistUrl(login: XtreamLogin): String =
        "${login.host}/get.php?username=${encode(login.username)}&password=${encode(login.password)}&type=m3u_plus&output=ts"

    fun epgUrl(login: XtreamLogin): String =
        "${login.host}/xmltv.php?username=${encode(login.username)}&password=${encode(login.password)}"

    /** Host, usuário e senha de um endereço get.php (null se não for um login Xtream). */
    fun parse(url: String): XtreamLogin? {
        val uri = try {
            URI(url)
        } catch (_: Exception) {
            return null
        }
        if (!GET_PHP.containsMatchIn(uri.rawPath ?: "")) return null
        val params = (uri.rawQuery ?: "").split('&').mapNotNull {
            val eq = it.indexOf('=')
            if (eq <= 0) null else it.substring(0, eq) to it.substring(eq + 1)
        }.toMap()
        fun param(name: String) = params[name]?.let { runCatching { URLDecoder.decode(it, "UTF-8") }.getOrNull() }?.ifEmpty { null }
        val username = param("username") ?: return null
        val password = param("password") ?: return null
        val host = normalizeHost(url) ?: return null
        return XtreamLogin(host, username, password)
    }
}
