package tv.tui.core

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.io.encoding.Base64

/**
 * Primitivas portáveis: PBKDF2-HMAC-SHA256 implementado sobre HmacSHA256 e Base64 do Kotlin.
 * `SecretKeyFactory("PBKDF2WithHmacSHA256")` e `java.util.Base64` só existem no Android a partir
 * da API 26, e vários aparelhos Fire TV usam Fire OS 6 (API 25).
 * Resultado idêntico ao WebCrypto (senha codificada em UTF-8).
 */
object Crypto {
    fun pbkdf2Sha256(secret: String, salt: ByteArray, iterations: Int, bits: Int): ByteArray {
        require(iterations > 0 && bits > 0 && bits % 8 == 0)
        val mac = Mac.getInstance("HmacSHA256")
        // Senha vazia não é aceita por SecretKeySpec; o HMAC trata chave vazia como zeros, igual a um byte nulo.
        val keyBytes = secret.toByteArray(Charsets.UTF_8).let { if (it.isEmpty()) ByteArray(1) else it }
        mac.init(SecretKeySpec(keyBytes, "HmacSHA256"))
        val length = bits / 8
        val out = ByteArray(length)
        val hLen = mac.macLength
        var block = 1
        var offset = 0
        while (offset < length) {
            mac.update(salt)
            mac.update(byteArrayOf((block ushr 24).toByte(), (block ushr 16).toByte(), (block ushr 8).toByte(), block.toByte()))
            var u = mac.doFinal()
            val t = u.copyOf()
            for (i in 1 until iterations) {
                u = mac.doFinal(u)
                for (j in t.indices) t[j] = (t[j].toInt() xor u[j].toInt()).toByte()
            }
            val take = minOf(hLen, length - offset)
            System.arraycopy(t, 0, out, offset, take)
            offset += take
            block++
        }
        return out
    }

    fun toBase64(bytes: ByteArray): String = Base64.Default.encode(bytes)

    fun fromBase64(text: String): ByteArray = Base64.Default.decode(text)
}
