package tv.tui.tuitv.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/** Ícones que não existem em material-icons-core (traçados do Material Symbols, 24x24). */
object TuiIcons {
    private fun icon(name: String, vararg paths: String): ImageVector =
        ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
            for (p in paths) addPath(pathData = addPathNodes(p), fill = SolidColor(Color.White))
        }.build()

    val LiveTv = icon(
        "LiveTv",
        "M21,6h-7.59l3.29,-3.29L16,2l-4,4 -4,-4 -0.71,0.71L10.59,6H3c-1.1,0 -2,0.89 -2,2v12c0,1.1 0.9,2 2,2h18c1.1,0 2,-0.9 2,-2V8c0,-1.11 -0.9,-2 -2,-2zM21,20H3V8h18v12zM9,10v8l7,-4z",
    )
    val Movie = icon(
        "Movie",
        "M18,4l2,4h-3l-2,-4h-2l2,4h-3l-2,-4H8l2,4H7L5,4H4c-1.1,0 -1.99,0.9 -1.99,2L2,18c0,1.1 0.9,2 2,2h16c1.1,0 2,-0.9 2,-2V4h-4z",
    )
    val Series = icon(
        "Series",
        "M4,6H2v14c0,1.1 0.9,2 2,2h14v-2H4V6zM20,2H8c-1.1,0 -2,0.9 -2,2v12c0,1.1 0.9,2 2,2h12c1.1,0 2,-0.9 2,-2V4c0,-1.1 -0.9,-2 -2,-2zM12,14.5v-9l6,4.5 -6,4.5z",
    )
    val History = icon(
        "History",
        "M13,3c-4.97,0 -9,4.03 -9,9H1l3.89,3.89 0.07,0.14L9,12H6c0,-3.87 3.13,-7 7,-7s7,3.13 7,7 -3.13,7 -7,7c-1.93,0 -3.68,-0.79 -4.94,-2.06l-1.42,1.42C8.27,19.99 10.51,21 13,21c4.97,0 9,-4.03 9,-9s-4.03,-9 -9,-9zM12,8v5l4.28,2.54 0.72,-1.21 -3.5,-2.08V8H12z",
    )
    val Guide = icon(
        "Guide",
        "M21,3H3C1.9,3 1,3.9 1,5v12c0,1.1 0.9,2 2,2h5v2h8v-2h5c1.1,0 1.99,-0.9 1.99,-2L23,5C23,3.9 22.1,3 21,3zM21,17H3V5h18V17zM5,8h9v2H5V8zM5,12h9v2H5V12zM15,8h4v6h-4V8z",
    )
    val Playlists = icon(
        "Playlists",
        "M3,10h11v2H3V10zM3,6h11v2H3V6zM3,14h7v2H3V14zM16,13v8l6,-4L16,13z",
    )
    val Logo = ImageVector.Builder("Logo", 24.dp, 24.dp, 512f, 512f).apply {
        addPath(pathData = addPathNodes("M256,0a256,256 0,1 1,0 512a256,256 0,1 1,0 -512z"), fill = SolidColor(Color(0xFF38BDF8)))
        addPath(pathData = addPathNodes("M212,168c0,-12 13,-19 23,-13l132,88c9,6 9,20 0,26l-132,88c-10,6 -23,-1 -23,-13z"), fill = SolidColor(Color(0xFF101827)))
    }.build()
}
