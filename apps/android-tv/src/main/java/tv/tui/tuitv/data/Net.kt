package tv.tui.tuitv.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Uri
import java.io.BufferedInputStream
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.io.InputStreamReader
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.nio.ByteBuffer
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream
import javax.net.ssl.SSLException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import okhttp3.OkHttpClient
import okhttp3.Request
import tv.tui.core.UrlProblem
import tv.tui.core.maskUrl
import tv.tui.core.validateRemoteUrl
import tv.tui.tuitv.BuildConfig

/** Mesmos códigos de erro da Web (apps/web/src/lib/net.ts), mais os específicos do Android. */
enum class ImportError {
    URL_EMPTY, URL_MALFORMED, URL_SCHEME, URL_PRIVATE, LOGIN_MISSING,
    OFFLINE, NETWORK, TIMEOUT, HTTP, TOO_LARGE,
    NOT_M3U, HLS_MANIFEST, EMPTY, NOT_XMLTV, NOT_BACKUP, STORAGE, FILE,
}

class ImportException(val error: ImportError, val detail: String? = null, cause: Throwable? = null) : Exception(error.name, cause)

/** Limites de packages/validation. */
object Limits {
    const val MAX_PLAYLIST_BYTES = 200L * 1024 * 1024
    const val MAX_EPG_BYTES = 400L * 1024 * 1024
    const val MAX_BACKUP_BYTES = 300L * 1024 * 1024
}

class ByteSource(val stream: InputStream, val total: Long?)

class Net(private val context: Context, val client: OkHttpClient) {
    val userAgent = "TuiTV/${BuildConfig.VERSION_NAME} (Android TV)"

    fun checkedUrl(input: String, allowPrivate: Boolean): String {
        val check = validateRemoteUrl(input, allowPrivate)
        return check.url ?: throw ImportException(
            when (check.problem) {
                UrlProblem.EMPTY -> ImportError.URL_EMPTY
                UrlProblem.SCHEME -> ImportError.URL_SCHEME
                UrlProblem.PRIVATE_HOST -> ImportError.URL_PRIVATE
                else -> ImportError.URL_MALFORMED
            },
        )
    }

    /**
     * Há alguma rede ativa. Não exige a capacidade "internet": servidores na rede local
     * (sem acesso externo) precisam continuar funcionando.
     */
    fun isOnline(): Boolean {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return true
        return try {
            cm.activeNetwork != null
        } catch (_: SecurityException) {
            true
        }
    }

    /**
     * Baixa um endereço remoto direto da fonte do usuário (sem servidor intermediário),
     * sem cookies e sem Referer. O endereço completo nunca vai para os registros.
     */
    fun open(url: String, timeoutSeconds: Int, maxBytes: Long): ByteSource {
        val client = client.newBuilder()
            .connectTimeout(timeoutSeconds.toLong(), TimeUnit.SECONDS)
            .readTimeout(timeoutSeconds.toLong(), TimeUnit.SECONDS)
            .build()
        val request = Request.Builder().url(url).header("User-Agent", userAgent).build()
        val response = try {
            client.newCall(request).execute()
        } catch (e: IOException) {
            throw networkError(e, url)
        } catch (e: IllegalArgumentException) {
            throw ImportException(ImportError.URL_MALFORMED, cause = e)
        }
        if (!response.isSuccessful) {
            response.close()
            throw ImportException(ImportError.HTTP, response.code.toString())
        }
        val body = response.body
        val length = body.contentLength()
        // Com Content-Encoding o OkHttp descomprime; o tamanho anunciado não vale para o conteúdo.
        val total = if (length > 0 && response.header("Content-Encoding") == null) length else null
        if (total != null && total > maxBytes) {
            response.close()
            throw ImportException(ImportError.TOO_LARGE)
        }
        return ByteSource(body.byteStream(), total)
    }

    fun openUri(uri: Uri, maxBytes: Long): ByteSource {
        val resolver = context.contentResolver
        val size = try {
            resolver.openAssetFileDescriptor(uri, "r")?.use { it.length }?.takeIf { it > 0 }
        } catch (_: Exception) {
            null
        }
        if (size != null && size > maxBytes) throw ImportException(ImportError.TOO_LARGE)
        val stream = try {
            resolver.openInputStream(uri)
        } catch (e: Exception) {
            throw ImportException(ImportError.FILE, cause = e)
        } ?: throw ImportException(ImportError.FILE)
        return ByteSource(stream, size)
    }

