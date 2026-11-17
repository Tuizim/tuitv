package tv.tui.tuitv.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Cifragem em repouso dos endereços de listas e guias (podem conter usuário e senha),
 * com AES-GCM e chave não exportável no Android Keystore — mesmo critério da Web.
 * Se o Keystore do aparelho falhar, o valor é guardado sem cifragem (prefixo "p:"),
 * para que o aplicativo continue funcionando.
 */
object SecureText {
    private const val ALIAS = "tuitv-urls"
    private const val CIPHERED = "k1:"
    private const val PLAIN = "p:"

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    fun seal(value: String?): String? {
        if (value == null) return null
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            val payload = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            CIPHERED + Base64.encodeToString(payload, Base64.NO_WRAP)
        } catch (e: Exception) {
            Log.w("TuiTV", "Keystore indisponível; endereço guardado sem cifragem (${e.javaClass.simpleName})")
            PLAIN + value
        }
    }

    fun open(value: String?): String? {
        if (value == null) return null
        if (value.startsWith(PLAIN)) return value.substring(PLAIN.length)
        if (!value.startsWith(CIPHERED)) return value
        return try {
            val payload = Base64.decode(value.substring(CIPHERED.length), Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, payload, 0, 12))
            String(cipher.doFinal(payload, 12, payload.size - 12), Charsets.UTF_8)
        } catch (e: Exception) {
            Log.w("TuiTV", "Não foi possível decifrar um endereço (${e.javaClass.simpleName})")
            null
        }
    }
}
