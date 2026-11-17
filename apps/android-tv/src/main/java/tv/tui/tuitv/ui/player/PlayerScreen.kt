package tv.tui.tuitv.ui.player

import android.view.KeyEvent as AndroidKeyEvent
import androidx.activity.compose.BackHandler
import androidx.annotation.OptIn
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.nativeKeyCode
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import java.util.Locale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.tui.core.ContentKind
import tv.tui.core.MediaItem
import tv.tui.core.NowNext
import tv.tui.core.programmeProgress
import tv.tui.tuitv.data.AspectMode
import tv.tui.tuitv.data.Programme
import tv.tui.tuitv.data.Settings
import tv.tui.tuitv.ui.Route
import tv.tui.tuitv.ui.Txt
import tv.tui.tuitv.ui.components.ActionButton
import tv.tui.tuitv.ui.components.ListRow
import tv.tui.tuitv.ui.components.Muted
import tv.tui.tuitv.ui.components.ProgressLine
import tv.tui.tuitv.ui.components.RemoteImage
import tv.tui.tuitv.ui.components.RequestFocus
import tv.tui.tuitv.ui.components.TuiDialog
import tv.tui.tuitv.ui.library
import tv.tui.tuitv.ui.navigator
import tv.tui.tuitv.ui.rememberFavoriteToggle
import tv.tui.tuitv.ui.theme.TuiColors
import tv.tui.tuitv.ui.tuiApp

sealed interface Phase {
    data object Loading : Phase
    data object Playing : Phase
    data object Paused : Phase
    data object Buffering : Phase
    data class Reconnecting(val attempt: Int) : Phase
    data class Error(val message: String) : Phase
}

private const val MAX_RETRIES = 6
private const val OVERLAY_MS = 5000L

/**
 * Máquina de estados da reprodução: tenta as estratégias em ordem, reconecta com espera
 * crescente (até 15 s) e, ao desistir, explica a causa.
 */
@Stable
private class PlayerController(
    val player: ExoPlayer,
    private val scope: CoroutineScope,
    private val settings: Settings,
    private val onEnded: () -> Unit,
) : Player.Listener {
    var phase by mutableStateOf<Phase>(Phase.Loading)
        private set
    private var item: MediaItem? = null
    private var list: List<Candidate> = emptyList()
    private var candidate = 0
    private var attempts = 0
    private var retry: Job? = null
    private var pendingSeekMs = 0L

    init {
        player.addListener(this)
    }

    val isLive get() = item?.kind == ContentKind.LIVE

    fun load(next: MediaItem, resumeMs: Long?) {
        retry?.cancel()
        item = next
        list = candidates(next.url)
        candidate = 0
        attempts = 0
        pendingSeekMs = resumeMs ?: 0L
        start()
    }

    fun reload() {
        if (list.isEmpty()) return
        retry?.cancel()
        candidate = 0
        attempts = 0
        pendingSeekMs = if (isLive) 0 else player.currentPosition.coerceAtLeast(0)
        start()
    }

    private fun start() {
        phase = if (attempts > 0) Phase.Reconnecting(attempts) else Phase.Loading
        player.setMediaItem(mediaItemFor(list[candidate]), pendingSeekMs)
        player.prepare()
        player.playWhenReady = settings.autoplay || isLive || attempts > 0
    }

    override fun onPlaybackStateChanged(state: Int) {
        when (state) {
            Player.STATE_BUFFERING -> if (phase !is Phase.Reconnecting) phase = Phase.Buffering
            Player.STATE_READY -> {
                attempts = 0
                phase = if (player.playWhenReady) Phase.Playing else Phase.Paused
            }
            Player.STATE_ENDED -> {
                // Transmissão ao vivo que "termina" caiu: reconecta. Filmes e episódios seguem adiante.
                if (isLive) fail(Failure(FailureKind.RETRY, "A transmissão foi encerrada pelo servidor.")) else onEnded()
            }
            Player.STATE_IDLE -> Unit
        }
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        if (player.playbackState == Player.STATE_READY) phase = if (isPlaying || player.playWhenReady) Phase.Playing else Phase.Paused
    }

    override fun onPlayerError(error: PlaybackException) = fail(classify(error))

    private fun fail(failure: Failure) {
        retry?.cancel()
        if (!isLive) pendingSeekMs = player.currentPosition.coerceAtLeast(pendingSeekMs)
        when (failure.kind) {
            FailureKind.BEHIND_LIVE -> {
                player.seekToDefaultPosition()
                player.prepare()
            }
            FailureKind.RETRY -> if (settings.autoReconnect && attempts < MAX_RETRIES) {
                attempts++
                phase = Phase.Reconnecting(attempts)
                retry = scope.launch(Dispatchers.Main.immediate) {
                    delay(minOf(1000L shl (attempts - 1), 15_000L))
                    start()
                }
            } else {
                phase = Phase.Error(failure.message)
            }
            FailureKind.NEXT_CANDIDATE -> if (candidate + 1 < list.size) {
                candidate++
                attempts = 0
                start()
            } else {
                phase = Phase.Error(failure.message)
            }
            FailureKind.FATAL -> phase = Phase.Error(failure.message)
        }
    }

    fun togglePause() {
        if (phase is Phase.Error) return
        player.playWhenReady = !player.playWhenReady
        if (player.playbackState == Player.STATE_READY) phase = if (player.playWhenReady) Phase.Playing else Phase.Paused
    }

    fun seekBy(ms: Long) {
        if (isLive || !player.isCurrentMediaItemSeekable) return
        val duration = player.duration.takeIf { it != C.TIME_UNSET } ?: Long.MAX_VALUE
        player.seekTo((player.currentPosition + ms).coerceIn(0, duration))
    }

    fun release() {
        retry?.cancel()
        player.removeListener(this)
        player.release()
    }
}

