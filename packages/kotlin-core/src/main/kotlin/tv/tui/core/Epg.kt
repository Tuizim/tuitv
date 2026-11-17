package tv.tui.core

/**
 * Guia de programação XMLTV — porte fiel de packages/business-rules/src/epg.ts.
 * Interpretador incremental, sem DOM, adequado a guias extensos.
 */
data class XmltvChannel(val id: String, val displayNames: List<String>, val icon: String? = null)

data class XmltvProgramme(
    val channelId: String,
    /** Epoch em milissegundos (UTC). */
    val start: Long,
    val stop: Long,
    val title: String,
    val description: String? = null,
    val category: String? = null,
)

data class XmltvBatch(val channels: List<XmltvChannel>, val programmes: List<XmltvProgramme>)

/** Janela de tempo: descarta programas que terminam antes de [from] ou começam depois de [to]. */
data class XmltvWindow(val from: Long? = null, val to: Long? = null)

private val ENTITIES = mapOf("amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'")
private val CDATA = Regex("<!\\[CDATA\\[([\\s\\S]*?)]]>")
private val ENTITY = Regex("&(#x[0-9a-fA-F]+|#\\d+|[a-zA-Z]+);")
private val DATE_RE = Regex("^(\\d{4})(\\d{2})?(\\d{2})?(\\d{2})?(\\d{2})?(\\d{2})?\\s*(?:([+-])(\\d{2}):?(\\d{2})|Z)?")
private val ATTR_RE = Regex("([\\w:-]+)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')")
private val DISPLAY_NAME = Regex("<display-name(?:\\s[^>]*)?>([\\s\\S]*?)</display-name>")
private val ICON_TAG = Regex("<icon\\s[^>]*>")
private val XMLTV_ROOT = Regex("<tv[\\s>]")
private val XMLTV_BLOCK = Regex("<(channel|programme)\\s")
private const val MAX_BLOCK = 4 * 1024 * 1024
private const val HALF_HOUR = 30 * 60_000L

fun decodeXml(text: String): String {
    var value = text
    if (value.contains("<![CDATA[")) value = CDATA.replace(value) { it.groupValues[1] }
    if (!value.contains('&')) return value.jsTrim()
    return ENTITY.replace(value) { m ->
        val ref = m.groupValues[1]
        if (ref[0] == '#') {
            val code = if (ref.length > 1 && (ref[1] == 'x' || ref[1] == 'X')) ref.substring(2).toIntOrNull(16) else ref.substring(1).toIntOrNull()
            if (code != null && code > 0 && code <= 0x10ffff) String(Character.toChars(code)) else ""
        } else {
            ENTITIES[ref] ?: m.value
        }
    }.jsTrim()
}

/**
 * Datas XMLTV: `YYYYMMDDHHMMSS ±HHMM` (campos finais opcionais).
 * Sem fuso informado, considera UTC. Retorna epoch em ms ou null.
 */
fun parseXmltvDate(value: String): Long? {
    val m = DATE_RE.find(value.jsTrim()) ?: return null
    val g = m.groupValues
    fun part(i: Int, default: Int) = g[i].ifEmpty { null }?.toInt() ?: default
    // Como Date.UTC: meses, dias e horas fora do intervalo transbordam para o campo seguinte.
    val monthIndex = part(2, 1) - 1
    val year = g[1].toInt() + Math.floorDiv(monthIndex, 12)
    val month = Math.floorMod(monthIndex, 12) + 1
    val days = daysFromCivil(year, month, 1) + (part(3, 1) - 1)
    val utc = ((days * 24 + part(4, 0)) * 60 + part(5, 0)) * 60_000L + part(6, 0) * 1000L
    if (g[7].isEmpty()) return utc
    val offset = (g[8].toLong() * 60 + g[9].toLong()) * 60_000
    return if (g[7] == "+") utc - offset else utc + offset
}

/** Dias desde 1970-01-01 no calendário gregoriano (algoritmo de H. Hinnant); evita java.time, ausente antes da API 26. */
private fun daysFromCivil(year: Int, month: Int, day: Int): Long {
    val y = (if (month <= 2) year - 1 else year).toLong()
    val era = Math.floorDiv(y, 400L)
    val yoe = y - era * 400
    val mp = (month + 9) % 12
    val doy = (153 * mp + 2) / 5 + day - 1
    val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146097 + doe - 719468
}

private fun attributes(openTag: String): Map<String, String> {
    val out = LinkedHashMap<String, String>()
    for (m in ATTR_RE.findAll(openTag)) out[m.groupValues[1]] = decodeXml(m.groups[2]?.value ?: m.groups[3]?.value ?: "")
    return out
}

private val childPatterns = HashMap<String, Regex>()

private fun firstChild(block: String, tag: String): String? {
    val re = childPatterns.getOrPut(tag) { Regex("<$tag(?:\\s[^>]*)?>([\\s\\S]*?)</$tag>") }
    val m = re.find(block) ?: return null
    return decodeXml(m.groupValues[1]).ifEmpty { null }
}

class XmltvParser(private val window: XmltvWindow = XmltvWindow()) {
    var channelCount = 0
        private set
    var programmeCount = 0
        private set
    var skipped = 0
        private set
    private var buffer = StringBuilder()

    fun push(chunk: String): XmltvBatch {
        buffer.append(chunk)
        return drain(false)
    }

    fun end(): XmltvBatch {
        val batch = drain(true)
        buffer = StringBuilder()
        return batch
    }

