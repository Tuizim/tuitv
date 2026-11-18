package tv.tui.tuitv.ui.screens

import android.content.ActivityNotFoundException
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.map
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.SurfaceDefaults
import androidx.tv.material3.Text
import kotlinx.coroutines.launch
import tv.tui.core.maskUrl
import tv.tui.tuitv.data.EpgSource
import tv.tui.tuitv.data.ImportJob
import tv.tui.tuitv.data.Playlist
import tv.tui.tuitv.ui.Brand
import tv.tui.tuitv.ui.Route
import tv.tui.tuitv.ui.Txt
import tv.tui.tuitv.ui.components.ActionButton
import tv.tui.tuitv.ui.components.ConfirmDialog
import tv.tui.tuitv.ui.components.ErrorText
import tv.tui.tuitv.ui.components.Muted
import tv.tui.tuitv.ui.components.RequestFocus
import tv.tui.tuitv.ui.components.ScreenTitle
import tv.tui.tuitv.ui.components.SectionTitle
import tv.tui.tuitv.ui.components.TuiDialog
import tv.tui.tuitv.ui.components.TvTextField
import tv.tui.tuitv.ui.library
import tv.tui.tuitv.ui.navigator
import tv.tui.tuitv.ui.theme.TuiColors
import tv.tui.tuitv.ui.toaster

/** Seletor de documentos do sistema. Aparelhos sem seletor (como o Fire TV) recebem um aviso. */
@Composable
fun rememberDocumentPicker(mimeTypes: Array<String> = arrayOf("*/*"), onPicked: (Uri, String) -> Unit): () -> Unit {
    val context = LocalContext.current
    val toaster = toaster()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) onPicked(uri, displayName(context, uri))
    }
    return {
        try {
            launcher.launch(mimeTypes)
        } catch (_: ActivityNotFoundException) {
            toaster.show(Txt.NO_FILE_PICKER, 6000)
        }
    }
}

fun displayName(context: android.content.Context, uri: Uri): String = try {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
    }
} catch (_: Exception) {
    null
} ?: uri.lastPathSegment?.substringAfterLast('/') ?: "arquivo"

enum class SourceKind { PLAYLIST, EPG }

enum class PlaylistMode { LINK, LOGIN }

/** Campos de origem de uma lista: link M3U ou login (host, usuário e senha). */
@Composable
private fun PlaylistSourceFields(
    mode: PlaylistMode,
    url: String,
    onUrl: (String) -> Unit,
    host: String,
    onHost: (String) -> Unit,
    user: String,
    onUser: (String) -> Unit,
    pass: String,
    onPass: (String) -> Unit,
    focus: FocusRequester,
    onDone: () -> Unit,
) {
    var showPass by remember { mutableStateOf(false) }
    if (mode == PlaylistMode.LINK) {
        TvTextField(url, onUrl, "Link da lista (M3U/M3U8)", placeholder = "http://…", keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next, focusRequester = focus)
    } else {
        TvTextField(host, onHost, "Host (servidor)", placeholder = "http://servidor.com:8080", keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next, focusRequester = focus)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Bottom) {
            TvTextField(user, onUser, "Usuário", Modifier.weight(1f), imeAction = ImeAction.Next)
            TvTextField(pass, onPass, "Senha", Modifier.weight(1f), password = !showPass, keyboardType = KeyboardType.Password, onDone = onDone)
            ActionButton(if (showPass) "Ocultar" else "Mostrar", { showPass = !showPass })
        }
    }
}

@Composable
private fun ModeSelector(mode: PlaylistMode, enabled: Boolean, onMode: (PlaylistMode) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        ActionButton("Link M3U", { onMode(PlaylistMode.LINK) }, primary = mode == PlaylistMode.LINK, enabled = enabled)
        ActionButton("Login (host, usuário e senha)", { onMode(PlaylistMode.LOGIN) }, primary = mode == PlaylistMode.LOGIN, enabled = enabled)
    }
}

