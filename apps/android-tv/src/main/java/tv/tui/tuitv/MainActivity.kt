package tv.tui.tuitv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import kotlinx.coroutines.Job
import tv.tui.tuitv.ui.TuiRoot
import tv.tui.tuitv.ui.theme.TuiTheme

class MainActivity : ComponentActivity() {
    private var refresh: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Celular e tablet: o app desenha atrás das barras do sistema e respeita as margens delas.
        enableEdgeToEdge()
        setContent { TuiTheme { TuiRoot() } }
    }

    override fun onStart() {
        super.onStart()
        // Atualização automática de listas e guias: ao abrir e a cada 30 minutos com o app aberto.
        refresh = (application as TuiApp).library.startAutoRefresh()
    }

    override fun onStop() {
        refresh?.cancel()
        refresh = null
        super.onStop()
    }
}