@OptIn(UnstableApi::class)
private fun resizeMode(aspect: AspectMode) = when (aspect) {
    AspectMode.CONTAIN -> AspectRatioFrameLayout.RESIZE_MODE_FIT
    AspectMode.COVER -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
    AspectMode.FILL -> AspectRatioFrameLayout.RESIZE_MODE_FILL
}

private fun digitOf(keyCode: Int): Int? = when (keyCode) {
    in AndroidKeyEvent.KEYCODE_0..AndroidKeyEvent.KEYCODE_9 -> keyCode - AndroidKeyEvent.KEYCODE_0
    in AndroidKeyEvent.KEYCODE_NUMPAD_0..AndroidKeyEvent.KEYCODE_NUMPAD_9 -> keyCode - AndroidKeyEvent.KEYCODE_NUMPAD_0
    else -> null
}

@OptIn(UnstableApi::class)
@Composable
fun PlayerScreen(route: Route.Player) {
    val app = tuiApp()
    val library = library()
    val navigator = navigator()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val settings = remember { library.settingsStore.current }
    val liveSettings by library.settingsStore.settings.collectAsStateWithLifecycle()
    val queue = route.queue
    var index by remember(route) { mutableIntStateOf(route.index.coerceIn(0, queue.lastIndex)) }
    val item = queue[index]
    val live = item.kind == ContentKind.LIVE

    val controller = remember {
        val player = createPlayer(context, app.http, library.net.userAgent, settings)
        PlayerController(player, scope, settings) {
            // Fim de filme/episódio: segue para o próximo da fila ou volta.
            scope.launch(Dispatchers.Main.immediate) {
                if (settings.autoplay && index < queue.lastIndex) index++ else navigator.back()
            }
        }
    }
    val player = controller.player

    fun record() {
        val pos = player.currentPosition.coerceAtLeast(0) / 1000
        val dur = player.duration.takeIf { it != C.TIME_UNSET && it > 0 }?.div(1000) ?: (item.duration?.toLong() ?: 0)
        if (live || pos > 0) library.recordPlayback(item, pos, dur)
    }

    // Carrega o item atual (e retoma filmes/episódios do ponto em que pararam).
    LaunchedEffect(item.id) {
        val resume = if (index == route.index) route.resumeAt else {
            library.historyEntry(item.id)?.takeIf { !it.completed && it.position >= 30 && !live }?.position
        }
        // O ExoPlayer só pode ser usado na thread principal.
        withContext(Dispatchers.Main.immediate) { controller.load(item, resume?.times(1000)) }
    }

    // Histórico periódico enquanto reproduz.
    LaunchedEffect(item.id) {
        while (true) {
            delay(15_000)
            if (controller.phase == Phase.Playing) record()
        }
    }

    // Ao sair do player (Voltar) grava a posição e libera o decodificador.
    DisposableEffect(Unit) {
        onDispose {
            record()
            controller.release()
        }
    }

    // Botão Home do controle: pausa em segundo plano.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        // ON_START também chega assim que o observador é registrado: só reage após um ON_STOP.
        var stopped = false
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> {
                    stopped = true
                    record()
                    player.playWhenReady = false
                }
                Lifecycle.Event.ON_START -> if (stopped) {
                    stopped = false
                    // Ao vivo volta para o ponto atual da transmissão.
                    if (live) controller.reload()
                }
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }

    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var position by remember { mutableLongStateOf(0L) }
    var duration by remember { mutableLongStateOf(0L) }
    var overlayUntil by remember { mutableLongStateOf(System.currentTimeMillis() + OVERLAY_MS) }
    var options by remember { mutableStateOf(false) }
    var digits by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            position = player.currentPosition.coerceAtLeast(0)
            duration = player.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0
            delay(500)
        }
    }
    LaunchedEffect(digits) {
        if (digits.isEmpty()) return@LaunchedEffect
        delay(1500)
        val n = digits.toIntOrNull()
        if (n != null && n in 1..queue.size) index = n - 1
        digits = ""
    }
    val overlay = now < overlayUntil || controller.phase is Phase.Paused || controller.phase is Phase.Error
    fun showOverlay() {
        overlayUntil = System.currentTimeMillis() + OVERLAY_MS
        now = System.currentTimeMillis()
    }
    fun change(step: Int) {
        if (queue.size <= 1) return
        record()
        index = (index + step).mod(queue.size)
        showOverlay()
    }

    val focus = remember { FocusRequester() }
    BackHandler { navigator.back() }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .focusRequester(focus)
            .focusable()
            .onKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onKeyEvent false
                val code = event.key.nativeKeyCode
                val error = controller.phase is Phase.Error
                when (code) {
                    AndroidKeyEvent.KEYCODE_DPAD_UP, AndroidKeyEvent.KEYCODE_CHANNEL_UP ->
                        if (live) change(+1) else showOverlay()
                    AndroidKeyEvent.KEYCODE_DPAD_DOWN, AndroidKeyEvent.KEYCODE_CHANNEL_DOWN ->
                        if (live) change(-1) else showOverlay()
                    AndroidKeyEvent.KEYCODE_MEDIA_NEXT -> change(+1)
                    AndroidKeyEvent.KEYCODE_MEDIA_PREVIOUS -> change(-1)
                    AndroidKeyEvent.KEYCODE_DPAD_LEFT -> if (error) return@onKeyEvent false else { controller.seekBy(-10_000); showOverlay() }
                    AndroidKeyEvent.KEYCODE_DPAD_RIGHT -> if (error) return@onKeyEvent false else { controller.seekBy(10_000); showOverlay() }
                    AndroidKeyEvent.KEYCODE_MEDIA_REWIND -> { controller.seekBy(-30_000); showOverlay() }
                    AndroidKeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { controller.seekBy(30_000); showOverlay() }
                    AndroidKeyEvent.KEYCODE_DPAD_CENTER, AndroidKeyEvent.KEYCODE_ENTER, AndroidKeyEvent.KEYCODE_NUMPAD_ENTER ->
                        if (error) return@onKeyEvent false else if (live) showOverlay() else { controller.togglePause(); showOverlay() }
                    AndroidKeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, AndroidKeyEvent.KEYCODE_SPACE -> { controller.togglePause(); showOverlay() }
                    AndroidKeyEvent.KEYCODE_MEDIA_PLAY -> { player.playWhenReady = true; showOverlay() }
                    AndroidKeyEvent.KEYCODE_MEDIA_PAUSE -> { player.playWhenReady = false; showOverlay() }
                    AndroidKeyEvent.KEYCODE_MENU, AndroidKeyEvent.KEYCODE_INFO, AndroidKeyEvent.KEYCODE_SETTINGS -> options = true
                    else -> {
                        val digit = digitOf(code) ?: return@onKeyEvent false
                        if (!live) return@onKeyEvent false
                        if (digits.length < 5) digits += digit
                        showOverlay()
                    }
                }
                true
            },
    ) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    useController = false
                    isFocusable = false
                    isFocusableInTouchMode = false
                    keepScreenOn = true
                    setShutterBackgroundColor(android.graphics.Color.BLACK)
                    this.player = player
                }
            },
            update = { it.resizeMode = resizeMode(liveSettings.aspect) },
            modifier = Modifier.fillMaxSize(),
        )

        StatusBadge(controller.phase, Modifier.align(Alignment.TopEnd).padding(32.dp))
        if (digits.isNotEmpty()) {
            Text(digits, style = MaterialTheme.typography.displayMedium, color = TuiColors.White, modifier = Modifier.align(Alignment.TopStart).padding(40.dp))
        }

        AnimatedVisibility(overlay && controller.phase !is Phase.Error, Modifier.align(Alignment.BottomCenter), enter = fadeIn(), exit = fadeOut()) {
            Overlay(item, index, queue.size, live, controller.phase, position, duration, now)
        }

        (controller.phase as? Phase.Error)?.let { ErrorPanel(it.message, item, live, { controller.reload() }, { navigator.back() }, Modifier.align(Alignment.Center)) }
    }
    RequestFocus(focus, options)

    if (options) OptionsDialog(controller.player, item) { options = false }
}

