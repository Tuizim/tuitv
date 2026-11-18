package tv.tui.tuitv.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Shape
import androidx.tv.material3.Glow
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.tv.material3.Border
import androidx.tv.material3.Button
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.Icon
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.SurfaceDefaults
import androidx.tv.material3.Text
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import coil3.compose.SubcomposeAsyncImage
import kotlinx.coroutines.delay
import tv.tui.tuitv.ui.device
import tv.tui.tuitv.ui.theme.TuiColors

private val CardShape = RoundedCornerShape(10.dp)
private val RowShape = RoundedCornerShape(10.dp)
private val PillShape = RoundedCornerShape(50)

/**
 * Botões esticados (largura da tela no celular): o conteúdo fica centralizado, como na Netflix.
 * Quem estica os botões declara isso com [FillButtons].
 */
val LocalFillButtons = androidx.compose.runtime.compositionLocalOf { false }

@Composable
fun FillButtons(content: @Composable () -> Unit) =
    androidx.compose.runtime.CompositionLocalProvider(LocalFillButtons provides true, content = content)

/** Altura única de todos os botões do aplicativo. */
val ButtonHeight = 48.dp
private val ButtonMinWidth = 132.dp

/** Brilho suave ao redor do elemento em foco (no lugar de borda). */
private val FocusGlow = Glow(elevationColor = TuiColors.Cyan.copy(alpha = 0.55f), elevation = 14.dp)

/**
 * Superfície focável padrão, sem borda: no foco ela cresce, ganha brilho e o conteúdo
 * escurecido "acende" ([dimUnfocused]) — o mesmo vocabulário visual de cartões da Netflix.
 */
@Composable
fun TuiSurface(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    onLongClick: (() -> Unit)? = null,
    shape: Shape = CardShape,
    focusedScale: Float = 1.08f,
    container: Color = TuiColors.NavyRaised,
    dimUnfocused: Boolean = true,
    interactionSource: MutableInteractionSource = remember { MutableInteractionSource() },
    content: @Composable BoxScope.() -> Unit,
) {
    val focused by interactionSource.collectIsFocusedAsState()
    // No toque não há foco: nada fica escurecido esperando o controle.
    val dims = dimUnfocused && device().tv
    val dim by animateFloatAsState(if (focused || !dims) 0f else 0.28f, tween(180), label = "dim")
    Surface(
        onClick = onClick,
        onLongClick = onLongClick,
        modifier = modifier.tapToClick(interactionSource, onLongClick = onLongClick, onClick = onClick),
        interactionSource = interactionSource,
        shape = ClickableSurfaceDefaults.shape(shape),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = container,
            contentColor = TuiColors.White,
            focusedContainerColor = container,
            focusedContentColor = TuiColors.White,
            pressedContainerColor = container,
            pressedContentColor = TuiColors.White,
        ),
        border = ClickableSurfaceDefaults.border(border = Border.None, focusedBorder = Border.None, pressedBorder = Border.None),
        glow = ClickableSurfaceDefaults.glow(focusedGlow = FocusGlow),
        scale = ClickableSurfaceDefaults.scale(focusedScale = focusedScale, pressedScale = 0.96f),
    ) {
        content()
        if (dim > 0f) Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = dim)))
    }
}

/**
 * Botão padrão: mesma altura e largura mínima em todo o aplicativo, sem borda.
 * Em foco fica branco (texto escuro) e cresce levemente; [primary] marca a ação principal
 * (ou a opção escolhida, em seletores).
 */