@Composable
private fun ImportStatus(busy: Boolean, error: String?) {
    val jobs by library().jobs.collectAsStateWithLifecycle()
    val running = jobs.lastOrNull { it.running }
    if (busy) Text(running?.progress?.let { "Importando… ${Txt.number(it.count)} itens" } ?: "Conectando…", color = TuiColors.Cyan)
    error?.let { ErrorText(it) }
}

/**
 * Adição de lista (por link M3U ou por login Xtream: host, usuário e senha) ou de guia XMLTV por endereço,
 * com o erro explicado no próprio diálogo.
 */
@Composable
fun AddUrlDialog(kind: SourceKind, onDismiss: () -> Unit, onAdded: () -> Unit = {}) {
    val library = library()
    val toaster = toaster()
    val scope = rememberCoroutineScope()
    var mode by remember { mutableStateOf(PlaylistMode.LINK) }
    var name by remember { mutableStateOf("") }
    var url by remember { mutableStateOf("") }
    var host by remember { mutableStateOf("") }
    var user by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    val isPlaylist = kind == SourceKind.PLAYLIST

    fun submit() {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                if (isPlaylist) {
                    val p = if (mode == PlaylistMode.LOGIN) library.addPlaylistLogin(name, host, user, pass) else library.addPlaylistUrl(name, url)
                    toaster.show(Txt.playlistResult(p))
                } else {
                    val e = library.addEpgUrl(name, url)
                    toaster.show("${e.name}: ${Txt.plural(e.programmeCount, "programa", "programas")}")
                }
                onAdded()
                onDismiss()
            } catch (e: Exception) {
                error = Txt.importError(e)
            } finally {
                busy = false
            }
        }
    }

    TuiDialog(if (isPlaylist) Txt.ADD_PLAYLIST else Txt.ADD_EPG_URL, { if (!busy) onDismiss() }, width = 720.dp) {
        if (isPlaylist) {
            ModeSelector(mode, !busy) {
                mode = it
                error = null
            }
            PlaylistSourceFields(mode, url, { url = it }, host, { host = it }, user, { user = it }, pass, { pass = it }, focus, ::submit)
        } else {
            TvTextField(url, { url = it }, "Endereço do guia (XMLTV, .xml ou .xml.gz)", placeholder = "http://…", keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next, focusRequester = focus)
        }
        TvTextField(name, { name = it }, "Nome (opcional)", onDone = ::submit)
        Muted(
            if (isPlaylist && mode == PlaylistMode.LOGIN) "Dados enviados pelo seu provedor. Ficam cifrados neste aparelho; o guia do mesmo login entra automaticamente."
            else "Use somente fontes que você tem autorização para acessar. O endereço fica cifrado neste aparelho.",
        )
        ImportStatus(busy, error)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ActionButton("Cancelar", onDismiss, enabled = !busy)
            ActionButton("Adicionar", ::submit, primary = true, enabled = !busy)
        }
    }
    RequestFocus(focus, mode)
}

/** Troca o link ou o login de uma lista existente (ex.: senha nova do provedor) e baixa de novo. */
@Composable
fun EditPlaylistSourceDialog(playlist: Playlist, onDismiss: () -> Unit) {
    val library = library()
    val toaster = toaster()
    val scope = rememberCoroutineScope()
    val login = playlist.login
    var mode by remember { mutableStateOf(if (login != null) PlaylistMode.LOGIN else PlaylistMode.LINK) }
    var url by remember { mutableStateOf(playlist.url ?: "") }
    var host by remember { mutableStateOf(login?.host ?: "") }
    var user by remember { mutableStateOf(login?.username ?: "") }
    var pass by remember { mutableStateOf(login?.password ?: "") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }

    fun submit() {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                val updated = if (mode == PlaylistMode.LOGIN) library.changePlaylistSource(playlist.id, login = Triple(host, user, pass))
                else library.changePlaylistSource(playlist.id, url = url)
                toaster.show(Txt.playlistResult(updated))
                onDismiss()
            } catch (e: Exception) {
                error = Txt.importError(e)
            } finally {
                busy = false
            }
        }
    }

    TuiDialog("Editar “${playlist.name}”", { if (!busy) onDismiss() }, width = 720.dp) {
        ModeSelector(mode, !busy) {
            mode = it
            error = null
        }
        PlaylistSourceFields(mode, url, { url = it }, host, { host = it }, user, { user = it }, pass, { pass = it }, focus, ::submit)
        Muted("A lista é baixada de novo; favoritos e histórico são mantidos.")
        ImportStatus(busy, error)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ActionButton("Cancelar", onDismiss, enabled = !busy)
            ActionButton("Salvar e atualizar", ::submit, primary = true, enabled = !busy)
        }
    }
    RequestFocus(focus, mode)
}

