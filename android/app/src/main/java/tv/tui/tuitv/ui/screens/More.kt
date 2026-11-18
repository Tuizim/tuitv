package tv.tui.tuitv.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Icon
import tv.tui.tuitv.ui.Route
import tv.tui.tuitv.ui.Txt
import tv.tui.tuitv.ui.components.ListRow
import tv.tui.tuitv.ui.components.ScreenTitle
import tv.tui.tuitv.ui.device
import tv.tui.tuitv.ui.library
import tv.tui.tuitv.ui.moreDestinations
import tv.tui.tuitv.ui.navigator

/**
 * Aba "Mais" (celular e tablet): o que não cabe na barra inferior, como o "Minha Netflix".
 * Cada item empilha a tela, então Voltar retorna para cá.
 */
@Composable
fun MoreScreen() {
    val navigator = navigator()
    val library = library()
    val favorites by library.favorites.collectAsStateWithLifecycle(emptyList())
    val history by library.history.collectAsStateWithLifecycle(emptyList())
    val playlists by library.playlists.collectAsStateWithLifecycle()
    val gutter = device().gutter
    LazyColumn(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        contentPadding = PaddingValues(start = gutter, end = gutter, bottom = 32.dp),
    ) {
        item { ScreenTitle(Txt.MORE) }
        items(moreDestinations, key = { it.label }) { destination ->
            val detail = when (destination.route) {
                Route.Favorites -> favorites.size.takeIf { it > 0 }?.let(Txt::number)
                Route.History -> history.size.takeIf { it > 0 }?.let(Txt::number)
                Route.Playlists -> playlists?.size?.takeIf { it > 0 }?.let(Txt::number)
                else -> null
            }
            ListRow(
                title = destination.label,
                onClick = { navigator.push(destination.route) },
                trailing = detail?.let { "$it  ›" } ?: "›",
                leading = { Icon(destination.icon, contentDescription = null, modifier = Modifier.size(24.dp)) },
            )
        }
    }
}