@Composable
fun ActionButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    primary: Boolean = false,
    enabled: Boolean = true,
) {
    val interaction = remember { MutableInteractionSource() }
    Button(
        onClick = onClick,
        modifier = modifier.height(ButtonHeight).widthIn(min = ButtonMinWidth).tapToClick(interaction, enabled, onClick = onClick),
        enabled = enabled,
        interactionSource = interaction,
        shape = ButtonDefaults.shape(PillShape),
        colors = ButtonDefaults.colors(
            containerColor = if (primary) TuiColors.Cyan else TuiColors.White.copy(alpha = 0.12f),
            contentColor = if (primary) TuiColors.Navy else TuiColors.White,
            focusedContainerColor = TuiColors.White,
            focusedContentColor = TuiColors.Navy,
            pressedContainerColor = TuiColors.White.copy(alpha = 0.85f),
            pressedContentColor = TuiColors.Navy,
            disabledContainerColor = TuiColors.White.copy(alpha = 0.06f),
            disabledContentColor = TuiColors.Muted,
        ),
        border = ButtonDefaults.border(
            border = Border.None,
            focusedBorder = Border.None,
            pressedBorder = Border.None,
            disabledBorder = Border.None,
            focusedDisabledBorder = Border.None,
        ),
        scale = ButtonDefaults.scale(focusedScale = 1.06f, focusedDisabledScale = 1.02f, pressedScale = 0.96f),
        glow = ButtonDefaults.glow(focusedGlow = Glow(TuiColors.White.copy(alpha = 0.25f), 10.dp)),
        contentPadding = PaddingValues(horizontal = 22.dp),
    ) {
        val fill = LocalFillButtons.current
        Row(Modifier.fillMaxHeight().then(if (fill) Modifier.weight(1f) else Modifier), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
            if (icon != null) {
                Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
            }
            Text(text, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun ScreenTitle(text: String, modifier: Modifier = Modifier, subtitle: String? = null) {
    Column(modifier.padding(bottom = 16.dp)) {
        // No toque o nome da tela já está no topo (TouchTopBar): aqui fica só o subtítulo.
        if (device().tv) Text(text, style = MaterialTheme.typography.headlineMedium, color = TuiColors.White)
        if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = TuiColors.Muted)
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.titleLarge, color = TuiColors.White, modifier = modifier.padding(vertical = 8.dp))
}

@Composable
fun Muted(text: String, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = TuiColors.Muted, modifier = modifier, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
}

@Composable
fun EmptyState(text: String, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) {
        Text(text, style = MaterialTheme.typography.bodyLarge, color = TuiColors.Muted)
    }
}

@Composable
fun Loading(modifier: Modifier = Modifier) = EmptyState(tv.tui.tuitv.ui.Txt.LOADING, modifier)

/** Imagem remota (logotipo ou capa) com iniciais como alternativa. */
@Composable
fun RemoteImage(url: String?, fallback: String, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Fit) {
    val placeholder: @Composable () -> Unit = {
        Box(Modifier.fillMaxSize().background(TuiColors.Line), contentAlignment = Alignment.Center) {
            Text(initials(fallback), color = TuiColors.Muted, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        }
    }
    if (url == null) {
        Box(modifier) { placeholder() }
        return
    }
    SubcomposeAsyncImage(
        model = url,
        contentDescription = null,
        modifier = modifier,
        contentScale = contentScale,
        loading = { placeholder() },
        error = { placeholder() },
    )
}

private fun initials(text: String): String =
    text.split(' ', '-', '|', ':').filter { it.isNotBlank() }.take(2).joinToString("") { it.take(1).uppercase() }.ifEmpty { "TV" }

@Composable
fun ProgressLine(fraction: Float, modifier: Modifier = Modifier, height: Dp = 4.dp, color: Color = TuiColors.Cyan, track: Color = TuiColors.Line) {
    Box(modifier.fillMaxWidth().height(height).clip(RoundedCornerShape(height)).background(track)) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(fraction.coerceIn(0f, 1f)).background(color))
    }
}

/**
 * Cartão com imagem e legenda: o título abaixo acende quando o cartão está em foco,
 * reforçando onde o controle está sem precisar de borda.
 */
@Composable
private fun MediaCard(
    title: String,
    onClick: () -> Unit,
    modifier: Modifier,
    imageHeight: Dp,
    onLongClick: (() -> Unit)?,
    caption: String?,
    progress: Float?,
    titleLines: Int,
    image: @Composable BoxScope.() -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val tv = device().tv
    val titleColor by animateColorAsState(if (focused || !tv) TuiColors.White else TuiColors.Muted, tween(180), label = "title")
    // Toque: o título embaixo da capa também abre o item (a capa encolhe junto, pelo mesmo estado).
    Column(if (tv) modifier else modifier.tapToClick(interaction, onLongClick = onLongClick, onClick = onClick)) {
        TuiSurface(onClick = onClick, onLongClick = onLongClick, interactionSource = interaction, modifier = Modifier.fillMaxWidth().height(imageHeight)) {
            image()
            if (progress != null) ProgressLine(progress, Modifier.align(Alignment.BottomCenter), color = TuiColors.Danger)
        }
        Text(
            title,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = if (focused) FontWeight.SemiBold else FontWeight.Normal),
            color = titleColor,
            maxLines = titleLines,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = if (tv) 10.dp else 6.dp),
        )
        if (caption != null) Muted(caption, maxLines = 1)
    }
}

