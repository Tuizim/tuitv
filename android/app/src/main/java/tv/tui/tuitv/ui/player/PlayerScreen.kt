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
import androidx.compose.runtime.rememberUpdatedState
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
import tv.tui.tuitv.ui.activity
import tv.tui.tuitv.ui.device
import tv.tui.tuitv.ui.components.IconAction
import tv.tui.tuitv.ui.components.tapToClick
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

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
    // Toque: o usuário esconde os controles quando quiser, mesmo com o vídeo pausado.
    var hiddenByTouch by remember { mutableStateOf(false) }
    /** Lido na hora (gestos e teclas não podem usar o valor de uma composição antiga). */
    fun overlayVisible() = !hiddenByTouch &&
        (System.currentTimeMillis() < overlayUntil || scrubTo != null || controller.phase is Phase.Paused || controller.phase is Phase.Error)
    val overlay = !hiddenByTouch && (now < overlayUntil || scrubbing || controller.phase is Phase.Paused || controller.phase is Phase.Error)
    fun showOverlay() {
        hiddenByTouch = false
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
    val touch = device().touch
    BackHandler {
        // Voltar primeiro esconde os controles (ou desfaz a busca); só então sai do player.
        // No toque não há foco nos botões: Voltar sai direto, como no celular.
        when {
            scrubbing -> { scrubTo = null; scrubSteps = 0 }
            touch -> navigator.back()
            !rootFocused -> { focus.requestFocus(); overlayUntil = 0 }
            else -> navigator.back()
        }
    }
    // Celular/tablet: tela cheia de verdade (as barras do sistema voltam com um deslize).
    val view = LocalView.current
    if (touch) {
        DisposableEffect(Unit) {
            val window = context.activity()?.window
            val bars = window?.let { WindowCompat.getInsetsController(it, view) }
            bars?.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            bars?.hide(WindowInsetsCompat.Type.systemBars())
            onDispose { bars?.show(WindowInsetsCompat.Type.systemBars()) }
        }
    }
    /** Toque na imagem: mostra os controles ou, se estiverem à vista, esconde. */
    fun toggleOverlay() {
        if (overlayVisible()) {
            overlayUntil = 0
            hiddenByTouch = true
        } else {
            showOverlay()
        }
    }
    fun seekTouch(fraction: Float, done: Boolean) {
        if (live || duration <= 0) return
        scrubTo = (fraction.coerceIn(0f, 1f) * duration).toLong()
        showOverlay()
        if (done) commitScrub()
    }
    // Os gestos vivem mais que uma composição: sempre chamam a versão atual das ações.
    val onVideoTap by rememberUpdatedState(::toggleOverlay)
    val onVideoDoubleTap by rememberUpdatedState { direction: Int ->
        scrubSteps = 0
        scrub(direction)
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
        // Toque: camada transparente sobre o vídeo, para os gestos não dependerem da View do player.
        // Toque mostra/esconde os controles; dois toques à esquerda/direita voltam/avançam 10 s.
        if (touch) {
            Box(
                Modifier.fillMaxSize().pointerInput(live) {
                    detectTapGestures(
                        onTap = { onVideoTap() },
                        onDoubleTap = if (live) null else { o -> onVideoDoubleTap(if (o.x < size.width / 2) -1 else +1) },
                    )
                },
            )
        }

        StatusBadge(controller.phase, Modifier.align(Alignment.TopEnd).padding(if (touch) 20.dp else 32.dp))
        if (digits.isNotEmpty()) {
            Text(digits, style = MaterialTheme.typography.displayMedium, color = TuiColors.White, modifier = Modifier.align(Alignment.TopStart).padding(40.dp))
        }

        val showControls = overlay && controller.phase !is Phase.Error
        AnimatedVisibility(showControls, Modifier.align(Alignment.TopCenter), enter = fadeIn(tween(200)), exit = fadeOut(tween(300))) {
            TopBar(item, index, queue.size, live, onBack = if (touch) ({ navigator.back() }) else null, onOptions = if (touch) ({ options = true }) else null)
        }
        // Toque: controles grandes no centro da imagem, como no app da Netflix no celular.
        if (touch) {
            AnimatedVisibility(showControls, Modifier.align(Alignment.Center), enter = fadeIn(tween(200)), exit = fadeOut(tween(300))) {
                CenterControls(
                    live = live,
                    paused = controller.phase == Phase.Paused,
                    canChange = queue.size > 1,
                    onPlayPause = ::togglePause,
                    onBack10 = { scrubSteps = 0; scrub(-1) },
                    onForward10 = { scrubSteps = 0; scrub(+1) },
                    onPrevious = { change(-1) },
                    onNext = { change(+1) },
                )
            }
        }
        AnimatedVisibility(showControls, Modifier.align(Alignment.BottomCenter), enter = fadeIn(tween(200)), exit = fadeOut(tween(300))) {
            if (live) {
                LiveBar(item, now, touch)
            } else {
                VodBar(
                    phase = controller.phase,
                    position = scrubTo ?: position,
                    duration = duration,
                    scrubbing = scrubbing,
                    barFocused = rootFocused && !touch,
                    next = next,
                    controlsFocus = controlsFocus,
                    touch = touch,
                    onSeek = ::seekTouch,
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
            NextEpisodeCard(next, touch, ::playNext, Modifier.align(Alignment.BottomEnd).padding(if (touch) 20.dp else 48.dp))
        }

        (controller.phase as? Phase.Error)?.let { ErrorPanel(it.message, item, live, { controller.reload() }, { navigator.back() }, Modifier.align(Alignment.Center)) }
    }
    // Também no toque: a raiz recebe as teclas de um teclado ou controle Bluetooth.
    RequestFocus(focus, options, always = true)

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
private fun TopBar(item: MediaItem, index: Int, total: Int, live: Boolean, onBack: (() -> Unit)? = null, onOptions: (() -> Unit)? = null) {
    val touch = onBack != null
    Row(
        Modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.8f), Color.Transparent)))
            .padding(start = if (touch) 12.dp else 56.dp, end = if (touch) 12.dp else 56.dp, top = if (touch) 12.dp else 36.dp, bottom = if (touch) 32.dp else 56.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            IconAction(Icons.AutoMirrored.Filled.ArrowBack, "Sair do player", onBack)
            Spacer(Modifier.width(8.dp))
        }
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
        if (onOptions != null) IconAction(TuiIcons.Subtitles, "Áudio e legendas", onOptions)
    }
}

