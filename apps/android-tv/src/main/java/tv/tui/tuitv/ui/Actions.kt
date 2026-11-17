package tv.tui.tuitv.ui

import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.launch
import tv.tui.core.ContentKind
import tv.tui.core.MediaItem
import tv.tui.tuitv.TuiApp
import tv.tui.tuitv.data.Library

private tailrec fun Context.app(): TuiApp = when (this) {
    is TuiApp -> this
    is ContextWrapper -> (applicationContext as? TuiApp) ?: baseContext.app()
    else -> applicationContext as TuiApp
}

@Composable
fun tuiApp(): TuiApp = LocalContext.current.app()

@Composable
fun library(): Library = tuiApp().library

/** Alterna o favorito e avisa o resultado. */
@Composable
fun rememberFavoriteToggle(): (id: String, kind: ContentKind, playlistId: String) -> Unit {
    val library = library()
    val toaster = toaster()
    val scope = rememberCoroutineScope()
    return { id, kind, playlistId ->
        scope.launch {
            val now = library.toggleFavorite(id, kind, playlistId)
            toaster.show(if (now) Txt.FAVORITE_ADDED else Txt.FAVORITE_REMOVED)
        }
    }
}

/** Abre o player para [item] dentro de [queue] (troca de canal / próximo episódio). */
fun Navigator.play(queue: List<MediaItem>, item: MediaItem, resumeAt: Long? = null) {
    val index = queue.indexOfFirst { it.id == item.id }
    if (index >= 0) open(Route.Player(queue, index, resumeAt)) else open(Route.Player(listOf(item), 0, resumeAt))
}