/** Cartão de canal (logotipo + nome) para fileiras horizontais. */
@Composable
fun ChannelCard(name: String, logo: String?, onClick: () -> Unit, modifier: Modifier = Modifier, onLongClick: (() -> Unit)? = null, caption: String? = null, progress: Float? = null) {
    val compact = device().compact
    MediaCard(name, onClick, modifier.width(if (compact) 160.dp else 208.dp), if (compact) 90.dp else 117.dp, onLongClick, caption, progress, titleLines = 1) {
        RemoteImage(logo, name, Modifier.fillMaxSize().padding(if (compact) 12.dp else 16.dp))
    }
}

/** Cartão de capa 2:3 para filmes e séries; [fill] ocupa a largura da célula (grades). */
@Composable
fun PosterCard(title: String, image: String?, onClick: () -> Unit, modifier: Modifier = Modifier, onLongClick: (() -> Unit)? = null, caption: String? = null, progress: Float? = null, fill: Boolean = false) {
    val width = if (device().compact) 112.dp else 144.dp
    BoxWithConstraints(if (fill) modifier.fillMaxWidth() else modifier.width(width)) {
        MediaCard(title, onClick, Modifier.fillMaxWidth(), maxWidth * 1.5f, onLongClick, caption, progress, titleLines = 1) {
            RemoteImage(image, title, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        }
    }
}

/**
 * Linha focável de lista (categorias, canais, configurações). Sem borda: em foco a linha fica
 * branca com texto escuro; a opção escolhida (fora de foco) leva uma barra ciano à esquerda.
 */
@Composable
fun ListRow(
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    trailing: String? = null,
    selected: Boolean = false,
    onLongClick: (() -> Unit)? = null,
    onFocus: (() -> Unit)? = null,
    leading: (@Composable () -> Unit)? = null,
    progress: Float? = null,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val secondary = if (focused) TuiColors.Navy.copy(alpha = 0.72f) else TuiColors.Muted
    Surface(
        onClick = onClick,
        onLongClick = onLongClick,
        interactionSource = interaction,
        modifier = modifier.fillMaxWidth().onFocusChanged { if (it.isFocused) onFocus?.invoke() }.tapToClick(interaction, onLongClick = onLongClick, onClick = onClick),
        shape = ClickableSurfaceDefaults.shape(RowShape),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = if (selected) TuiColors.NavyRaised else TuiColors.NavyRaised.copy(alpha = 0.45f),
            contentColor = if (selected) TuiColors.Cyan else TuiColors.White,
            focusedContainerColor = TuiColors.White,
            focusedContentColor = TuiColors.Navy,
            pressedContainerColor = TuiColors.White.copy(alpha = 0.85f),
            pressedContentColor = TuiColors.Navy,
        ),
        border = ClickableSurfaceDefaults.border(border = Border.None, focusedBorder = Border.None, pressedBorder = Border.None),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.02f, pressedScale = 0.98f),
    ) {
        Row(Modifier.heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            if (selected && !focused) {
                Box(Modifier.padding(end = 12.dp).size(width = 4.dp, height = 22.dp).clip(RoundedCornerShape(2.dp)).background(TuiColors.Cyan))
            }
            if (leading != null) {
                leading()
                Spacer(Modifier.width(12.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(
                    title,
                    style = MaterialTheme.typography.bodyLarge.copy(fontWeight = if (focused || selected) FontWeight.SemiBold else FontWeight.Normal),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (progress != null) {
                    ProgressLine(
                        progress,
                        Modifier.padding(top = 6.dp),
                        height = 3.dp,
                        color = if (focused) TuiColors.Navy else TuiColors.Cyan,
                        track = if (focused) TuiColors.Navy.copy(alpha = 0.15f) else TuiColors.Line,
                    )
                }
            }
            if (trailing != null) {
                Spacer(Modifier.width(12.dp))
                Text(trailing, style = MaterialTheme.typography.bodyMedium, color = secondary, maxLines = 1)
            }
        }
    }
}

/**
 * Cartão de episódio no estilo Netflix: número, miniatura 16:9 (com o progresso), título próprio do episódio,
 * duração e sinopse, quando a lista informa. Mesmo desenho da Web e da Samsung.
 */
@Composable
fun EpisodeCard(
    number: Int,
    title: String,
    image: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    duration: String? = null,
    synopsis: String? = null,
    watched: Boolean = false,
    progress: Float? = null,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val compact = device().compact
    val secondary = if (focused) TuiColors.Navy.copy(alpha = 0.72f) else TuiColors.Muted
    Surface(
        onClick = onClick,
        interactionSource = interaction,
        modifier = modifier.fillMaxWidth().tapToClick(interaction, onClick = onClick),
        shape = ClickableSurfaceDefaults.shape(RowShape),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Color.Transparent,
            contentColor = TuiColors.White,
            focusedContainerColor = TuiColors.White,
            focusedContentColor = TuiColors.Navy,
            pressedContainerColor = TuiColors.White.copy(alpha = 0.85f),
            pressedContentColor = TuiColors.Navy,
        ),
        border = ClickableSurfaceDefaults.border(border = Border.None, focusedBorder = Border.None, pressedBorder = Border.None),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.02f, pressedScale = 0.98f),
    ) {
        Row(Modifier.padding(if (compact) 8.dp else 12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (!compact) {
                Text(if (number > 0) "$number" else "•", style = MaterialTheme.typography.headlineSmall, color = secondary, modifier = Modifier.width(40.dp))
            }
            Box(Modifier.width(if (compact) 128.dp else 208.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(8.dp)).background(TuiColors.Line)) {
                RemoteImage(image, title, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                if (progress != null) ProgressLine(progress, Modifier.align(Alignment.BottomCenter), height = 4.dp, color = TuiColors.Danger, track = Color.Black.copy(alpha = 0.6f))
            }
            Spacer(Modifier.width(if (compact) 12.dp else 20.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.Top) {
                    Text(
                        (if (compact && number > 0) "$number. " else "") + title,
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                        color = if (watched && !focused) TuiColors.Muted else Color.Unspecified,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (duration != null) {
                        Spacer(Modifier.width(12.dp))
                        Text(duration, style = MaterialTheme.typography.bodyMedium, color = secondary, maxLines = 1)
                    }
                }
                if (watched) Text("Assistido", style = MaterialTheme.typography.labelMedium, color = if (focused) TuiColors.Navy else TuiColors.Success)
                if (!synopsis.isNullOrBlank()) {
                    Text(synopsis, style = MaterialTheme.typography.bodyMedium, color = secondary, maxLines = if (compact) 2 else 3, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

/**
 * Bloco da grade de episódios (quando a lista não traz miniatura nem sinopse por episódio): número grande,
 * título próprio (se houver), duração e o estado — "Próximo"/"Continuar" em destaque, progresso ou assistido.
 * Mesmo desenho da Web e da Samsung.
 */
@Composable
fun EpisodeTile(
    number: Int,
    title: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    duration: String? = null,
    watched: Boolean = false,
    next: Boolean = false,
    progress: Float? = null,
) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val compact = device().compact
    val secondary = if (focused) TuiColors.Navy.copy(alpha = 0.72f) else TuiColors.Muted
    val dim = watched && !next && !focused
    Surface(
        onClick = onClick,
        interactionSource = interaction,
        modifier = modifier.height(if (compact) 112.dp else 132.dp).tapToClick(interaction, onClick = onClick),
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(14.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = if (next) TuiColors.Cyan.copy(alpha = 0.14f) else TuiColors.NavyRaised.copy(alpha = if (dim) 0.4f else 0.7f),
            contentColor = if (dim) TuiColors.Muted else TuiColors.White,
            focusedContainerColor = TuiColors.White,
            focusedContentColor = TuiColors.Navy,
            pressedContainerColor = TuiColors.White.copy(alpha = 0.85f),
            pressedContentColor = TuiColors.Navy,
        ),
        border = ClickableSurfaceDefaults.border(
            border = if (next) Border(androidx.compose.foundation.BorderStroke(2.dp, TuiColors.Cyan), shape = RoundedCornerShape(14.dp)) else Border.None,
            focusedBorder = Border.None,
            pressedBorder = Border.None,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.05f, pressedScale = 0.97f),
    ) {
        Box(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().padding(if (compact) 12.dp else 14.dp)) {
                Row(verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f)) {
                        Text("EPISÓDIO", style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 1.5.sp), color = secondary)
                        Text(if (number > 0) "$number" else "•", style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.ExtraBold))
                    }
                    if (next) {
                        Box(Modifier.clip(RoundedCornerShape(50)).background(if (focused) TuiColors.Navy else TuiColors.Cyan).padding(horizontal = 8.dp, vertical = 2.dp)) {
                            Text(if (progress != null) "CONTINUAR" else "PRÓXIMO", style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold), color = if (focused) TuiColors.White else TuiColors.Navy)
                        }
                    }
                }
                if (title != null) Text(title, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium), maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
                Spacer(Modifier.weight(1f))
                val status = if (watched) "✓ Assistido" else duration
                if (status != null) Text(status, style = MaterialTheme.typography.labelMedium, color = if (watched && !focused) TuiColors.Success else secondary, maxLines = 1)
            }
            if (progress != null) ProgressLine(progress, Modifier.align(Alignment.BottomCenter).padding(horizontal = 12.dp, vertical = 6.dp), height = 3.dp, color = TuiColors.Danger, track = Color.Black.copy(alpha = 0.4f))
        }
    }
}

/** Campo de texto para TV: OK abre o teclado do sistema; no foco o fundo clareia e surge um traço ciano embaixo. */
@Composable
fun TvTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    password: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Done,
    onDone: () -> Unit = {},
    focusRequester: FocusRequester? = null,
) {
    var focused by remember { mutableStateOf(false) }
    val background by animateColorAsState(if (focused) TuiColors.Focus else TuiColors.NavyRaised, tween(150), label = "field")
    val line by animateDpAsState(if (focused) 3.dp else 0.dp, tween(150), label = "line")
    Column(modifier) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = if (focused) TuiColors.Cyan else TuiColors.Muted, modifier = Modifier.padding(bottom = 6.dp))
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = TuiColors.White),
            cursorBrush = SolidColor(TuiColors.Cyan),
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction, autoCorrectEnabled = false),
            keyboardActions = KeyboardActions(onDone = { onDone() }, onSearch = { onDone() }, onGo = { onDone() }),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = ButtonHeight)
                .let { if (focusRequester != null) it.focusRequester(focusRequester) else it }
                .onFocusChanged { focused = it.isFocused }
                .clip(RoundedCornerShape(8.dp))
                .background(background)
                .drawBehind {
                    val h = line.toPx()
                    if (h > 0f) drawRect(TuiColors.Cyan, topLeft = Offset(0f, size.height - h), size = Size(size.width, h))
                }
                .padding(horizontal = 14.dp, vertical = 12.dp),
            decorationBox = { inner ->
                Box {
                    if (value.isEmpty() && placeholder.isNotEmpty()) Text(placeholder, color = TuiColors.Muted, style = MaterialTheme.typography.bodyLarge)
                    inner()
                }
            },
        )
    }
}

