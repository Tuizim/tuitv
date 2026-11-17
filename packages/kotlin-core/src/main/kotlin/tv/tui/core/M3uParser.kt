package tv.tui.core

/**
 * Interpretador M3U/M3U8 do TuiTV — porte fiel de packages/m3u-parser/src/index.ts.
 * As regras estão descritas naquele arquivo; ambos são validados pelos mesmos
 * arquivos de referência (packages/m3u-parser/fixtures).
 */
data class M3uEntry(
    val name: String,
    val url: String,
    /** Segundos; -1 quando desconhecida/ao vivo. */
    val duration: Double,
    val attrs: Map<String, String>,
    val tvgId: String?,
    val tvgName: String?,
    val tvgLogo: String?,
    val groupTitle: String?,
    val options: Map<String, String>?,
    /** Linha (1-based) do endereço. */
    val line: Int,
)

data class M3uError(val line: Int, val code: String, val raw: String)

class M3uHeader {
    var found = false
        internal set
    val attrs = LinkedHashMap<String, String>()
}

data class M3uResult(val header: M3uHeader, val entries: List<M3uEntry>, val errors: List<M3uError>, val isHlsManifest: Boolean)

data class ParsedAttributes(val attrs: Map<String, String>, val end: Int, val ok: Boolean)

private val URL_RE = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://\\S+")
private val DURATION_RE = Regex("^[+-]?(\\d+\\.?\\d*|\\.\\d+)")
private val EXTENSION_RE = Regex("\\.[a-zA-Z0-9]{2,5}$")
private val UNDERSCORES = Regex("_+")
private val LINE_BREAK = Regex("\\r\\n|\\n|\\r")
private const val MAX_ERRORS = 500

/** Lê pares chave="valor" a partir de [start] até encontrar a vírgula que antecede o nome. */
fun parseAttributes(text: String, start: Int = 0): ParsedAttributes {
    val attrs = LinkedHashMap<String, String>()
    var i = start
    val n = text.length
    while (i < n) {
        while (i < n && (text[i] == ' ' || text[i] == '\t')) i++
        if (i >= n) return ParsedAttributes(attrs, n, true)
        if (text[i] == ',') return ParsedAttributes(attrs, i, true)
        val keyStart = i
        while (i < n && text[i] != '=' && text[i] != ',' && text[i] != ' ' && text[i] != '\t') i++
        if (i >= n || text[i] != '=') return ParsedAttributes(attrs, keyStart, false)
        val key = text.substring(keyStart, i).lowercase()
        i++
        val value: String
        if (i < n && text[i] == '"') {
            val close = text.indexOf('"', i + 1)
            if (close == -1) return ParsedAttributes(attrs, keyStart, false)
            value = text.substring(i + 1, close)
            i = close + 1
        } else {
            val valueStart = i
            while (i < n && text[i] != ' ' && text[i] != '\t' && text[i] != ',') i++
            value = text.substring(valueStart, i)
        }
        if (key.isNotEmpty()) attrs[key] = value.jsTrim()
    }
    return ParsedAttributes(attrs, n, true)
}

private class ExtInf(val duration: Double, val attrs: Map<String, String>, val name: String, val line: Int, val raw: String, val malformed: Boolean)

private fun parseExtInf(raw: String, line: Int): ExtInf {
    val body = raw.substring("#EXTINF:".length)
    var i = 0
    while (i < body.length && body[i] == ' ') i++
    val durStart = i
    while (i < body.length && (body[i].isAsciiDigit() || body[i] == '.' || body[i] == '+' || body[i] == '-')) i++
    val duration = DURATION_RE.find(body.substring(durStart, i))?.value?.toDoubleOrNull() ?: -1.0

    val parsed = parseAttributes(body, i)
    val name: String
    var malformed = false
    if (parsed.ok && parsed.end < body.length && body[parsed.end] == ',') {
        name = body.substring(parsed.end + 1)
    } else if (parsed.ok && parsed.end >= body.length) {
        name = ""
        malformed = parsed.attrs.isEmpty() && i == durStart
    } else {
        // Atributos fora do padrão: usa o texto após a última vírgula como nome.
        val comma = body.lastIndexOf(',')
        name = if (comma >= 0) body.substring(comma + 1) else ""
        malformed = comma < 0
    }
    return ExtInf(duration, parsed.attrs, name.jsTrim(), line, raw, malformed)
}

private fun Char.isAsciiDigit() = this in '0'..'9'

/** Decodifica sequências %XX como UTF-8; lança em sequência malformada (como decodeURIComponent). */
private fun percentDecode(text: String): String {
    if (!text.contains('%')) return text
    val bytes = java.io.ByteArrayOutputStream()
    var i = 0
    while (i < text.length) {
        val c = text[i]
        if (c == '%') {
            require(i + 3 <= text.length) { "malformado" }
            val hex = text.substring(i + 1, i + 3)
            bytes.write(hex.toInt(16))
            i += 3
        } else {
            val cp = text.codePointAt(i)
            val s = String(Character.toChars(cp))
            bytes.write(s.toByteArray(Charsets.UTF_8))
            i += Character.charCount(cp)
        }
    }
    val decoder = Charsets.UTF_8.newDecoder()
    return decoder.decode(java.nio.ByteBuffer.wrap(bytes.toByteArray())).toString()
}

/** Nome legível derivado do último segmento do endereço. */
fun nameFromUrl(url: String): String {
    val noQuery = url.split('?', '#').first()
    var last = noQuery.split('/').lastOrNull { it.isNotEmpty() } ?: url
    last = try {
        percentDecode(last)
    } catch (_: Exception) {
        last
    }
    val cleaned = UNDERSCORES.replace(EXTENSION_RE.replace(last, ""), " ").jsTrim()
    return cleaned.ifEmpty { url }
}

