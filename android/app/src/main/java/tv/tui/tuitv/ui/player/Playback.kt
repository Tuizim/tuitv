package tv.tui.tuitv.ui.player

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem as Media3Item
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import tv.tui.core.Playback
import tv.tui.core.urlPath
import tv.tui.tuitv.data.Settings

/** Uma forma de tentar reproduzir o endereço. */
data class Candidate(val url: String, val forceHls: Boolean)

private val VIDEO_FILE = Regex("\\.(mp4|mkv|avi|mov|webm|m4v|wmv|flv|mpg|mpeg|ogv|3gp)$")

/**
 * Estratégias em ordem (como o player Web):
 *  - `.m3u8` → HLS;
 *  - demais → detecção automática do Media3 (HLS, MPEG-TS, MP4, MKV…), depois HLS forçado
 *    (servidores que entregam HLS sem extensão) e a variante HLS do canal (`.ts` → `.m3u8`
 *    ou `/live/usuario/senha/id.m3u8`).
 */
fun candidates(url: String): List<Candidate> {
    val path = urlPath(url).lowercase()
    if (path.endsWith(".m3u8") || path.endsWith(".m3u")) return listOf(Candidate(url, true))
    val list = mutableListOf(Candidate(url, false))
    if (!VIDEO_FILE.containsMatchIn(path)) list.add(Candidate(url, true))
    Playback.hlsVariant(url)?.let { list.add(Candidate(it, true)) }
    return list.distinct()
}

@OptIn(UnstableApi::class)
fun createPlayer(context: Context, http: OkHttpClient, userAgent: String, settings: Settings): ExoPlayer {
    val timeout = settings.connectionTimeout.toLong()
    val client = http.newBuilder().connectTimeout(timeout, TimeUnit.SECONDS).readTimeout(timeout, TimeUnit.SECONDS).build()
    val httpFactory = OkHttpDataSource.Factory(client).setUserAgent(userAgent)
    val dataSource = DefaultDataSource.Factory(context, httpFactory)
    val player = ExoPlayer.Builder(context)
        .setMediaSourceFactory(DefaultMediaSourceFactory(dataSource))
        .build()
    player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
        .setPreferredAudioLanguage(settings.audioLanguage.ifEmpty { null })
        .setPreferredTextLanguage(settings.subtitleLanguage.ifEmpty { null })
        .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !settings.subtitlesEnabled)
        .build()
    player.volume = settings.volume.toFloat()
    return player
}

fun mediaItemFor(candidate: Candidate): Media3Item {
    val builder = Media3Item.Builder().setUri(candidate.url)
    if (candidate.forceHls) builder.setMimeType(MimeTypes.APPLICATION_M3U8)
    return builder.build()
}

/** Como reagir a uma falha de reprodução. */
enum class FailureKind { RETRY, NEXT_CANDIDATE, BEHIND_LIVE, FATAL }

data class Failure(val kind: FailureKind, val message: String)

@OptIn(UnstableApi::class)
fun classify(error: PlaybackException): Failure {
    var cause: Throwable? = error
    while (cause != null) {
        if (cause is HttpDataSource.InvalidResponseCodeException) {
            val code = cause.responseCode
            val message = when (code) {
                401, 403 -> "O servidor recusou o acesso (HTTP $code). A assinatura ou o token podem ter expirado."
                404 -> "Transmissão não encontrada no servidor (HTTP 404)."
                else -> "O servidor respondeu com erro (HTTP $code)."
            }
            return Failure(if (code >= 500) FailureKind.RETRY else FailureKind.NEXT_CANDIDATE, message)
        }
        cause = cause.cause
    }
    return when (error.errorCode) {
        PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW -> Failure(FailureKind.BEHIND_LIVE, "")
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ->
            Failure(FailureKind.RETRY, "Não foi possível conectar ao servidor da transmissão.")
        PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT, PlaybackException.ERROR_CODE_TIMEOUT ->
            Failure(FailureKind.RETRY, "O servidor demorou demais para responder.")
        PlaybackException.ERROR_CODE_IO_UNSPECIFIED, PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE ->
            Failure(FailureKind.RETRY, "A conexão com a transmissão foi interrompida.")
        PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND, PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS ->
            Failure(FailureKind.NEXT_CANDIDATE, "Transmissão não encontrada no servidor.")
        PlaybackException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE,
        PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
        PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED,
        PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
        PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED ->
            Failure(FailureKind.NEXT_CANDIDATE, "Formato de transmissão não suportado. RTMP, RTSP e UDP não são reproduzidos.")
        PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
        PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED,
        PlaybackException.ERROR_CODE_DECODING_FAILED,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES,
        PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ->
            Failure(FailureKind.FATAL, "Este aparelho não consegue decodificar o vídeo ou o áudio deste conteúdo.")
        PlaybackException.ERROR_CODE_IO_CLEARTEXT_NOT_PERMITTED ->
            Failure(FailureKind.FATAL, "Endereço http:// bloqueado pelo sistema.")
        PlaybackException.ERROR_CODE_DRM_UNSPECIFIED, PlaybackException.ERROR_CODE_DRM_SCHEME_UNSUPPORTED ->
            Failure(FailureKind.FATAL, "Conteúdo protegido por DRM não é suportado.")
        else -> Failure(FailureKind.NEXT_CANDIDATE, "Não foi possível reproduzir este conteúdo.")
    }
}