/** Janela modal centralizada. */
@Composable
fun TuiDialog(title: String, onDismiss: () -> Unit, width: Dp = 560.dp, content: @Composable () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            // Na TV, a largura pedida; no celular, quase a tela inteira (sem passar da pedida).
            modifier = Modifier.widthIn(max = width).fillMaxWidth(0.94f),
            shape = RoundedCornerShape(16.dp),
            colors = SurfaceDefaults.colors(containerColor = TuiColors.Navy, contentColor = TuiColors.White),
        ) {
            // Rolável: na TV (540dp de altura) formulários maiores não cabem inteiros; o foco rola até o campo.
            Column(Modifier.verticalScroll(rememberScrollState()).padding(if (device().compact) 20.dp else 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(title, style = MaterialTheme.typography.headlineSmall)
                content()
            }
        }
    }
}

@Composable
fun ConfirmDialog(title: String, message: String, confirm: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val focus = remember { FocusRequester() }
    TuiDialog(title, onDismiss) {
        Text(message, style = MaterialTheme.typography.bodyLarge)
        ButtonRow {
            ActionButton("Cancelar", onDismiss, Modifier.focusRequester(focus))
            ActionButton(confirm, onConfirm, primary = true)
        }
    }
    RequestFocus(focus)
}

/**
 * Pede foco assim que o elemento é composto (ignora se ele ainda não estiver na tela).
 * Só na TV: no toque, foco automático acenderia um cartão ou abriria o teclado sem o usuário pedir.
 * [always] vale também no toque (ex.: o player, que recebe as teclas de um teclado/controle Bluetooth).
 */
