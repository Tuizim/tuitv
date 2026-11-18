package tv.tui.tuitv.ui.screens

import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Text
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.tui.core.ContentKind
import tv.tui.core.Parental
import tv.tui.core.normalizeText
import tv.tui.tuitv.BuildConfig
import tv.tui.tuitv.data.AspectMode
import tv.tui.tuitv.data.ByteSource
import tv.tui.tuitv.data.Limits
import tv.tui.tuitv.data.Settings
import tv.tui.tuitv.ui.Txt
import tv.tui.tuitv.ui.components.ActionButton
import tv.tui.tuitv.ui.components.ErrorText
import tv.tui.tuitv.ui.components.ListRow
import tv.tui.tuitv.ui.components.Muted
import tv.tui.tuitv.ui.components.RequestFocus
import tv.tui.tuitv.ui.components.ScreenTitle
import tv.tui.tuitv.ui.components.SectionTitle
import tv.tui.tuitv.ui.components.TuiDialog
import tv.tui.tuitv.ui.components.TvTextField
import tv.tui.tuitv.ui.library
import tv.tui.tuitv.ui.toaster
import tv.tui.tuitv.ui.tuiApp
import tv.tui.tuitv.ui.theme.TuiColors
import tv.tui.tuitv.ui.device
import tv.tui.tuitv.ui.components.ButtonRow

private fun yesNo(value: Boolean) = if (value) "Sim" else "Não"

/** Próximo valor da lista (OK no controle percorre as opções). */
private fun <T> List<T>.after(current: T): T = this[(indexOf(current) + 1).mod(size)]

private val LANGUAGES = listOf("" to "Automático", "pt" to "Português", "en" to "Inglês", "es" to "Espanhol")
private val REFRESH = listOf(0 to "Desativada", 6 to "A cada 6 h", 12 to "A cada 12 h", 24 to "Diária", 48 to "A cada 2 dias", 168 to "Semanal")
private val TIMEOUTS = listOf(10, 15, 30, 60)
private val ASPECTS = listOf(AspectMode.CONTAIN to "Ajustar à tela", AspectMode.COVER to "Preencher (cortar bordas)", AspectMode.FILL to "Esticar")

private enum class ParentalAction { ENABLE, DISABLE, CHANGE_PIN, GROUPS, HIDE_ADULT }

