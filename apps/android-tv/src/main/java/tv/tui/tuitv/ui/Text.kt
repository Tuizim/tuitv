package tv.tui.tuitv.ui

import java.text.NumberFormat
import java.util.Calendar
import java.util.Locale
import tv.tui.core.Backup
import tv.tui.tuitv.data.ImportError
import tv.tui.tuitv.data.ImportException

/**
 * Textos da interface (pt-BR), centralizados como em apps/web/src/lib/i18n.ts.
 * Mensagens de erro seguem o mesmo vocabulário da Web, sem as restrições exclusivas do navegador.
 */
object Txt {
    const val TAGLINE = "Seu entretenimento em um só lugar."
    const val HOME = "Início"
    const val LIVE = "Ao vivo"
    const val MOVIES = "Filmes"
    const val SERIES = "Séries"
    const val GUIDE = "Guia"
    const val SEARCH = "Busca"
    const val FAVORITES = "Favoritos"
    const val HISTORY = "Histórico"
    const val PLAYLISTS = "Listas"
    const val SETTINGS = "Configurações"
    const val MORE = "Mais"
    const val ALL = "Todos"
    const val NO_GROUP = "Sem categoria"
    const val CONTINUE = "Continuar assistindo"
    const val LOADING = "Carregando…"
    const val ADD_PLAYLIST = "Adicionar lista"
    const val ADD_URL = "Adicionar lista por endereço"
    const val ADD_FILE = "Abrir arquivo de lista"
    const val ADD_EPG_URL = "Adicionar guia por endereço"
    const val ADD_EPG_FILE = "Abrir arquivo de guia"
    const val RESTORE = "Restaurar backup"
    const val WELCOME_TITLE = "Bem-vindo ao TuiTV"
    const val WELCOME_BODY = "Adicione sua lista M3U/M3U8 para começar. Tudo fica salvo apenas neste aparelho: sem conta, sem cadastro e sem login."
    const val NO_FILE_PICKER = "Este aparelho não tem seletor de arquivos. Use um endereço (URL) — por exemplo, de um arquivo que você publicou na sua rede ou na nuvem."
    const val FAVORITE_ADDED = "Adicionado aos favoritos"
    const val FAVORITE_REMOVED = "Removido dos favoritos"
    const val EMPTY_FAVORITES = "Nenhum favorito ainda. Mantenha OK pressionado sobre um canal, filme ou série para favoritar."
    const val EMPTY_HISTORY = "Nada assistido ainda."
    const val EMPTY_GROUP = "Nada nesta categoria."
    const val EMPTY_LIBRARY = "Nenhum conteúdo nas listas ativas."
    const val NO_RESULTS = "Nenhum resultado."
    const val LONG_PRESS_HINT = "Mantenha OK pressionado para favoritar"
    const val TOUCH_LONG_PRESS_HINT = "Toque e segure para favoritar"

    /** Dica de favoritar conforme o aparelho (controle remoto ou toque). */
    fun longPressHint(tv: Boolean) = if (tv) LONG_PRESS_HINT else TOUCH_LONG_PRESS_HINT

    fun emptyFavorites(tv: Boolean) =
        if (tv) EMPTY_FAVORITES else "Nenhum favorito ainda. Toque e segure um canal, filme ou série para favoritar."
    const val UNEXPECTED = "Ocorreu um erro inesperado."