/**
 * Interpretador incremental: alimente com [push] e finalize com [end].
 * Permite processar listas extensas sem manter o texto completo em memória.
 */
class M3uParser {
    val header = M3uHeader()
    val errors = ArrayList<M3uError>()
    var errorCount = 0
        private set
    var entryCount = 0
        private set
    var isHlsManifest = false
        private set

    private var buffer = ""
    private var lineNo = 0
    private var started = false
    private var pending: ExtInf? = null
    private var pendingGroup: String? = null
    private var pendingOptions: LinkedHashMap<String, String>? = null

    fun push(chunk: String): List<M3uEntry> {
        val out = ArrayList<M3uEntry>()
        var data = buffer + chunk
        // Um \r no fim do pedaço pode ser metade de um \r\n: aguarda o próximo pedaço.
        var carry = ""
        if (data.endsWith("\r")) {
            carry = "\r"
            data = data.dropLast(1)
        }
        val lines = LINE_BREAK.split(data)
        buffer = lines.last() + carry
        for (index in 0 until lines.size - 1) handleLine(lines[index], out)
        return out
    }

    fun end(): List<M3uEntry> {
        val out = ArrayList<M3uEntry>()
        val rest = buffer
        buffer = ""
        if (rest.isNotEmpty()) for (line in LINE_BREAK.split(rest)) handleLine(line, out)
        pending?.let { addError(it.line, "missing-url", it.raw) }
        pending = null
        return out
    }

    private fun addError(line: Int, code: String, raw: String) {
        errorCount++
        if (errors.size < MAX_ERRORS) errors.add(M3uError(line, code, raw.take(200)))
    }

    private fun handleLine(rawLine: String, out: MutableList<M3uEntry>) {
        lineNo++
        val line = rawLine.jsTrim() // remove também o BOM inicial
        if (line.isEmpty()) return
        started = true

        if (line[0] == '#') {
            val upper = line.take(12).uppercase()
            when {
                upper.startsWith("#EXTM3U") -> if (!header.found) {
                    header.found = true
                    header.attrs.putAll(parseAttributes(line, "#EXTM3U".length).attrs)
                }
                upper.startsWith("#EXTINF:") -> {
                    pending?.let { addError(it.line, "missing-url", it.raw) }
                    val info = parseExtInf(line, lineNo)
                    if (info.malformed) addError(lineNo, "malformed-extinf", line)
                    pending = info
                    pendingGroup = null
                    pendingOptions = null
                }
                upper.startsWith("#EXTGRP:") -> pendingGroup = line.substring("#EXTGRP:".length).jsTrim().ifEmpty { null }
                upper.startsWith("#EXTVLCOPT:") -> {
                    val opt = line.substring("#EXTVLCOPT:".length)
                    val eq = opt.indexOf('=')
                    if (eq > 0) {
                        val key = opt.substring(0, eq).jsTrim().lowercase()
                        if (key == "http-user-agent" || key == "http-referrer") {
                            val options = pendingOptions ?: LinkedHashMap<String, String>().also { pendingOptions = it }
                            options[key] = opt.substring(eq + 1).jsTrim()
                        }
                    }
                }
                upper.startsWith("#EXT-X-TARG") || upper.startsWith("#EXT-X-STRE") || upper.startsWith("#EXT-X-MEDI") -> isHlsManifest = true
            }
            return
        }

        if (!URL_RE.containsMatchIn(line)) {
            addError(lineNo, "invalid-url", line)
            // O #EXTINF pendente continua aguardando um endereço válido.
            return
        }

        val info = pending
        pending = null
        val attrs = info?.attrs ?: emptyMap()
        val tvgName = attrs["tvg-name"]?.ifEmpty { null }
        val name = info?.name?.ifEmpty { null } ?: tvgName ?: nameFromUrl(line)
        val entry = M3uEntry(
            name = name,
            url = line,
            duration = info?.duration ?: -1.0,
            attrs = attrs,
            tvgId = attrs["tvg-id"]?.ifEmpty { null },
            tvgName = tvgName,
            tvgLogo = attrs["tvg-logo"]?.ifEmpty { null } ?: attrs["logo"]?.ifEmpty { null },
            groupTitle = attrs["group-title"]?.ifEmpty { null } ?: pendingGroup,
            options = pendingOptions,
            line = lineNo,
        )
        pendingGroup = null
        pendingOptions = null
        entryCount++
        out.add(entry)
    }
}

fun parseM3u(text: String): M3uResult {
    val parser = M3uParser()
    val entries = ArrayList(parser.push(text))
    entries.addAll(parser.end())
    return M3uResult(parser.header, entries, parser.errors, parser.isHlsManifest)
}

/** Validação rápida de formato sobre o início do conteúdo. */
fun looksLikeM3u(sample: String): Boolean {
    val head = sample.removePrefix("﻿").take(4096).trimStart()
    if (head.startsWith("#EXTM3U", ignoreCase = true)) return true
    return Regex("^#EXTINF:", setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE)).containsMatchIn(head)
}

/** Endereço de EPG anunciado no cabeçalho, se houver. */
fun epgUrlFromHeader(header: M3uHeader): String? {
    val raw = header.attrs["url-tvg"]?.ifEmpty { null } ?: header.attrs["x-tvg-url"]?.ifEmpty { null } ?: header.attrs["tvg-url"]?.ifEmpty { null }
    return raw?.split(',')?.first()?.jsTrim()?.ifEmpty { null }
}