@Composable
fun SettingsScreen() {
    val library = library()
    val store = library.settingsStore
    val settings by store.settings.collectAsStateWithLifecycle()
    val unlocked by library.unlocked.collectAsStateWithLifecycle()
    val toaster = toaster()
    var pinSetup by remember { mutableStateOf(false) }
    var pinPrompt by remember { mutableStateOf<ParentalAction?>(null) }
    var groupsDialog by remember { mutableStateOf(false) }
    var exporting by remember { mutableStateOf(false) }
    var restoring by remember { mutableStateOf(false) }
    var unlocking by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    val p = settings.parental

    fun update(transform: (Settings) -> Settings) = store.update(transform)

    fun perform(action: ParentalAction) {
        when (action) {
            ParentalAction.ENABLE -> if (p.pinHash == null) pinSetup = true else update { it.copy(parental = it.parental.copy(enabled = true)) }
            ParentalAction.DISABLE -> {
                update { it.copy(parental = it.parental.copy(enabled = false)) }
                toaster.show("Controle parental desativado")
            }
            ParentalAction.CHANGE_PIN -> pinSetup = true
            ParentalAction.GROUPS -> groupsDialog = true
            ParentalAction.HIDE_ADULT -> update { it.copy(parental = it.parental.copy(hideAdult = !it.parental.hideAdult)) }
        }
    }

    /** Com o controle ativo, alterações exigem o PIN (uma vez por sessão). */
    fun guarded(action: ParentalAction) {
        if (p.enabled && !unlocked && p.pinHash != null) pinPrompt = action else perform(action)
    }

    val device = device()
    val side = if (device.tv) 6.dp else device.gutter
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(6.dp), contentPadding = PaddingValues(side, 0.dp, side, 48.dp)) {
        item { ScreenTitle(Txt.SETTINGS, subtitle = if (device.tv) "Pressione OK para alterar cada opção." else "Toque em uma opção para alterá-la.") }

        item { SectionTitle("Reprodução") }
        item {
            ListRow("Reprodução automática", { update { it.copy(autoplay = !it.autoplay) } }, Modifier.focusRequester(focus),
                subtitle = "Inicia ao abrir e segue para o próximo episódio.", trailing = yesNo(settings.autoplay))
        }
        item { ListRow("Reconectar automaticamente", { update { it.copy(autoReconnect = !it.autoReconnect) } }, trailing = yesNo(settings.autoReconnect), subtitle = "Tenta de novo quando a transmissão cai.") }
        item { ListRow("Tempo limite de conexão", { update { it.copy(connectionTimeout = TIMEOUTS.after(it.connectionTimeout.takeIf { t -> t in TIMEOUTS } ?: 15)) } }, trailing = "${settings.connectionTimeout} s") }
        item { ListRow("Proporção da imagem", { update { it.copy(aspect = ASPECTS.map { a -> a.first }.after(it.aspect)) } }, trailing = ASPECTS.first { it.first == settings.aspect }.second) }
        item {
            ListRow("Idioma de áudio preferido", { update { it.copy(audioLanguage = LANGUAGES.map { l -> l.first }.after(it.audioLanguage.takeIf { a -> LANGUAGES.any { l -> l.first == a } } ?: "")) } },
                trailing = LANGUAGES.firstOrNull { it.first == settings.audioLanguage }?.second ?: settings.audioLanguage)
        }
        item { ListRow("Legendas", { update { it.copy(subtitlesEnabled = !it.subtitlesEnabled) } }, trailing = if (settings.subtitlesEnabled) "Ativadas" else "Desativadas") }
        item {
            ListRow("Idioma das legendas", { update { it.copy(subtitleLanguage = LANGUAGES.map { l -> l.first }.after(it.subtitleLanguage.takeIf { a -> LANGUAGES.any { l -> l.first == a } } ?: "")) } },
                trailing = LANGUAGES.firstOrNull { it.first == settings.subtitleLanguage }?.second ?: settings.subtitleLanguage)
        }

        item { SectionTitle("Listas e guias") }
        item {
            ListRow("Atualização automática", { update { it.copy(autoRefreshHours = REFRESH.map { r -> r.first }.after(it.autoRefreshHours.takeIf { h -> REFRESH.any { r -> r.first == h } } ?: 24)) } },
                trailing = REFRESH.firstOrNull { it.first == settings.autoRefreshHours }?.second ?: "${settings.autoRefreshHours} h",
                subtitle = "Baixa de novo listas e guias adicionados por endereço.")
        }
        item {
            ListRow("Permitir endereços da rede local", { update { it.copy(allowPrivateHosts = !it.allowPrivateHosts) } }, trailing = yesNo(settings.allowPrivateHosts),
                subtitle = "Necessário para servidores na sua casa (ex.: 192.168.x.x).")
        }

        item { SectionTitle("Controle parental") }
        item {
            ListRow("Controle parental", { if (p.enabled) guarded(ParentalAction.DISABLE) else perform(ParentalAction.ENABLE) }, trailing = if (p.enabled) "Ativado" else "Desativado",
                subtitle = "Oculta categorias bloqueadas até o PIN ser informado.")
        }
        if (p.enabled) {
            item { ListRow("Ocultar conteúdo adulto", { guarded(ParentalAction.HIDE_ADULT) }, trailing = yesNo(p.hideAdult), subtitle = "Categorias como “Adultos”, “+18” e “XXX”.") }
            item { ListRow("Categorias bloqueadas", { guarded(ParentalAction.GROUPS) }, trailing = Txt.number(p.lockedGroups.size)) }
            item { ListRow("Alterar PIN", { guarded(ParentalAction.CHANGE_PIN) }) }
            item {
                if (unlocked) ListRow("Bloquear agora", { library.lock(); toaster.show("Conteúdo bloqueado") }, subtitle = "A sessão está desbloqueada.")
                else ListRow("Desbloquear nesta sessão", { unlocking = true }, subtitle = "Mostra o conteúdo bloqueado até o aplicativo ser fechado.")
            }
        }

        item { SectionTitle("Backup") }
        item { ListRow("Exportar backup", { exporting = true }, subtitle = "Listas, favoritos, histórico, guias e preferências. Compatível com o TuiTV Web.") }
        item { ListRow("Restaurar backup", { restoring = true }, subtitle = "De um arquivo ou de um endereço (URL).") }

        item { SectionTitle("Sobre") }
        item {
            Column(Modifier.heightIn(min = 40.dp)) {
                Text("TuiTV ${BuildConfig.VERSION_NAME} para Android, Android TV e Fire TV")
                Muted("Sem conta, sem cadastro e sem servidor próprio: listas, favoritos, histórico e preferências ficam apenas neste aparelho. O TuiTV não fornece conteúdo; use somente fontes autorizadas.")
            }
        }
    }
    RequestFocus(focus)

    if (unlocking) {
        PinPromptDialog({ unlocking = false }) {
            unlocking = false
            toaster.show("Conteúdo desbloqueado nesta sessão")
        }
    }
    pinPrompt?.let { action ->
        PinPromptDialog({ pinPrompt = null }) {
            pinPrompt = null
            perform(action)
        }
    }
    if (pinSetup) {
        PinSetupDialog({ pinSetup = false }) { pin ->
            val hashed = Parental.hashPin(pin)
            update { it.copy(parental = it.parental.copy(enabled = true, pinHash = hashed.pinHash, pinSalt = hashed.pinSalt)) }
            pinSetup = false
            toaster.show("PIN definido. Controle parental ativado.")
        }
    }
    if (groupsDialog) LockedGroupsDialog { groupsDialog = false }
    if (exporting) ExportDialog { exporting = false }
    if (restoring) RestoreDialog { restoring = false }
}

