package tv.tui.tuitv.ui.player

import android.view.KeyEvent as AndroidKeyEvent
import androidx.activity.compose.BackHandler
import androidx.annotation.OptIn
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.tv.material3.Border
import androidx.tv.material3.Button
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.Icon
import tv.tui.tuitv.ui.TuiIcons
import tv.tui.tuitv.ui.components.ButtonHeight
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
    // Busca "arrastada" (◀▶): a posição alvo acumula enquanto o usuário aperta e só é aplicada
    // quando ele para — o vídeo não engasga a cada toque, como no player da Netflix.
    var scrubTo by remember { mutableStateOf<Long?>(null) }
    var scrubSteps by remember { mutableIntStateOf(0) }
    var flash by remember { mutableStateOf<Flash?>(null) }
    var rootFocused by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            position = player.currentPosition.coerceAtLeast(0)
            duration = player.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: 0
            delay(250)
        }
    }
    LaunchedEffect(digits) {
        if (digits.isEmpty()) return@LaunchedEffect
        delay(1500)
        val n = digits.toIntOrNull()
        if (n != null && n in 1..queue.size) index = n - 1
        digits = ""
    }
    LaunchedEffect(scrubTo) {
        val target = scrubTo ?: return@LaunchedEffect
        delay(SCRUB_COMMIT_MS)
        player.seekTo(target)
        position = target
        scrubTo = null
        scrubSteps = 0
    }
    LaunchedEffect(flash) {
        if (flash == null) return@LaunchedEffect
        delay(650)
        flash = null
    }
    val scrubbing = scrubTo != null
    val overlay = now < overlayUntil || scrubbing || controller.phase is Phase.Paused || controller.phase is Phase.Error
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
    /** Próximo episódio da fila (séries), oferecido no player como na Netflix. */
    val next = queue.getOrNull(index + 1)?.takeIf { !live && item.series != null && it.series != null }
    fun playNext() {
        record()
        index++
        showOverlay()
    }
    fun scrub(direction: Int) {
        if (live || !player.isCurrentMediaItemSeekable || duration <= 0) return
        // Quanto mais toques seguidos, maior o salto: 10 s, depois 30 s, depois 1 min.
        val step = when {
            scrubSteps < 3 -> 10_000L
            scrubSteps < 8 -> 30_000L
            else -> 60_000L
        }
        scrubSteps++
        scrubTo = ((scrubTo ?: position) + direction * step).coerceIn(0, duration)
        flash = if (direction > 0) Flash.Forward else Flash.Back
        showOverlay()
    }
    fun commitScrub() {
        val target = scrubTo ?: return
        player.seekTo(target)
        position = target
        scrubTo = null
        scrubSteps = 0
    }
    fun togglePause() {
        controller.togglePause()
        flash = if (player.playWhenReady) Flash.Play else Flash.Pause
        showOverlay()
    }

    val focus = remember { FocusRequester() }
    val controlsFocus = remember { FocusRequester() }
    BackHandler {
        // Voltar primeiro esconde os controles (ou desfaz a busca); só então sai do player.
        when {
            scrubbing -> { scrubTo = null; scrubSteps = 0 }
            !rootFocused -> { focus.requestFocus(); overlayUntil = 0 }
            else -> navigator.back()
        }
    }
    // Controles escondidos não podem ficar com o foco.
    LaunchedEffect(overlay) { if (!overlay && !rootFocused) focus.requestFocus() }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .onFocusChanged { rootFocused = it.isFocused }
            .focusRequester(focus)
            .focusable()
            .onKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onKeyEvent false
                val code = event.key.nativeKeyCode
                val error = controller.phase is Phase.Error
                showOverlay()
                // Foco nos botões de baixo: ◀▶ e OK pertencem a eles; ▲ volta à barra de progresso.
                if (!rootFocused && !error) {
                    when (code) {
                        AndroidKeyEvent.KEYCODE_DPAD_UP -> { focus.requestFocus(); return@onKeyEvent true }
                        AndroidKeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> { togglePause(); return@onKeyEvent true }
                        else -> return@onKeyEvent false
                    }
                }
                when (code) {
                    AndroidKeyEvent.KEYCODE_DPAD_UP, AndroidKeyEvent.KEYCODE_CHANNEL_UP ->
                        if (live) change(+1) else Unit
                    AndroidKeyEvent.KEYCODE_DPAD_DOWN ->
                        when {
                            live -> change(-1)
                            error -> return@onKeyEvent false
                            else -> runCatching { controlsFocus.requestFocus() }
                        }
                    AndroidKeyEvent.KEYCODE_CHANNEL_DOWN -> if (live) change(-1)
                    AndroidKeyEvent.KEYCODE_MEDIA_NEXT -> if (next != null) playNext() else change(+1)
                    AndroidKeyEvent.KEYCODE_MEDIA_PREVIOUS -> change(-1)
                    AndroidKeyEvent.KEYCODE_DPAD_LEFT -> if (error) return@onKeyEvent false else scrub(-1)
                    AndroidKeyEvent.KEYCODE_DPAD_RIGHT -> if (error) return@onKeyEvent false else scrub(+1)
                    AndroidKeyEvent.KEYCODE_MEDIA_REWIND -> { scrubSteps = maxOf(scrubSteps, 3); scrub(-1) }
                    AndroidKeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { scrubSteps = maxOf(scrubSteps, 3); scrub(+1) }
                    AndroidKeyEvent.KEYCODE_DPAD_CENTER, AndroidKeyEvent.KEYCODE_ENTER, AndroidKeyEvent.KEYCODE_NUMPAD_ENTER ->
                        when {
                            error -> return@onKeyEvent false
                            scrubbing -> commitScrub()
                            live -> Unit
                            else -> togglePause()
                        }
                    AndroidKeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, AndroidKeyEvent.KEYCODE_SPACE -> togglePause()
                    AndroidKeyEvent.KEYCODE_MEDIA_PLAY -> player.playWhenReady = true
                    AndroidKeyEvent.KEYCODE_MEDIA_PAUSE -> player.playWhenReady = false
                    AndroidKeyEvent.KEYCODE_MENU, AndroidKeyEvent.KEYCODE_INFO, AndroidKeyEvent.KEYCODE_SETTINGS -> options = true
                    else -> {
                        val digit = digitOf(code) ?: return@onKeyEvent false
                        if (!live) return@onKeyEvent false
                        if (digits.length < 5) digits += digit
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

        val showControls = overlay && controller.phase !is Phase.Error
        AnimatedVisibility(showControls, Modifier.align(Alignment.TopCenter), enter = fadeIn(tween(200)), exit = fadeOut(tween(300))) {
            TopBar(item, index, queue.size, live)
        }
        AnimatedVisibility(showControls, Modifier.align(Alignment.BottomCenter), enter = fadeIn(tween(200)), exit = fadeOut(tween(300))) {
            if (live) {
                LiveBar(item, now)
            } else {
                VodBar(
                    phase = controller.phase,
                    position = scrubTo ?: position,
                    duration = duration,
                    scrubbing = scrubbing,
                    barFocused = rootFocused,
                    next = next,
                    controlsFocus = controlsFocus,
                    onPlayPause = ::togglePause,
                    onBack10 = { scrubSteps = 0; scrub(-1) },
                    onForward10 = { scrubSteps = 0; scrub(+1) },
                    onOptions = { options = true },
                    onNext = ::playNext,
                )
            }
        }
        // Retorno visual imediato de cada comando (play, pausa, ±10 s) no centro da tela.
        AnimatedVisibility(flash != null, Modifier.align(Alignment.Center), enter = fadeIn(tween(80)) + scaleIn(initialScale = 0.8f), exit = fadeOut(tween(250)) + scaleOut(targetScale = 1.2f)) {
            FlashIcon(flash)
        }
        // Fim próximo: oferta do próximo episódio, como na Netflix.
        if (next != null && duration > 0 && duration - position in 1..NEXT_OFFER_MS && !showControls) {
            NextEpisodeCard(next, Modifier.align(Alignment.BottomEnd).padding(48.dp))
        }

        (controller.phase as? Phase.Error)?.let { ErrorPanel(it.message, item, live, { controller.reload() }, { navigator.back() }, Modifier.align(Alignment.Center)) }
    }
    RequestFocus(focus, options)

    if (options) OptionsDialog(controller.player, item) { options = false }
}