/** Importação de arquivo escolhido no seletor; o progresso aparece no canto da tela. */
@Composable
fun rememberFileImport(kind: SourceKind, onError: (String) -> Unit): () -> Unit {
    val library = library()
    val toaster = toaster()
    val scope = rememberCoroutineScope()
    return rememberDocumentPicker { uri, fileName ->
        scope.launch {
            try {
                if (kind == SourceKind.PLAYLIST) {
                    val p = library.addPlaylistFile(uri, fileName, "")
                    toaster.show("${p.name}: ${Txt.plural(p.itemCount, "item importado", "itens importados")}")
                } else {
                    val e = library.addEpgFile(uri, fileName, "")
                    toaster.show("${e.name}: ${Txt.plural(e.programmeCount, "programa", "programas")}")
                }
            } catch (e: Exception) {
                onError(Txt.importError(e))
            }
        }
    }
}

@Composable
fun MessageDialog(title: String, message: String, onDismiss: () -> Unit) {
    val focus = remember { FocusRequester() }
    TuiDialog(title, onDismiss) {
        Text(message, style = MaterialTheme.typography.bodyLarge)
        ActionButton("OK", onDismiss, Modifier.focusRequester(focus), primary = true)
    }
    RequestFocus(focus)
}

@Composable
fun WelcomeScreen() {
    val navigator = navigator()
    var adding by remember { mutableStateOf(false) }
    var restoring by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val pickFile = rememberFileImport(SourceKind.PLAYLIST) { error = it }
    val focus = remember { FocusRequester() }
    Column(Modifier.fillMaxSize().padding(64.dp), verticalArrangement = Arrangement.Center) {
        Brand(big = true)
        Spacer(Modifier.height(24.dp))
        Text(Txt.WELCOME_TITLE, style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text(Txt.WELCOME_BODY, style = MaterialTheme.typography.bodyLarge, color = TuiColors.Muted, modifier = Modifier.width(720.dp))
        Spacer(Modifier.height(32.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            ActionButton(Txt.ADD_PLAYLIST, { adding = true }, Modifier.focusRequester(focus), Icons.Filled.Add, primary = true)
            ActionButton(Txt.ADD_FILE, pickFile)
            ActionButton(Txt.RESTORE, { restoring = true })
            ActionButton(Txt.SETTINGS, { navigator.open(Route.Settings) }, icon = Icons.Filled.Settings)
        }
    }
    RequestFocus(focus)
    if (adding) AddUrlDialog(SourceKind.PLAYLIST, { adding = false }) { navigator.open(Route.Home) }
    if (restoring) RestoreDialog { restoring = false }
    error?.let { MessageDialog("Não foi possível importar", it) { error = null } }
}

@Composable
fun PlaylistsScreen() {
    val library = library()
    val playlists by library.playlists.collectAsStateWithLifecycle()
    val sources by library.epgSources.collectAsStateWithLifecycle()
    val jobs by library.jobs.collectAsStateWithLifecycle()
    var adding by remember { mutableStateOf<SourceKind?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val pickPlaylist = rememberFileImport(SourceKind.PLAYLIST) { error = it }
    val pickEpg = rememberFileImport(SourceKind.EPG) { error = it }
    val focus = remember { FocusRequester() }

    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(6.dp, 0.dp, 6.dp, 48.dp)) {
        item(key = "header") {
            Column {
                ScreenTitle(Txt.PLAYLISTS, subtitle = "Listas M3U/M3U8 e guias de programação XMLTV. Tudo fica salvo somente neste aparelho.")
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    ActionButton(Txt.ADD_PLAYLIST, { adding = SourceKind.PLAYLIST }, Modifier.focusRequester(focus), Icons.Filled.Add, primary = true)
                    ActionButton("Lista de arquivo", pickPlaylist)
                    ActionButton("Guia por endereço", { adding = SourceKind.EPG }, icon = Icons.Filled.Add)
                    ActionButton("Guia de arquivo", pickEpg)
                }
            }
        }
        val failed = jobs.filter { it.error != null }
        items(failed, key = { "job:" + it.id }) { job -> FailedJob(job) }
        item(key = "lists") { SectionTitle("Listas (${playlists?.size ?: 0})") }
        items(playlists ?: emptyList(), key = { "p:" + it.id }) { PlaylistCard(it) }
        item(key = "guides") {
            Column {
                SectionTitle("Guias de programação (${sources.size})")
                if (sources.isEmpty()) Muted("Listas que anunciam um guia (url-tvg) o adicionam automaticamente.")
            }
        }
        items(sources, key = { "e:" + it.id }) { EpgCard(it) }
    }
    RequestFocus(focus)
    adding?.let { AddUrlDialog(it, { adding = null }) }
    error?.let { MessageDialog("Não foi possível importar", it) { error = null } }
}

@Composable
private fun Panel(content: @Composable () -> Unit) {
    Surface(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = SurfaceDefaults.colors(containerColor = TuiColors.NavyRaised, contentColor = TuiColors.White),
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
    }
}

@Composable
private fun FailedJob(job: ImportJob) {
    val library = library()
    Panel {
        Text("Falha ao importar ${job.name}", style = MaterialTheme.typography.titleMedium, color = TuiColors.Danger)
        Text(Txt.importError(job.error!!), style = MaterialTheme.typography.bodyMedium)
        ActionButton("Dispensar", { library.dismissJob(job.id) })
    }
}

@Composable
private fun PlaylistCard(p: Playlist) {
    val library = library()
    val toaster = toaster()
    val scope = rememberCoroutineScope()
    var renaming by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val remoteError by remember(p.id) { library.remoteErrors.map { it[p.id] } }.collectAsStateWithLifecycle(null)
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(p.name, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            if (!p.active) Text("desativada", color = TuiColors.Warning)
        }
        if (p.remote) {
            // Login sob demanda: categorias do servidor e vencimento da conta, sem contagem de itens.
            Muted(
                listOfNotNull(
                    Txt.plural(p.live, "categoria de canais", "categorias de canais"),
                    Txt.plural(p.movie, "de filmes", "de filmes"),
                    Txt.plural(p.series, "de séries", "de séries"),
                    p.expiresAt.takeIf { it > 0 }?.let { "vence em ${Txt.date(it)}" },
                ).joinToString(" · "),
            )
            Muted("Consultada no servidor sob demanda: nada do catálogo fica guardado no aparelho.")
            remoteError?.let { Text(Txt.importError(it), color = TuiColors.Warning) }
        } else {
            Muted(
                listOf(
                    Txt.plural(p.itemCount, "item", "itens"),
                    Txt.plural(p.live, "canal", "canais"),
                    Txt.plural(p.movie, "filme", "filmes"),
                    Txt.plural(p.series, "episódio", "episódios"),
                    "atualizada ${Txt.ago(p.updatedAt)}",
                ).joinToString(" · "),
            )
        }
        val login = p.login
        Muted(
            when {
                p.isFile -> "Arquivo: ${p.fileName ?: "—"}"
                login != null -> "Login: ${login.username} em ${login.host}"
                else -> p.url?.let(::maskUrl) ?: "Endereço indisponível"
            },
            maxLines = 1,
        )
        if (p.skipped > 0) Muted("${Txt.plural(p.skipped, "registro ignorado", "registros ignorados")} por estar incompleto ou inválido.")
        if (p.failedAt > p.updatedAt) Text("A última atualização automática falhou (${Txt.ago(p.failedAt)}).", color = TuiColors.Warning)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (!p.isFile) {
                ActionButton("Atualizar", {
                    scope.launch {
                        try {
                            val updated = library.refreshPlaylist(p.id)
                            toaster.show(Txt.playlistResult(updated))
                        } catch (e: Exception) {
                            error = Txt.importError(e)
                        }
                    }
                }, icon = Icons.Filled.Refresh)
            }
            ActionButton(if (p.active) "Desativar" else "Ativar", { library.updatePlaylist(p.id, active = !p.active) })
            if (!p.isFile) ActionButton(if (login != null) "Editar login" else "Editar link", { editing = true }, icon = Icons.Filled.Edit)
            ActionButton("Renomear", { renaming = true })
            ActionButton("Remover", { deleting = true }, icon = Icons.Filled.Delete)
        }
    }
    if (editing) EditPlaylistSourceDialog(p) { editing = false }
    if (renaming) RenameDialog(p.name, { renaming = false }) { library.updatePlaylist(p.id, name = it) }
    if (deleting) {
        ConfirmDialog("Remover lista", "“${p.name}” e seus favoritos e histórico serão removidos deste aparelho.", "Remover", {
            deleting = false
            scope.launch { library.deletePlaylist(p.id) }
        }, { deleting = false })
    }
    error?.let { MessageDialog("Não foi possível atualizar", it) { error = null } }
}