/** Pede o PIN para desbloquear a sessão. */
@Composable
fun PinPromptDialog(onDismiss: () -> Unit, onUnlocked: () -> Unit) {
    val library = library()
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }
    fun submit() {
        if (busy) return
        busy = true
        scope.launch {
            val ok = withContext(Dispatchers.Default) { library.unlock(pin) }
            busy = false
            if (ok) onUnlocked() else {
                error = "PIN incorreto."
                pin = ""
            }
        }
    }
    TuiDialog("Informe o PIN", onDismiss) {
        TvTextField(pin, { pin = it.filter(Char::isDigit).take(8) }, "PIN (4 a 8 dígitos)", password = true, keyboardType = KeyboardType.NumberPassword, focusRequester = focus, onDone = ::submit)
        error?.let { ErrorText(it) }
        Muted("Esqueceu o PIN? Ele não pode ser recuperado: limpe os dados do aplicativo nas configurações do aparelho e restaure um backup.")
        ButtonRow {
            ActionButton("Cancelar", onDismiss)
            ActionButton("Desbloquear", ::submit, primary = true, enabled = !busy)
        }
    }
    RequestFocus(focus)
}

@Composable
private fun PinSetupDialog(onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var pin by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    fun submit() {
        error = when {
            !Parental.isValidPin(pin) -> "O PIN deve ter de 4 a 8 dígitos."
            pin != confirm -> "Os PINs não conferem."
            else -> null
        }
        if (error == null) onSave(pin)
    }
    TuiDialog("Definir PIN", onDismiss) {
        TvTextField(pin, { pin = it.filter(Char::isDigit).take(8) }, "Novo PIN", password = true, keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Next, focusRequester = focus)
        TvTextField(confirm, { confirm = it.filter(Char::isDigit).take(8) }, "Repita o PIN", password = true, keyboardType = KeyboardType.NumberPassword, onDone = ::submit)
        error?.let { ErrorText(it) }
        Muted("O PIN fica apenas neste aparelho e nunca é incluído no backup.")
        ButtonRow {
            ActionButton("Cancelar", onDismiss)
            ActionButton("Salvar", ::submit, primary = true)
        }
    }
    RequestFocus(focus)
}

@Composable
private fun LockedGroupsDialog(onDismiss: () -> Unit) {
    val library = library()
    val store = library.settingsStore
    val settings by store.settings.collectAsStateWithLifecycle()
    val groups by remember {
        combine(library.groups(ContentKind.LIVE), library.groups(ContentKind.MOVIE), library.groups(ContentKind.SERIES)) { a, b, c ->
            (a + b + c).map { it.name }.filter { it.isNotEmpty() }.distinctBy(::normalizeText).sortedBy(::normalizeText)
        }
    }.collectAsStateWithLifecycle(null)
    val locked = settings.parental.lockedGroups.toSet()
    TuiDialog("Categorias bloqueadas", onDismiss, width = 640.dp) {
        Muted(if (device().tv) "OK bloqueia ou libera a categoria em todas as listas." else "Toque para bloquear ou liberar a categoria em todas as listas.")
        val list = groups
        if (list == null) Muted(Txt.LOADING)
        else LazyColumn(Modifier.heightIn(max = 380.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            items(list, key = { it }) { name ->
                val norm = normalizeText(name)
                val isLocked = norm in locked
                ListRow(name, {
                    store.update { s ->
                        val next = if (isLocked) s.parental.lockedGroups - norm else s.parental.lockedGroups + norm
                        s.copy(parental = s.parental.copy(lockedGroups = next))
                    }
                }, trailing = if (isLocked) "Bloqueada" else "Liberada")
            }
        }
        ActionButton("Concluir", onDismiss, primary = true)
    }
}

/** Grava o backup em Downloads quando o aparelho não tem seletor de arquivos. */
private fun saveToDownloads(context: Context, name: String, text: String): String {
    val bytes = text.toByteArray(Charsets.UTF_8)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, "application/json")
        }
        val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("sem acesso a Downloads")
        context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
        return "Downloads/$name"
    }
    val dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.filesDir
    val file = File(dir, name)
    file.writeBytes(bytes)
    return file.absolutePath
}