private const val SCRUB_COMMIT_MS = 700L
private const val NEXT_OFFER_MS = 40_000L

private enum class Flash { Play, Pause, Back, Forward }

@Composable
private fun FlashIcon(flash: Flash?) {
    val icon = when (flash) {
        Flash.Play -> Icons.Filled.PlayArrow
        Flash.Pause -> TuiIcons.Pause
        Flash.Back -> TuiIcons.Replay10
        Flash.Forward -> TuiIcons.Forward10
        null -> return
    }
    Box(Modifier.size(112.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.55f)), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = null, tint = TuiColors.White, modifier = Modifier.size(64.dp))
    }
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
        modifier = modifier.clip(RoundedCornerShape(20.dp)).background(Color.Black.copy(alpha = 0.6f)).padding(horizontal = 18.dp, vertical = 8.dp),
    )
}

/** Faixa superior: o que está passando. */
@Composable
private fun TopBar(item: MediaItem, index: Int, total: Int, live: Boolean) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.8f), Color.Transparent)))
            .padding(start = 56.dp, end = 56.dp, top = 36.dp, bottom = 56.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (live) {
            RemoteImage(item.logo, item.name, Modifier.size(width = 96.dp, height = 56.dp))
            Spacer(Modifier.width(20.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(
                (if (live && total > 1) "${index + 1}  " else "") + (item.series?.title?.takeIf { it.isNotBlank() } ?: item.name),
                style = MaterialTheme.typography.headlineSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            item.series?.let {
                Text(Txt.episodeLabel(it.season, it.episode) + "  " + item.name, style = MaterialTheme.typography.titleMedium, color = TuiColors.White.copy(alpha = 0.75f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

private val BottomGradient = Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.85f)))

@Composable
private fun LiveBar(item: MediaItem, now: Long) {
    val library = library()
    val epg by produceState<NowNext<Programme>?>(null, item.id, now / 60_000) { value = library.nowNext(item) }
    Column(
        Modifier.fillMaxWidth().background(BottomGradient).padding(start = 56.dp, end = 56.dp, top = 72.dp, bottom = 40.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val current = epg?.current
        if (current != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("AO VIVO", style = MaterialTheme.typography.labelLarge, color = TuiColors.White, modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(TuiColors.Danger).padding(horizontal = 8.dp, vertical = 2.dp))
                Spacer(Modifier.width(14.dp))
                Text("${Txt.time(current.start)} – ${Txt.time(current.stop)}   ${current.title}", style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            ProgressLine(programmeProgress(current.start, current.stop, now), Modifier.fillMaxWidth(), height = 5.dp, color = TuiColors.Danger, track = TuiColors.White.copy(alpha = 0.25f))
            epg?.next?.firstOrNull()?.let { Muted("A seguir: ${Txt.time(it.start)}  ${it.title}", maxLines = 1) }
        } else {
            Muted(item.group ?: Txt.LIVE)
        }
        Muted("▲▼ trocar canal · números: ir ao canal · ☰ opções · Voltar sai", maxLines = 1)
    }
}

/** Controles de filmes e episódios: barra de progresso com o tempo restante e botões embaixo. */
@Composable
private fun VodBar(
    phase: Phase,
    position: Long,
    duration: Long,
    scrubbing: Boolean,
    barFocused: Boolean,
    next: MediaItem?,
    controlsFocus: FocusRequester,
    onPlayPause: () -> Unit,
    onBack10: () -> Unit,
    onForward10: () -> Unit,
    onOptions: () -> Unit,
    onNext: () -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().background(BottomGradient).padding(start = 56.dp, end = 56.dp, top = 96.dp, bottom = 36.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        if (duration > 0) {
            SeekBar(position, duration, scrubbing, barFocused)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            val paused = phase == Phase.Paused
            PlayerButton(if (paused) Icons.Filled.PlayArrow else TuiIcons.Pause, if (paused) "Assistir" else "Pausar", onPlayPause, Modifier.focusRequester(controlsFocus))
            PlayerButton(TuiIcons.Replay10, "Voltar 10 s", onBack10)
            PlayerButton(TuiIcons.Forward10, "Avançar 10 s", onForward10)
            PlayerButton(TuiIcons.Subtitles, "Áudio e legendas", onOptions, label = true)
            if (next != null) PlayerButton(TuiIcons.SkipNext, "Próximo episódio", onNext, label = true)
            Spacer(Modifier.weight(1f))
            Muted(if (barFocused) "◀▶ avançar/voltar · OK pausa · ▼ botões" else "▲ barra de progresso", maxLines = 1)
        }
    }
}

@Composable
private fun SeekBar(position: Long, duration: Long, scrubbing: Boolean, focused: Boolean) {
    val fraction = (position.toFloat() / duration).coerceIn(0f, 1f)
    val height by animateDpAsState(if (focused) 6.dp else 4.dp, tween(150), label = "bar")
    val thumb by animateDpAsState(if (focused) 20.dp else 0.dp, tween(150), label = "thumb")
    Column {
        BoxWithConstraints(Modifier.fillMaxWidth().height(28.dp)) {
            val x = maxWidth * fraction
            // Tempo alvo acima do marcador enquanto o usuário avança/volta.
            if (scrubbing) {
                Text(
                    Txt.clock(position / 1000),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.offset(x = (x - 36.dp).coerceIn(0.dp, maxWidth - 72.dp)).width(72.dp),
                    textAlign = TextAlign.Center,
                )
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            BoxWithConstraints(Modifier.weight(1f).height(24.dp), contentAlignment = Alignment.CenterStart) {
                Box(Modifier.fillMaxWidth().height(height).clip(RoundedCornerShape(height)).background(TuiColors.White.copy(alpha = 0.3f)))
                Box(Modifier.fillMaxWidth(fraction).height(height).clip(RoundedCornerShape(height)).background(TuiColors.Danger))
                if (thumb > 0.dp) {
                    Box(Modifier.offset(x = (maxWidth * fraction - thumb / 2).coerceAtLeast(0.dp)).size(thumb).clip(CircleShape).background(TuiColors.Danger))
                }
            }
            Spacer(Modifier.width(20.dp))
            // Como na Netflix: o tempo que falta, não o total.
            Text("-" + Txt.clock(((duration - position).coerceAtLeast(0)) / 1000), style = MaterialTheme.typography.titleMedium)
        }
    }
}

/** Botão redondo do player (só ícone) ou em pílula com rótulo; branco no foco, sem borda. */
@Composable
private fun PlayerButton(icon: androidx.compose.ui.graphics.vector.ImageVector, description: String, onClick: () -> Unit, modifier: Modifier = Modifier, label: Boolean = false) {
    Button(
        onClick = onClick,
        modifier = modifier.height(ButtonHeight).let { if (label) it else it.width(ButtonHeight) },
        shape = ButtonDefaults.shape(CircleShape),
        colors = ButtonDefaults.colors(
            containerColor = TuiColors.White.copy(alpha = 0.14f),
            contentColor = TuiColors.White,
            focusedContainerColor = TuiColors.White,
            focusedContentColor = Color.Black,
        ),
        border = ButtonDefaults.border(focusedBorder = Border.None),
        scale = ButtonDefaults.scale(focusedScale = 1.1f),
        contentPadding = if (label) PaddingValues(start = 16.dp, end = 20.dp) else PaddingValues(0.dp),
    ) {
        Row(Modifier.fillMaxHeight(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
            Icon(icon, contentDescription = description, modifier = Modifier.size(26.dp))
            if (label) {
                Spacer(Modifier.width(8.dp))
                Text(description, style = MaterialTheme.typography.titleSmall, maxLines = 1)
            }
        }
    }
}

@Composable
private fun NextEpisodeCard(next: MediaItem, modifier: Modifier) {
    Column(
        modifier.width(360.dp).clip(RoundedCornerShape(12.dp)).background(Color.Black.copy(alpha = 0.75f)).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Muted("A seguir")
        next.series?.let { Text(Txt.episodeLabel(it.season, it.episode) + "  " + next.name, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis) }
        Muted("Aperte ▶▶| ou ▼ e escolha “Próximo episódio”.", maxLines = 2)
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
