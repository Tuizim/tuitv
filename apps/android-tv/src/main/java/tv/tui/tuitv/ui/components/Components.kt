package tv.tui.tuitv.ui.components

import androidx.compose.foundation.BorderStroke
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

/** Superfície focável padrão: fundo elevado, borda ciano e leve aumento no foco. */
@Composable
fun TuiSurface(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    onLongClick: (() -> Unit)? = null,
    selected: Boolean = false,
    shape: androidx.compose.ui.graphics.Shape = CardShape,
    focusedScale: Float = 1.04f,
    container: Color = TuiColors.NavyRaised,
    content: @Composable BoxScope.() -> Unit,
) {
    Surface(
        onClick = onClick,
        onLongClick = onLongClick,
        modifier = modifier,
        shape = ClickableSurfaceDefaults.shape(shape),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = if (selected) TuiColors.Line else container,
            contentColor = TuiColors.White,
            focusedContainerColor = TuiColors.Focus,
            focusedContentColor = TuiColors.White,
            pressedContainerColor = TuiColors.Focus,
            pressedContentColor = TuiColors.White,
        ),
        border = ClickableSurfaceDefaults.border(
            border = if (selected) Border(BorderStroke(2.dp, TuiColors.Cyan.copy(alpha = 0.5f)), shape = shape) else Border.None,
            focusedBorder = Border(BorderStroke(3.dp, TuiColors.Cyan), shape = shape),
        ),
        scale = ClickableSurfaceDefaults.scale(focusedScale = focusedScale),
        content = content,
    )
}

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
        modifier = modifier,
        enabled = enabled,
        colors = ButtonDefaults.colors(
            // Botões secundários em tom mais claro: visíveis também sobre painéis elevados.
            containerColor = if (primary) TuiColors.Cyan else TuiColors.Line,
            contentColor = if (primary) TuiColors.Navy else TuiColors.White,
            focusedContainerColor = TuiColors.White,
            focusedContentColor = TuiColors.Navy,
        ),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 10.dp),
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, style = MaterialTheme.typography.titleSmall)
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
fun ProgressLine(fraction: Float, modifier: Modifier = Modifier, height: Dp = 4.dp, color: Color = TuiColors.Cyan) {
    Box(modifier.fillMaxWidth().height(height).clip(RoundedCornerShape(height)).background(TuiColors.Line)) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(fraction.coerceIn(0f, 1f)).background(color))
    }
}

/** Cartão de canal (logotipo + nome) para fileiras horizontais. */
@Composable
fun ChannelCard(name: String, logo: String?, onClick: () -> Unit, modifier: Modifier = Modifier, onLongClick: (() -> Unit)? = null, caption: String? = null, progress: Float? = null) {
    Column(modifier.width(200.dp)) {
        TuiSurface(onClick = onClick, onLongClick = onLongClick, modifier = Modifier.fillMaxWidth().height(112.dp)) {
            RemoteImage(logo, name, Modifier.fillMaxSize().padding(14.dp))
            if (progress != null) ProgressLine(progress, Modifier.align(Alignment.BottomCenter))
        }
        Text(name, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
        if (caption != null) Muted(caption, maxLines = 1)
    }
}

/** Cartão de capa 2:3 para filmes e séries. */
@Composable
fun PosterCard(title: String, image: String?, onClick: () -> Unit, modifier: Modifier = Modifier, onLongClick: (() -> Unit)? = null, caption: String? = null, progress: Float? = null) {
    Column(modifier.width(140.dp)) {
        TuiSurface(onClick = onClick, onLongClick = onLongClick, modifier = Modifier.fillMaxWidth().height(210.dp)) {
            RemoteImage(image, title, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            if (progress != null) ProgressLine(progress, Modifier.align(Alignment.BottomCenter))
        }
        Text(title, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
        if (caption != null) Muted(caption, maxLines = 1)
    }
}

/** Linha focável de lista (categorias, canais, configurações). */
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
    TuiSurface(
        onClick = onClick,
        onLongClick = onLongClick,
        selected = selected,
        focusedScale = 1.02f,
        modifier = modifier.fillMaxWidth().onFocusChanged { if (it.isFocused) onFocus?.invoke() },
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            if (leading != null) {
                leading()
                Spacer(Modifier.width(12.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (subtitle != null) Muted(subtitle, maxLines = 1)
                if (progress != null) ProgressLine(progress, Modifier.padding(top = 6.dp), height = 3.dp)
            }
            if (trailing != null) {
                Spacer(Modifier.width(12.dp))
                Text(trailing, style = MaterialTheme.typography.bodyMedium, color = TuiColors.Muted, maxLines = 1)
            }
        }
    }
}

/** Campo de texto para TV: OK abre o teclado do sistema; borda ciano no foco. */
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
    Column(modifier) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = TuiColors.Muted, modifier = Modifier.padding(bottom = 6.dp))
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
                .let { if (focusRequester != null) it.focusRequester(focusRequester) else it }
                .onFocusChanged { focused = it.isFocused }
                .clip(RoundedCornerShape(8.dp))
                .background(if (focused) TuiColors.Focus else TuiColors.NavyRaised)
                .border(if (focused) 3.dp else 1.dp, if (focused) TuiColors.Cyan else TuiColors.Line, RoundedCornerShape(8.dp))
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
            border = Border(BorderStroke(1.dp, TuiColors.Line), shape = RoundedCornerShape(16.dp)),
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
fun RequestFocus(requester: FocusRequester, key: Any? = Unit) {
    LaunchedEffect(key) {
        repeat(5) {
            if (runCatching { requester.requestFocus() }.getOrDefault(false)) return@LaunchedEffect
            delay(60)
        }
    }
}

/** Mensagem de erro em destaque. */
@Composable
fun ErrorText(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = TuiColors.Danger, modifier = modifier)
}
