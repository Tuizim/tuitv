package tv.tui.core

import java.net.URI

/** Validação de endereços — mesmas regras de packages/validation/src/index.ts. */
enum class UrlProblem { EMPTY, MALFORMED, SCHEME, PRIVATE_HOST }

data class UrlCheck(val url: String?, val problem: UrlProblem?) {
    val ok get() = problem == null
}

private val IPV4 = Regex("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$")
private val MAPPED_V4 = Regex("^::ffff:(\\d+\\.\\d+\\.\\d+\\.\\d+)$")
private val SECRET_PARAM = Regex("(?i)^(username|user|login|password|pass|pwd|token|key|apikey|api_key|auth|signature|sig|secret|hash)$")
private val XTREAM_PATH = Regex("^/(live|movie|series)/[^/]+/[^/]+/")
private val DIRECT_PATH = Regex("^/[^/.]+/[^/.]+/(\\d+(?:\\.\\w+)?)$")
private val HTTP_URL = Regex("(?i)^https?://")
private val DATA_IMAGE = Regex("(?i)^data:image/(png|jpeg|jpg|gif|webp);base64,")

/** Indica se o host aponta para loopback, rede privada, link-local ou nomes internos. */
fun isPrivateHost(hostname: String): Boolean {
    var host = hostname.lowercase().removeSuffix(".")
    if (host.startsWith("[") && host.endsWith("]")) host = host.substring(1, host.length - 1)
    if (host.isEmpty()) return true
    if (host == "localhost" || host.endsWith(".localhost")) return true
    if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".home")) return true
    IPV4.find(host)?.let { m ->
        val parts = m.groupValues.drop(1).map { it.toInt() }
        if (parts.all { it <= 255 }) {
            val (a, b) = parts
            return a == 0 || a == 10 || a == 127 ||
                (a == 169 && b == 254) || (a == 172 && b in 16..31) || (a == 192 && b == 168) || (a == 100 && b in 64..127)
        }
    }
    if (host.contains(':')) {
        if (host == "::" || host == "::1") return true
        if (host.startsWith("fc") || host.startsWith("fd")) return true
        if (Regex("^fe[89ab]").containsMatchIn(host)) return true
        MAPPED_V4.find(host)?.let { return isPrivateHost(it.groupValues[1]) }
        return false
    }
    // Nome sem ponto (ex.: "roteador") resolve apenas na rede interna.
    return !host.contains('.')
}

/** Valida um endereço remoto a ser baixado pelo aplicativo (lista ou EPG). */
fun validateRemoteUrl(input: String, allowPrivate: Boolean = false): UrlCheck {
    val raw = input.jsTrim()
    if (raw.isEmpty()) return UrlCheck(null, UrlProblem.EMPTY)
    val uri = try {
        URI(raw)
    } catch (_: Exception) {
        return UrlCheck(null, UrlProblem.MALFORMED)
    }
    val scheme = uri.scheme?.lowercase() ?: return UrlCheck(null, UrlProblem.MALFORMED)
    if (scheme != "http" && scheme != "https") return UrlCheck(null, UrlProblem.SCHEME)
    val host = uri.host ?: return UrlCheck(null, UrlProblem.MALFORMED)
    if (!allowPrivate && isPrivateHost(host)) return UrlCheck(null, UrlProblem.PRIVATE_HOST)
    return UrlCheck(raw, null)
}

private fun queryParams(uri: URI): List<Pair<String, String>> =
    (uri.rawQuery ?: "").split('&').filter { it.isNotEmpty() }.map {
        val eq = it.indexOf('=')
        if (eq < 0) it to "" else it.substring(0, eq) to it.substring(eq + 1)
    }

/** O endereço carrega credenciais ou tokens (userinfo, parâmetros ou caminho no estilo /usuario/senha/). */
fun hasCredentials(input: String): Boolean = try {
    val uri = URI(input)
    uri.userInfo != null || queryParams(uri).any { SECRET_PARAM.matches(it.first) } || XTREAM_PATH.containsMatchIn(uri.path ?: "") || DIRECT_PATH.containsMatchIn(uri.path ?: "")
} catch (_: Exception) {
    false
}

/** Versão do endereço segura para exibição e registros: oculta credenciais e tokens. */
fun maskUrl(input: String): String = try {
    val uri = URI(input)
    val out = StringBuilder("${uri.scheme}://")
    if (uri.userInfo != null) out.append("•••@")
    out.append(uri.host)
    if (uri.port >= 0) out.append(":${uri.port}")
    out.append(DIRECT_PATH.replace(XTREAM_PATH.replace(uri.rawPath ?: "", "/$1/•••/•••/"), "/•••/•••/$1"))
    val params = queryParams(uri).map { (key, value) -> "$key=${if (SECRET_PARAM.matches(key) || value.length > 24) "•••" else value}" }
    if (params.isNotEmpty()) out.append("?").append(params.joinToString("&"))
    out.toString()
} catch (_: Exception) {
    "•••"
}

/** Endereços de imagem aceitos em logotipos e capas. */
fun safeImageUrl(input: String?): String? {
    val value = input?.jsTrim()
    if (value.isNullOrEmpty()) return null
    return if (HTTP_URL.containsMatchIn(value) || DATA_IMAGE.containsMatchIn(value)) value else null
}
