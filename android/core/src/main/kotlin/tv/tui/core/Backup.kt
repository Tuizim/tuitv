package tv.tui.core

import java.security.SecureRandom
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject

/**
 * Arquivo de backup do TuiTV — mesmo formato de web/packages/business-rules/src/backup.ts,
 * de modo que um backup exportado na Web pode ser restaurado no Android e vice-versa.
 * Proteção por senha: PBKDF2-HMAC-SHA256 + AES-256-GCM (IV de 12 bytes, tag de 128 bits ao final).
 */
object Backup {
    const val APP_ID = "tuitv"
    const val SCHEMA_VERSION = 1
    const val KDF_ITERATIONS = 210_000

    class BackupException(val code: String) : Exception(code)

    private fun key(password: String, salt: ByteArray, iterations: Int): SecretKeySpec =
        SecretKeySpec(Crypto.pbkdf2Sha256(password, salt, iterations, 256), "AES")

    /** Gera o conteúdo do arquivo de backup. [data] é o objeto `data` (listas, favoritos, histórico, preferências). */
    fun create(data: JSONObject, platform: String, password: String? = null, now: Long = System.currentTimeMillis()): String {
        val envelope = JSONObject()
            .put("app", APP_ID)
            .put("schemaVersion", SCHEMA_VERSION)
            .put("createdAt", now)
            .put("platform", platform)
        if (password.isNullOrEmpty()) return envelope.put("encrypted", false).put("data", data).toString()

        val random = SecureRandom()
        val salt = ByteArray(16).also(random::nextBytes)
        val iv = ByteArray(12).also(random::nextBytes)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(password, salt, KDF_ITERATIONS), GCMParameterSpec(128, iv))
        val payload = cipher.doFinal(data.toString().toByteArray(Charsets.UTF_8))
        return envelope.put("encrypted", true).put(
            "cipher",
            JSONObject()
                .put("kdf", "PBKDF2-SHA256")
                .put("iterations", KDF_ITERATIONS)
                .put("salt", Crypto.toBase64(salt))
                .put("iv", Crypto.toBase64(iv))
                .put("payload", Crypto.toBase64(payload)),
        ).toString()
    }

    /** Valida o envelope e devolve o objeto `data`, decifrando-o quando protegido por senha. */
    fun open(text: String, password: String? = null): JSONObject {
        val envelope = try {
            JSONObject(text)
        } catch (_: Exception) {
            throw BackupException("not-json")
        }
        if (envelope.optString("app") != APP_ID) throw BackupException("not-tuitv")
        if (!envelope.has("schemaVersion")) throw BackupException("invalid-structure")
        if (envelope.getInt("schemaVersion") > SCHEMA_VERSION) throw BackupException("newer-version")

        val data = if (envelope.optBoolean("encrypted")) {
            val c = envelope.optJSONObject("cipher") ?: throw BackupException("invalid-structure")
            if (password.isNullOrEmpty()) throw BackupException("password-required")
            try {
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(
                    Cipher.DECRYPT_MODE,
                    key(password, Crypto.fromBase64(c.getString("salt")), c.getInt("iterations")),
                    GCMParameterSpec(128, Crypto.fromBase64(c.getString("iv"))),
                )
                JSONObject(String(cipher.doFinal(Crypto.fromBase64(c.getString("payload"))), Charsets.UTF_8))
            } catch (_: AEADBadTagException) {
                throw BackupException("wrong-password")
            } catch (_: Exception) {
                throw BackupException("invalid-structure")
            }
        } else {
            envelope.optJSONObject("data") ?: throw BackupException("invalid-structure")
        }
        if (data.optJSONArray("playlists") == null || data.optJSONArray("favorites") == null ||
            data.optJSONArray("history") == null || data.optJSONObject("settings") == null
        ) throw BackupException("invalid-structure")
        return data
    }
}