@Composable
private fun StatusBadge(phase: Phase, modifier: Modifier) {
    val text = when (phase) {
        Phase.Loading -> Txt.LOADING
        Phase.Buffering -> "Carregando…"
        is Phase.Reconnecting -> "Reconectando… (tentativa ${phase.attempt})"
        else -> return
    }
    Text(
        text,
        style = MaterialTheme.typography.bodyLarge,
        color = TuiColors.White,
        modifier = modifier.clip(RoundedCornerShape(20.dp)).background(TuiColors.Navy.copy(alpha = 0.85f)).padding(horizontal = 18.dp, vertical = 8.dp),
    )
}

@Composable
private fun Overlay(item: MediaItem, index: Int, total: Int, live: Boolean, phase: Phase, position: Long, duration: Long, now: Long) {
    val library = library()
    val epg by produceState<NowNext<Programme>?>(null, item.id, now / 60_000) { value = library.nowNext(item) }
    Box(
        Modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Color.Transparent, TuiColors.NavyDeep.copy(alpha = 0.95f))))
            .padding(start = 48.dp, end = 48.dp, top = 64.dp, bottom = 32.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            RemoteImage(item.logo, item.name, Modifier.size(width = 120.dp, height = 72.dp))
            Spacer(Modifier.width(24.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val title = buildString {
                    if (live && total > 1) append("${index + 1}  ")
                    append(item.name)
                }
                Text(title, style = MaterialTheme.typography.headlineSmall, maxLines = 1)
                if (live) {
                    val current = epg?.current
                    if (current != null) {
                        Text("${Txt.time(current.start)} – ${Txt.time(current.stop)}   ${current.title}", style = MaterialTheme.typography.bodyLarge, maxLines = 1)
                        ProgressLine(programmeProgress(current.start, current.stop, now), Modifier.width(520.dp))
                        epg?.next?.firstOrNull()?.let { Muted("A seguir: ${Txt.time(it.start)}  ${it.title}", maxLines = 1) }
                    } else {
                        Muted(item.group ?: Txt.LIVE)
                    }
                    Muted("▲▼ trocar canal · números: ir ao canal · ☰ opções · Voltar sai", maxLines = 1)
                } else {
                    item.series?.let { Muted(Txt.episodeLabel(it.season, it.episode) + " · " + it.title) }
                    if (duration > 0) {
                        ProgressLine(position.toFloat() / duration, Modifier.fillMaxWidth())
                        Text("${Txt.clock(position / 1000)} / ${Txt.clock(duration / 1000)}" + if (phase == Phase.Paused) "   ❚❚ Pausado" else "", style = MaterialTheme.typography.bodyMedium)
                    } else if (phase == Phase.Paused) {
                        Text("❚❚ Pausado", style = MaterialTheme.typography.bodyMedium)
                    }
                    Muted("OK pausa · ◀▶ 10 s · ⏪⏩ 30 s · ☰ opções · Voltar sai", maxLines = 1)
                }
            }
        }
    }
}