/** Controles centrais no toque: ±10 s e reproduzir/pausar (filmes) ou canal anterior/seguinte (ao vivo). */
@Composable
private fun CenterControls(
    live: Boolean,
    paused: Boolean,
    canChange: Boolean,
    onPlayPause: () -> Unit,
    onBack10: () -> Unit,
    onForward10: () -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(40.dp), verticalAlignment = Alignment.CenterVertically) {
        if (live) {
            if (canChange) {
                PlayerButton(TuiIcons.SkipPrevious, "Canal anterior", onPrevious, size = 64.dp)
                PlayerButton(TuiIcons.SkipNext, "Próximo canal", onNext, size = 64.dp)
            }
        } else {
            PlayerButton(TuiIcons.Replay10, "Voltar 10 s", onBack10, size = 64.dp)
            PlayerButton(if (paused) Icons.Filled.PlayArrow else TuiIcons.Pause, if (paused) "Assistir" else "Pausar", onPlayPause, size = 84.dp)
            PlayerButton(TuiIcons.Forward10, "Avançar 10 s", onForward10, size = 64.dp)
        }
    }
}

private val BottomGradient = Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.85f)))

@Composable
private fun LiveBar(item: MediaItem, now: Long, touch: Boolean) {
    val library = library()
    val epg by produceState<NowNext<Programme>?>(null, item.id, now / 60_000) { value = library.nowNext(item) }
    Column(
        Modifier.fillMaxWidth().background(BottomGradient).padding(start = if (touch) 20.dp else 56.dp, end = if (touch) 20.dp else 56.dp, top = if (touch) 40.dp else 72.dp, bottom = if (touch) 20.dp else 40.dp),
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
        if (!touch) Muted("▲▼ trocar canal · números: ir ao canal · ☰ opções · Voltar sai", maxLines = 1)
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
    touch: Boolean,
    onSeek: (Float, Boolean) -> Unit,
    onPlayPause: () -> Unit,
    onBack10: () -> Unit,
    onForward10: () -> Unit,
    onOptions: () -> Unit,
    onNext: () -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().background(BottomGradient).padding(start = if (touch) 20.dp else 56.dp, end = if (touch) 20.dp else 56.dp, top = if (touch) 48.dp else 96.dp, bottom = if (touch) 16.dp else 36.dp),
        verticalArrangement = Arrangement.spacedBy(if (touch) 10.dp else 18.dp),
    ) {
        if (duration > 0) {
            SeekBar(position, duration, scrubbing, barFocused || touch, if (touch) onSeek else null)
        }
        if (touch) {
            // Play e ±10 s ficam no centro da tela; embaixo, só o que é secundário.
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                PlayerButton(TuiIcons.Subtitles, "Áudio e legendas", onOptions, label = true)
                if (next != null) PlayerButton(TuiIcons.SkipNext, "Próximo episódio", onNext, label = true)
            }
            return@Column
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
private fun SeekBar(position: Long, duration: Long, scrubbing: Boolean, focused: Boolean, onSeek: ((Float, Boolean) -> Unit)? = null) {
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
            // Toque: tocar leva ao ponto; arrastar busca e só aplica ao soltar.
            val seek by rememberUpdatedState(onSeek)
            val seekGestures = if (onSeek == null) Modifier else Modifier
                .pointerInput(Unit) {
                    detectTapGestures { o -> seek?.invoke(o.x / size.width, true) }
                }
                .pointerInput(Unit) {
                    var last = 0f
                    detectHorizontalDragGestures(
                        onDragStart = { o -> last = o.x / size.width; seek?.invoke(last, false) },
                        onDragEnd = { seek?.invoke(last, true) },
                        onDragCancel = { seek?.invoke(last, true) },
                    ) { change, _ ->
                        change.consume()
                        last = change.position.x / size.width
                        seek?.invoke(last, false)
                    }
                }
            BoxWithConstraints(Modifier.weight(1f).height(if (onSeek != null) 36.dp else 24.dp).then(seekGestures), contentAlignment = Alignment.CenterStart) {
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
private fun PlayerButton(icon: androidx.compose.ui.graphics.vector.ImageVector, description: String, onClick: () -> Unit, modifier: Modifier = Modifier, label: Boolean = false, size: androidx.compose.ui.unit.Dp = ButtonHeight) {
    val interaction = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    Button(
        onClick = onClick,
        interactionSource = interaction,
        modifier = modifier.height(size).let { if (label) it else it.width(size) }.tapToClick(interaction, onClick = onClick),
        shape = ButtonDefaults.shape(CircleShape),
        colors = ButtonDefaults.colors(
            containerColor = TuiColors.White.copy(alpha = 0.14f),
            contentColor = TuiColors.White,
            focusedContainerColor = TuiColors.White,
            focusedContentColor = Color.Black,
        ),
        border = ButtonDefaults.border(focusedBorder = Border.None),
        scale = ButtonDefaults.scale(focusedScale = 1.1f, pressedScale = 0.92f),
        contentPadding = if (label) PaddingValues(start = 16.dp, end = 20.dp) else PaddingValues(0.dp),
    ) {
        // Só ícone: o ícone ocupa o centro exato do círculo (o botão da TV alinha o conteúdo à esquerda).
        Row(Modifier.fillMaxHeight().then(if (label) Modifier else Modifier.weight(1f)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
            Icon(icon, contentDescription = description, modifier = Modifier.size(if (size > ButtonHeight) size * 0.5f else 26.dp))
            if (label) {
                Spacer(Modifier.width(8.dp))
                Text(description, style = MaterialTheme.typography.titleSmall, maxLines = 1)
            }
        }
    }
}

@Composable
private fun NextEpisodeCard(next: MediaItem, touch: Boolean, onPlay: () -> Unit, modifier: Modifier) {
    val interaction = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    Column(
        modifier.widthIn(max = 360.dp).clip(RoundedCornerShape(12.dp)).background(Color.Black.copy(alpha = 0.75f))
            .let { if (touch) it.tapToClick(interaction, onClick = onPlay) else it }
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Muted("A seguir")
        next.series?.let { Text(Txt.episodeLabel(it.season, it.episode) + "  " + next.name, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis) }
        Muted(if (touch) "Toque para assistir agora." else "Aperte ▶▶| ou ▼ e escolha “Próximo episódio”.", maxLines = 2)
    }
}

@Composable
private fun ErrorPanel(message: String, item: MediaItem, live: Boolean, onRetry: () -> Unit, onBack: () -> Unit, modifier: Modifier) {
    val focus = remember { FocusRequester() }
    Column(
        modifier.widthIn(max = 640.dp).fillMaxWidth(0.92f).clip(RoundedCornerShape(16.dp)).background(TuiColors.Navy.copy(alpha = 0.95f)).padding(if (device().compact || device().phone) 20.dp else 32.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Não foi possível reproduzir", style = MaterialTheme.typography.headlineSmall)
        Text(item.name, style = MaterialTheme.typography.titleMedium, color = TuiColors.Muted)
        Text(message, style = MaterialTheme.typography.bodyLarge)
        if (live) Muted(if (device().tv) "Use ▲▼ para ir a outro canal." else "Volte e escolha outro canal.")
        tv.tui.tuitv.ui.components.ButtonRow {
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