@Composable
private fun EpgCard(source: EpgSource) {
    val library = library()
    val toaster = toaster()
    val scope = rememberCoroutineScope()
    var deleting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Panel {
        Text(source.name, style = MaterialTheme.typography.titleLarge)
        Muted(
            listOf(
                Txt.plural(source.channelCount, "canal", "canais"),
                Txt.plural(source.programmeCount, "programa", "programas"),
                "atualizado ${Txt.ago(source.updatedAt)}",
            ).joinToString(" · "),
        )
        Muted(if (source.isFile) "Arquivo: ${source.fileName ?: "—"}" else source.url?.let(::maskUrl) ?: "—", maxLines = 1)
        if (source.failedAt > source.updatedAt) Text("A última atualização falhou (${Txt.ago(source.failedAt)}).", color = TuiColors.Warning)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (!source.isFile) {
                ActionButton("Atualizar", {
                    scope.launch {
                        try {
                            val updated = library.refreshEpg(source.id)
                            toaster.show("${updated.name}: ${Txt.plural(updated.programmeCount, "programa", "programas")}")
                        } catch (e: Exception) {
                            error = Txt.importError(e)
                        }
                    }
                }, icon = Icons.Filled.Refresh)
            }
            ActionButton("Remover", { deleting = true }, icon = Icons.Filled.Delete)
        }
    }
    if (deleting) {
        ConfirmDialog("Remover guia", "A programação de “${source.name}” será apagada deste aparelho.", "Remover", {
            deleting = false
            scope.launch { library.deleteEpg(source.id) }
        }, { deleting = false })
    }
    error?.let { MessageDialog("Não foi possível atualizar", it) { error = null } }
}

@Composable
private fun RenameDialog(current: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var name by remember { mutableStateOf(current) }
    val focus = remember { FocusRequester() }
    fun save() {
        onSave(name)
        onDismiss()
    }
    TuiDialog("Renomear lista", onDismiss) {
        TvTextField(name, { name = it }, "Nome", focusRequester = focus, onDone = ::save)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            ActionButton("Cancelar", onDismiss)
            ActionButton("Salvar", ::save, primary = true)
        }
    }
    RequestFocus(focus)
}