@Composable
fun RequestFocus(requester: FocusRequester, key: Any? = Unit, always: Boolean = false, onFocused: () -> Unit = {}) {
    if (!always && !device().tv) return
    LaunchedEffect(key) {
        // Até ~2 s: listas grandes podem demorar a carregar antes de o item existir na tela.
        repeat(36) {
            if (runCatching { requester.requestFocus() }.getOrDefault(false)) {
                onFocused()
                return@LaunchedEffect
            }
            delay(60)
        }
    }
}

/** Mensagem de erro em destaque. */
@Composable
fun ErrorText(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = TuiColors.Danger, modifier = modifier)
}

/** Grupo de botões: na TV cabe numa linha; em telas estreitas os botões descem para a linha de baixo. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ButtonRow(modifier: Modifier = Modifier, horizontalSpacing: Dp = 12.dp, content: @Composable () -> Unit) {
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(horizontalSpacing), verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }
}

/** Pílula de categoria (celular): a escolhida fica branca; toque escolhe. */
@Composable
fun Chip(text: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val interaction = remember { MutableInteractionSource() }
    Surface(
        onClick = onClick,
        interactionSource = interaction,
        modifier = modifier.height(36.dp).tapToClick(interaction, onClick = onClick),
        shape = ClickableSurfaceDefaults.shape(PillShape),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = if (selected) TuiColors.White else Color.Transparent,
            contentColor = if (selected) TuiColors.Navy else TuiColors.White,
            focusedContainerColor = TuiColors.White,
            focusedContentColor = TuiColors.Navy,
            pressedContainerColor = TuiColors.White.copy(alpha = 0.85f),
            pressedContentColor = TuiColors.Navy,
        ),
        border = ClickableSurfaceDefaults.border(
            border = if (selected) Border.None else Border(androidx.compose.foundation.BorderStroke(1.dp, TuiColors.Muted.copy(alpha = 0.6f)), shape = PillShape),
            focusedBorder = Border.None,
            pressedBorder = Border.None,
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.04f, pressedScale = 0.96f),
    ) {
        Box(Modifier.fillMaxHeight().padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
            Text(text, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Botão redondo só com ícone, para cabeçalhos e barras de toque. */
@Composable
fun IconAction(icon: ImageVector, description: String, onClick: () -> Unit, modifier: Modifier = Modifier, tint: Color = TuiColors.White) {
    val interaction = remember { MutableInteractionSource() }
    Surface(
        onClick = onClick,
        interactionSource = interaction,
        modifier = modifier.size(44.dp).tapToClick(interaction, onClick = onClick),
        shape = ClickableSurfaceDefaults.shape(androidx.compose.foundation.shape.CircleShape),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = Color.Transparent,
            contentColor = tint,
            focusedContainerColor = TuiColors.White,
            focusedContentColor = TuiColors.Navy,
            pressedContainerColor = TuiColors.White.copy(alpha = 0.16f),
            pressedContentColor = tint,
        ),
        border = ClickableSurfaceDefaults.border(border = Border.None, focusedBorder = Border.None, pressedBorder = Border.None),
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.08f, pressedScale = 0.92f),
    ) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = description, modifier = Modifier.size(24.dp))
        }
    }
}
