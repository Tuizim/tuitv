package tv.tui.core

import java.security.MessageDigest
import java.security.SecureRandom

/** Controle parental — porte de web/packages/business-rules/src/parental.ts. */
object Parental {
    const val PIN_ITERATIONS = 120_000
    private val PIN_RE = Regex("^\\d{4,8}$")
    private val ADULT_RE = Regex("(^|[^a-z0-9])(adult[oa]?s?|xxx|porn[a-z]*|erotic[a-z]*)([^a-z0-9]|$)|\\+ ?18|18 ?\\+")

    data class PinHash(val pinHash: String, val pinSalt: String)

    fun isValidPin(pin: String) = PIN_RE.matches(pin)

    fun hashPin(pin: String, salt: String? = null): PinHash {
        val saltBytes = salt?.let(Crypto::fromBase64) ?: ByteArray(16).also(SecureRandom()::nextBytes)
        val bits = Crypto.pbkdf2Sha256(pin, saltBytes, PIN_ITERATIONS, 256)
        return PinHash(Crypto.toBase64(bits), Crypto.toBase64(saltBytes))
    }

    fun verifyPin(pin: String, pinHash: String?, pinSalt: String?): Boolean {
        if (pinHash.isNullOrEmpty() || pinSalt.isNullOrEmpty()) return false
        val computed = hashPin(pin, pinSalt).pinHash
        return MessageDigest.isEqual(computed.toByteArray(), pinHash.toByteArray())
    }

    /** A categoria/nome indica conteúdo adulto. */
    fun isAdultLabel(label: String?): Boolean = !label.isNullOrEmpty() && ADULT_RE.containsMatchIn(normalizeText(label))

    /**
     * Filtro de bloqueio para a sessão atual: devolve true para itens bloqueados.
     * Retorna null quando nada é bloqueado (controle desativado ou sessão desbloqueada).
     */
    fun restriction(enabled: Boolean, hideAdult: Boolean, lockedGroups: Collection<String>, unlocked: Boolean): ((group: String?, name: String) -> Boolean)? {
        if (!enabled || unlocked) return null
        val locked = lockedGroups.toHashSet()
        val cache = HashMap<String, Boolean>()
        return { group, name ->
            val g = group ?: ""
            val blocked = cache.getOrPut(g) { locked.contains(normalizeText(g)) || (hideAdult && isAdultLabel(g)) }
            blocked || (hideAdult && g.isEmpty() && isAdultLabel(name))
        }
    }
}

/** Regras de reprodução compartilhadas com o player Web (web/app/src/components/Player.tsx). */
object Playback {
    private val TS_END = Regex("(?i)\\.ts$")
    private val DIRECT = Regex("^/([^/.]+)/([^/.]+)/(\\d+)$")

    /** Variante HLS do mesmo canal: troca `.ts` por `.m3u8` ou monta `/live/usuario/senha/id.m3u8`. */
    fun hlsVariant(url: String): String? = try {
        val uri = java.net.URI(url)
        val path = uri.rawPath ?: ""
        val newPath = when {
            TS_END.containsMatchIn(path) -> TS_END.replace(path, ".m3u8")
            else -> DIRECT.find(path)?.let { "/live/${it.groupValues[1]}/${it.groupValues[2]}/${it.groupValues[3]}.m3u8" }
        }
        newPath?.let {
            val authority = uri.rawAuthority ?: return@let null
            buildString {
                append(uri.scheme).append("://").append(authority).append(it)
                uri.rawQuery?.let { q -> append('?').append(q) }
            }
        }
    } catch (_: Exception) {
        null
    }

    /** Um filme ou episódio é considerado assistido após 92% da duração. */
    fun isCompleted(position: Long, duration: Long, previouslyCompleted: Boolean): Boolean =
        previouslyCompleted || (duration > 0 && position.toDouble() / duration > 0.92)
}