    fun importError(e: Throwable): String {
        if (e is Backup.BackupException) return backupError(e.code)
        if (e !is ImportException) return UNEXPECTED
        return when (e.error) {
            ImportError.URL_EMPTY -> "Informe o endereço."
            ImportError.URL_MALFORMED -> "O endereço não é válido. Use um endereço completo, começando com http:// ou https://."
            ImportError.URL_SCHEME -> "Apenas endereços http:// e https:// são aceitos."
            ImportError.LOGIN_MISSING -> "Informe o host, o usuário e a senha."
            ImportError.LOGIN_INVALID -> "O servidor recusou o usuário ou a senha."
            ImportError.ACCOUNT_INACTIVE -> "A conta não está ativa no servidor (${e.detail ?: "?"})."
            ImportError.URL_PRIVATE -> "Este endereço aponta para a rede local ou interna. Para usá-lo, ative “Permitir endereços da rede local” nas Configurações."
            ImportError.OFFLINE -> "Sem conexão com a internet. A biblioteca já importada continua disponível."
            ImportError.NETWORK -> when (e.detail) {
                "dns" -> "Servidor não encontrado. Confira o endereço."
                "tls" -> "Não foi possível estabelecer uma conexão segura com o servidor."
                else -> "Não foi possível baixar este endereço. O servidor pode estar fora do ar."
            }
            ImportError.TIMEOUT -> "O servidor demorou demais para responder. Tente novamente ou aumente o tempo limite nas Configurações."
            ImportError.HTTP -> "O servidor respondeu com erro (HTTP ${e.detail ?: "?"})."
            ImportError.TOO_LARGE -> "O conteúdo excede o tamanho máximo de importação."
            ImportError.NOT_M3U -> "O conteúdo não é uma lista M3U/M3U8 válida."
            ImportError.HLS_MANIFEST -> "Este endereço é uma transmissão única (manifesto HLS), não uma lista de canais."
            ImportError.EMPTY -> "Nenhum conteúdo válido foi encontrado."
            ImportError.NOT_XMLTV -> "O conteúdo não é um guia XMLTV válido."
            ImportError.NOT_BACKUP -> "O arquivo não é um backup do TuiTV."
            ImportError.STORAGE -> "Não foi possível gravar os dados neste aparelho. O armazenamento pode estar cheio."
            ImportError.FILE -> "Não foi possível ler o arquivo."
        }
    }

    fun backupError(code: String): String = when (code) {
        "not-json", "not-tuitv" -> "O arquivo não é um backup do TuiTV."
        "newer-version" -> "Este backup foi criado por uma versão mais nova do TuiTV. Atualize o aplicativo."
        "password-required" -> "Este backup é protegido por senha. Informe a senha."
        "wrong-password" -> "Senha incorreta."
        else -> "O arquivo de backup está corrompido ou incompleto."
    }

    private val numbers: NumberFormat = NumberFormat.getIntegerInstance(Locale.forLanguageTag("pt-BR"))
    fun number(n: Number): String = numbers.format(n)

    fun plural(n: Int, one: String, many: String) = "${number(n)} ${if (n == 1) one else many}"

    fun clock(seconds: Long): String {
        if (seconds < 0) return "0:00"
        val h = seconds / 3600
        val m = (seconds % 3600) / 60
        val s = (seconds % 60).toString().padStart(2, '0')
        return if (h > 0) "$h:${m.toString().padStart(2, '0')}:$s" else "$m:$s"
    }

    fun duration(seconds: Int): String {
        val minutes = Math.round(seconds / 60.0).toInt()
        return if (minutes < 60) "$minutes min" else "${minutes / 60} h ${minutes % 60} min"
    }

    /** Hora local "HH:MM". */
    fun time(ms: Long): String {
        val c = Calendar.getInstance().apply { timeInMillis = ms }
        return "%02d:%02d".format(c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE))
    }

    /** Data local "DD/MM/AAAA". */
    fun date(ms: Long): String {
        val c = Calendar.getInstance().apply { timeInMillis = ms }
        return "%02d/%02d/%04d".format(c.get(Calendar.DAY_OF_MONTH), c.get(Calendar.MONTH) + 1, c.get(Calendar.YEAR))
    }

    /** Resultado de adicionar/atualizar uma lista: itens importados ou, num login, categorias do servidor. */
    fun playlistResult(p: tv.tui.tuitv.data.Playlist): String =
        if (p.remote) "${p.name}: conectado, ${plural(p.live + p.movie + p.series, "categoria", "categorias")}"
        else "${p.name}: ${plural(p.itemCount, "item importado", "itens importados")}"

    fun ago(ms: Long, now: Long = System.currentTimeMillis()): String {
        if (ms <= 0) return "nunca"
        val minutes = (now - ms) / 60_000
        return when {
            minutes < 1 -> "agora"
            minutes < 60 -> "há $minutes min"
            minutes < 48 * 60 -> "há ${minutes / 60} h"
            else -> "há ${minutes / 1440} dias"
        }
    }

    fun episodeLabel(season: Int, episode: Int): String =
        if (season > 0) "T$season · E${episode.toString().padStart(2, '0')}" else "E${episode.toString().padStart(2, '0')}"
}
