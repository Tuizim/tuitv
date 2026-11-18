package tv.tui.tuitv.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.BoxWithConstraints
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
import coil3.compose.SubcomposeAsyncImage
import kotlinx.coroutines.delay
import tv.tui.tuitv.ui.theme.TuiColors

private val CardShape = RoundedCornerShape(10.dp)
private val RowShape = RoundedCornerShape(10.dp)
private val PillShape = RoundedCornerShape(50)

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
    val dim by animateFloatAsState(if (focused || !dimUnfocused) 0f else 0.28f, tween(180), label = "dim")
    Surface(
        onClick = onClick,
        onLongClick = onLongClick,
        modifier = modifier,
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
        scale = ClickableSurfaceDefaults.scale(focusedScale = focusedScale),
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
    Button(
        onClick = onClick,
        modifier = modifier.height(ButtonHeight).widthIn(min = ButtonMinWidth),
        enabled = enabled,
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
        scale = ButtonDefaults.scale(focusedScale = 1.06f, focusedDisabledScale = 1.02f),
        glow = ButtonDefaults.glow(focusedGlow = Glow(TuiColors.White.copy(alpha = 0.25f), 10.dp)),
        contentPadding = PaddingValues(horizontal = 22.dp),
    ) {
        Row(Modifier.fillMaxHeight(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
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
        Text(text, style = MaterialTheme.typography.headlineMedium, color = TuiColors.White)
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
    val titleColor by animateColorAsState(if (focused) TuiColors.White else TuiColors.Muted, tween(180), label = "title")
    Column(modifier) {
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
            modifier = Modifier.padding(top = 10.dp),
        )
        if (caption != null) Muted(caption, maxLines = 1)
    }
}

/** Cartão de canal (logotipo + nome) para fileiras horizontais. */
@Composable
fun ChannelCard(name: String, logo: String?, onClick: () -> Unit, modifier: Modifier = Modifier, onLongClick: (() -> Unit)? = null, caption: String? = null, progress: Float? = null) {
    MediaCard(name, onClick, modifier.width(208.dp), 117.dp, onLongClick, caption, progress, titleLines = 1) {
        RemoteImage(logo, name, Modifier.fillMaxSize().padding(16.dp))
    }
}

/** Cartão de capa 2:3 para filmes e séries; [fill] ocupa a largura da célula (grades). */
@Composable
fun PosterCard(title: String, image: String?, onClick: () -> Unit, modifier: Modifier = Modifier, onLongClick: (() -> Unit)? = null, caption: String? = null, progress: Float? = null, fill: Boolean = false) {
    BoxWithConstraints(if (fill) modifier.fillMaxWidth() else modifier.width(144.dp)) {
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
        modifier = modifier.fillMaxWidth().onFocusChanged { if (it.isFocused) onFocus?.invoke() },
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
        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.02f),
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
            modifier = Modifier.width(width),
            shape = RoundedCornerShape(16.dp),
            colors = SurfaceDefaults.colors(containerColor = TuiColors.Navy, contentColor = TuiColors.White),
        ) {
            // Rolável: na TV (540dp de altura) formulários maiores não cabem inteiros; o foco rola até o campo.
            Column(Modifier.verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
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
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ActionButton("Cancelar", onDismiss, Modifier.focusRequester(focus))
            ActionButton(confirm, onConfirm, primary = true)
        }
    }
    RequestFocus(focus)
}

/** Pede foco assim que o elemento é composto (ignora se ele ainda não estiver na tela). */
@Composable
fun RequestFocus(requester: FocusRequester, key: Any? = Unit, onFocused: () -> Unit = {}) {
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