@Composable
private fun ExportDialog(onDismiss: () -> Unit) {
    val app = tuiApp()
    val context = LocalContext.current
    val toaster = toaster()
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var hasCredentials by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    val fileName = remember { "tuitv-backup-" + SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(Date()) + ".json" }
    androidx.compose.runtime.LaunchedEffect(Unit) { hasCredentials = app.backup.hasCredentials() }

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri: Uri? ->
        val text = pending ?: return@rememberLauncherForActivityResult
        if (uri == null) {
            busy = false
            return@rememberLauncherForActivityResult
        }
        scope.launch {
            try {
                withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray(Charsets.UTF_8)) } }
                toaster.show("Backup exportado.")
                onDismiss()
            } catch (e: Exception) {
                error = "Não foi possível gravar o arquivo."
            } finally {
                busy = false
            }
        }
    }

    fun export() {
        busy = true
        error = null
        scope.launch {
            try {
                val text = app.backup.export(password.ifEmpty { null })
                pending = text
                try {
                    launcher.launch(fileName)
                } catch (_: ActivityNotFoundException) {
                    val path = withContext(Dispatchers.IO) { saveToDownloads(context, fileName, text) }
                    toaster.show("Backup salvo em $path", 6000)
                    busy = false
                    onDismiss()
                }
            } catch (e: Exception) {
                error = Txt.UNEXPECTED
                busy = false
            }
        }
    }

    TuiDialog("Exportar backup", { if (!busy) onDismiss() }) {
        TvTextField(password, { password = it }, "Senha (opcional, recomendada)", password = true, focusRequester = focus, onDone = ::export)
        if (hasCredentials && password.isEmpty()) Text("Atenção: suas listas têm usuário e senha no endereço. Sem senha, o arquivo os guarda em texto aberto.", color = TuiColors.Warning)
        Muted("Com senha, o arquivo é cifrado (AES-256-GCM). O PIN parental nunca é exportado.")
        error?.let { ErrorText(it) }
        ButtonRow {
            ActionButton("Cancelar", onDismiss, enabled = !busy)
            ActionButton(if (busy) Txt.LOADING else "Exportar", ::export, primary = true, enabled = !busy)
        }
    }
    RequestFocus(focus)
}

/** Restaura de arquivo (seletor do sistema) ou de endereço — útil em aparelhos sem seletor. */
@Composable
fun RestoreDialog(onDismiss: () -> Unit) {
    val app = tuiApp()
    val toaster = toaster()
    val scope = rememberCoroutineScope()
    var url by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }

    fun restore(open: () -> ByteSource) {
        busy = true
        error = null
        scope.launch {
            try {
                val text = withContext(Dispatchers.IO) {
                    val builder = StringBuilder()
                    tv.tui.tuitv.data.readText(open(), Limits.MAX_BACKUP_BYTES, { _, _ -> }) { builder.append(it) }
                    builder.toString()
                }
                val summary = app.backup.restore(text, password)
                toaster.show("Backup restaurado: ${Txt.plural(summary.playlists, "lista", "listas")}, ${Txt.plural(summary.favorites, "favorito", "favoritos")}.", 5000)
                onDismiss()
            } catch (e: Exception) {
                error = Txt.importError(e)
            } finally {
                busy = false
            }
        }
    }

    val pick = rememberDocumentPicker(arrayOf("application/json", "text/plain", "*/*")) { uri, _ ->
        restore { app.library.net.openUri(uri, Limits.MAX_BACKUP_BYTES) }
    }

    fun fromUrl() = restore {
        val s = app.library.settingsStore.current
        val checked = app.library.net.checkedUrl(url, s.allowPrivateHosts)
        app.library.net.open(checked, s.connectionTimeout, Limits.MAX_BACKUP_BYTES)
    }

    TuiDialog(Txt.RESTORE, { if (!busy) onDismiss() }, width = 680.dp) {
        TvTextField(password, { password = it }, "Senha do backup (se houver)", password = true, imeAction = ImeAction.Next, focusRequester = focus)
        ButtonRow {
            ActionButton("Escolher arquivo", pick, enabled = !busy)
        }
        TvTextField(url, { url = it }, "Ou endereço do arquivo de backup", placeholder = "https://…", keyboardType = KeyboardType.Uri, onDone = ::fromUrl)
        Muted("Os dados são mesclados aos atuais. O controle parental deste aparelho é mantido.")
        if (busy) Text(Txt.LOADING, color = TuiColors.Cyan)
        error?.let { ErrorText(it) }
        ButtonRow {
            ActionButton("Cancelar", onDismiss, enabled = !busy)
            ActionButton("Restaurar do endereço", ::fromUrl, primary = true, enabled = !busy && url.isNotBlank())
        }
    }
    RequestFocus(focus)
}