@Composable
private fun ErrorPanel(message: String, item: MediaItem, live: Boolean, onRetry: () -> Unit, onBack: () -> Unit, modifier: Modifier) {
    val focus = remember { FocusRequester() }
    Column(
        modifier.width(640.dp).clip(RoundedCornerShape(16.dp)).background(TuiColors.Navy.copy(alpha = 0.95f)).padding(32.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Não foi possível reproduzir", style = MaterialTheme.typography.headlineSmall)
        Text(item.name, style = MaterialTheme.typography.titleMedium, color = TuiColors.Muted)
        Text(message, style = MaterialTheme.typography.bodyLarge)
        if (live) Muted("Use ▲▼ para ir a outro canal.")
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ActionButton("Tentar novamente", onRetry, Modifier.focusRequester(focus), primary = true)
            ActionButton("Voltar", onBack)
        }
    }
    RequestFocus(focus, message)
}

private fun languageName(code: String?): String? {
    if (code.isNullOrEmpty() || code == "und") return null
    return Locale.forLanguageTag(code).getDisplayLanguage(Locale.forLanguageTag("pt-BR")).replaceFirstChar { it.uppercase() }.ifEmpty { code }
}

/** Menu (☰): faixas de áudio, legendas, proporção da imagem e favorito. */
@OptIn(UnstableApi::class)
@Composable
private fun OptionsDialog(player: ExoPlayer, item: MediaItem, onDismiss: () -> Unit) {
    val library = library()
    val toggleFavorite = rememberFavoriteToggle()
    val favoriteId = if (item.series != null) tv.tui.core.seriesId(item.playlistId, item.series!!.seriesKey) else item.id
    val favorite by remember(favoriteId) { library.isFavorite(favoriteId) }.collectAsStateWithLifecycle(false)
    val settings by library.settingsStore.settings.collectAsStateWithLifecycle()
    val tracks = player.currentTracks
    val textDisabled = player.trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT)
    val focus = remember { FocusRequester() }

    data class Option(val label: String, val selected: Boolean, val action: () -> Unit)

    fun options(type: Int): List<Option> = tracks.groups.filter { it.type == type && it.isSupported }.flatMap { group ->
        (0 until group.length).map { i ->
            val format = group.getTrackFormat(i)
            val label = format.label ?: languageName(format.language) ?: "Faixa ${i + 1}"
            val extra = if (type == C.TRACK_TYPE_AUDIO && format.channelCount > 2) " (${format.channelCount} canais)" else ""
            Option(label + extra, group.isTrackSelected(i) && !(type == C.TRACK_TYPE_TEXT && textDisabled)) {
                player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                    .setTrackTypeDisabled(type, false)
                    .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, i))
                    .build()
            }
        }
    }

    val audio = options(C.TRACK_TYPE_AUDIO)
    val text = options(C.TRACK_TYPE_TEXT)
    val aspects = listOf(AspectMode.CONTAIN to "Ajustar à tela", AspectMode.COVER to "Preencher", AspectMode.FILL to "Esticar")

    TuiDialog("Opções", onDismiss, width = 600.dp) {
        LazyColumn(Modifier.heightIn(max = 420.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            item {
                ListRow(
                    if (favorite) "Remover dos favoritos" else "Adicionar aos favoritos",
                    { toggleFavorite(favoriteId, if (item.series != null) ContentKind.SERIES else item.kind, item.playlistId) },
                    Modifier.focusRequester(focus),
                )
            }
            item {
                val current = aspects.first { it.first == settings.aspect }
                ListRow("Proporção da imagem", {
                    val next = aspects[(aspects.indexOf(current) + 1) % aspects.size].first
                    library.settingsStore.update { it.copy(aspect = next) }
                }, trailing = current.second)
            }
            if (audio.size > 1) {
                item { Text("Áudio", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp)) }
                items(audio) { o -> ListRow(o.label, { o.action(); onDismiss() }, trailing = if (o.selected) "✓" else null, selected = o.selected) }
            }
            if (text.isNotEmpty()) {
                item { Text("Legendas", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp)) }
                item {
                    ListRow("Desativadas", {
                        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
                        onDismiss()
                    }, trailing = if (textDisabled) "✓" else null, selected = textDisabled)
                }
                items(text) { o -> ListRow(o.label, { o.action(); onDismiss() }, trailing = if (o.selected) "✓" else null, selected = o.selected) }
            }
        }
        ActionButton("Fechar", onDismiss)
    }
    RequestFocus(focus)
}