    private fun drain(final: Boolean): XmltvBatch {
        val channels = ArrayList<XmltvChannel>()
        val programmes = ArrayList<XmltvProgramme>()
        val buf = buffer
        var pos = 0
        while (true) {
            val c = buf.indexOf("<channel", pos)
            val p = buf.indexOf("<programme", pos)
            if (c == -1 && p == -1) {
                // Mantém apenas o fim do buffer (um nome de tag pode estar dividido entre pedaços).
                pos = maxOf(pos, buf.length - 16)
                break
            }
            val isChannel = p == -1 || (c != -1 && c < p)
            val start = if (isChannel) c else p
            val tag = if (isChannel) "channel" else "programme"
            val openEnd = buf.indexOf(">", start)
            if (openEnd == -1) {
                pos = start
                break
            }
            val selfClosing = buf[openEnd - 1] == '/'
            val blockEnd: Int
            if (selfClosing) {
                blockEnd = openEnd + 1
            } else {
                val closeTag = "</$tag>"
                val close = buf.indexOf(closeTag, openEnd)
                if (close == -1) {
                    if (buf.length - start > MAX_BLOCK) {
                        skipped++
                        pos = openEnd + 1
                        continue
                    }
                    pos = start
                    break
                }
                blockEnd = close + closeTag.length
            }
            val open = buf.substring(start, openEnd + 1)
            val inner = if (selfClosing) "" else buf.substring(openEnd + 1, blockEnd)
            if (isChannel) readChannel(open, inner)?.let(channels::add) else readProgramme(open, inner)?.let(programmes::add)
            pos = blockEnd
        }
        buffer = if (final) StringBuilder() else StringBuilder(buf.substring(pos.coerceIn(0, buf.length)))
        return XmltvBatch(channels, programmes)
    }

    private fun readChannel(open: String, inner: String): XmltvChannel? {
        val id = attributes(open)["id"]
        if (id.isNullOrEmpty()) {
            skipped++
            return null
        }
        val names = DISPLAY_NAME.findAll(inner).map { decodeXml(it.groupValues[1]) }.filter { it.isNotEmpty() }.toList()
        val icon = ICON_TAG.find(inner)?.let { attributes(it.value)["src"] }?.ifEmpty { null }
        channelCount++
        return XmltvChannel(id, names, icon)
    }

    private fun readProgramme(open: String, inner: String): XmltvProgramme? {
        val attrs = attributes(open)
        val channelId = attrs["channel"]
        val start = parseXmltvDate(attrs["start"] ?: "")
        if (channelId.isNullOrEmpty() || start == null) {
            skipped++
            return null
        }
        var stop = parseXmltvDate(attrs["stop"] ?: "")
        if (stop == null || stop <= start) stop = start + HALF_HOUR
        if (window.from != null && stop < window.from) return null
        if (window.to != null && start > window.to) return null
        programmeCount++
        return XmltvProgramme(
            channelId = channelId,
            start = start,
            stop = stop,
            title = firstChild(inner, "title") ?: "—",
            description = firstChild(inner, "desc")?.take(1500),
            category = firstChild(inner, "category"),
        )
    }

    companion object {
        /** Há indício de que o conteúdo seja XMLTV. */
        fun looksLikeXmltv(sample: String): Boolean = XMLTV_ROOT.containsMatchIn(sample) || XMLTV_BLOCK.containsMatchIn(sample)
    }
}

fun parseXmltv(text: String, window: XmltvWindow = XmltvWindow()): XmltvBatch {
    val parser = XmltvParser(window)
    val a = parser.push(text)
    val b = parser.end()
    return XmltvBatch(a.channels + b.channels, a.programmes + b.programmes)
}

/** Canal do guia a ser indexado; [key] é o valor devolvido na associação. */
data class EpgIndexEntry(val key: String, val channelId: String, val displayNames: List<String>)

class EpgIndex(val byId: Map<String, String>, val byName: Map<String, String>)

/** Índice para associar canais da lista aos canais do guia. */
fun buildEpgIndex(channels: List<EpgIndexEntry>): EpgIndex {
    val byId = HashMap<String, String>()
    val byName = HashMap<String, String>()
    for (channel in channels) {
        byId.putIfAbsent(channel.channelId.lowercase(), channel.key)
        for (name in channel.displayNames) {
            val norm = normalizeText(name)
            if (norm.isNotEmpty()) byName.putIfAbsent(norm, channel.key)
        }
    }
    return EpgIndex(byId, byName)
}

/** Identificação do canal: tvg-id, depois tvg-name, depois o nome exibido. */
fun resolveEpgChannel(tvgId: String?, tvgName: String?, name: String, index: EpgIndex): String? {
    if (!tvgId.isNullOrEmpty()) index.byId[tvgId.lowercase()]?.let { return it }
    if (!tvgName.isNullOrEmpty()) index.byName[normalizeText(tvgName)]?.let { return it }
    return index.byName[normalizeText(name)]
}

/** Intervalo com início e fim em ms. */
interface Timed {
    val start: Long
    val stop: Long
}

data class NowNext<T : Timed>(val current: T?, val next: List<T>)

/** Programa atual e próximos, a partir de programas ordenados por início. */
fun <T : Timed> nowNext(programmes: List<T>, now: Long, upcoming: Int = 3): NowNext<T> {
    var current: T? = null
    val next = ArrayList<T>()
    for (programme in programmes) {
        if (programme.stop <= now) continue
        if (programme.start <= now) {
            if (current == null) current = programme
        } else if (next.size < upcoming) {
            next.add(programme)
        } else {
            break
        }
    }
    return NowNext(current, next)
}

fun programmeProgress(start: Long, stop: Long, now: Long): Float {
    val total = stop - start
    if (total <= 0) return 0f
    return ((now - start).toFloat() / total).coerceIn(0f, 1f)
}