    fun networkError(e: IOException, url: String): ImportException {
        android.util.Log.w("TuiTV", "falha ao baixar ${maskUrl(url)}: ${e.javaClass.simpleName}")
        return when (e) {
            is SocketTimeoutException -> ImportException(ImportError.TIMEOUT, cause = e)
            is SSLException -> ImportException(ImportError.NETWORK, "tls", e)
            else -> when {
                !isOnline() -> ImportException(ImportError.OFFLINE, cause = e)
                e is UnknownHostException -> ImportException(ImportError.NETWORK, "dns", e)
                else -> ImportException(ImportError.NETWORK, cause = e)
            }
        }
    }

    companion object {
        fun createClient(): OkHttpClient = OkHttpClient.Builder()
            .followRedirects(true)
            .followSslRedirects(true)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
    }
}

/** Conta bytes lidos e interrompe ao exceder o limite. */
private class CountingStream(input: InputStream, private val max: Long, private val onBytes: (Long) -> Unit) : FilterInputStream(input) {
    var count = 0L
        private set

    private fun add(n: Int) {
        if (n <= 0) return
        count += n
        if (count > max) throw ImportException(ImportError.TOO_LARGE)
        onBytes(count)
    }

    override fun read(): Int = super.read().also { if (it >= 0) add(1) }
    override fun read(b: ByteArray, off: Int, len: Int): Int = super.read(b, off, len).also(::add)
}

private fun isValidUtf8(bytes: ByteArray, length: Int): Boolean = try {
    Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(bytes, 0, length))
    true
} catch (_: Exception) {
    false
}

/**
 * Lê a fonte como texto, em pedaços (como readText da Web):
 *  - descomprime gzip quando o conteúdo começa com a assinatura 1F 8B;
 *  - detecta a codificação (UTF-8; se inválido, Windows-1252);
 *  - interrompe ao exceder [maxBytes] (lidos ou descomprimidos).
 */
suspend fun readText(source: ByteSource, maxBytes: Long, onBytes: (loaded: Long, total: Long?) -> Unit, consume: suspend (String) -> Unit) {
    source.stream.use { raw ->
        var total = source.total
        val counted = CountingStream(raw, maxBytes) { onBytes(it, total) }
        var input: InputStream = BufferedInputStream(counted, 64 * 1024)
        input.mark(4)
        val b0 = input.read()
        val b1 = input.read()
        input.reset()
        if (b0 == 0x1f && b1 == 0x8b) {
            total = null
            input = BufferedInputStream(CountingStream(GZIPInputStream(input, 64 * 1024), maxBytes) {}, 64 * 1024)
        }
        input.mark(8192)
        val head = ByteArray(4096)
        var read = 0
        while (read < head.size) {
            val n = input.read(head, read, head.size - read)
            if (n < 0) break
            read += n
        }
        input.reset()
        // Ignora os últimos bytes: um caractere multibyte pode estar cortado.
        val charset: Charset = if (isValidUtf8(head, maxOf(0, read - 4))) Charsets.UTF_8 else Charset.forName("windows-1252")
        val reader = InputStreamReader(input, charset.newDecoder().onMalformedInput(CodingErrorAction.REPLACE).onUnmappableCharacter(CodingErrorAction.REPLACE))
        val buffer = CharArray(64 * 1024)
        while (true) {
            currentCoroutineContext().ensureActive()
            val n = try {
                reader.read(buffer)
            } catch (e: ImportException) {
                throw e
            } catch (e: SocketTimeoutException) {
                throw ImportException(ImportError.TIMEOUT, cause = e)
            } catch (e: java.util.zip.ZipException) {
                throw ImportException(ImportError.FILE, "gzip", e)
            } catch (e: IOException) {
                throw ImportException(ImportError.NETWORK, cause = e)
            }
            if (n < 0) break
            if (n > 0) consume(String(buffer, 0, n))
        }
    }
}
