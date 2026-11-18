package tv.tui.tuitv

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import okhttp3.OkHttpClient
import tv.tui.tuitv.data.BackupService
import tv.tui.tuitv.data.Library
import tv.tui.tuitv.data.Net
import tv.tui.tuitv.data.SettingsStore
import tv.tui.tuitv.data.db.AppDatabase

/** Ponto de montagem das dependências (injeção manual: o aplicativo é pequeno). */
class TuiApp : Application(), SingletonImageLoader.Factory {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    lateinit var http: OkHttpClient
        private set
    lateinit var library: Library
        private set
    lateinit var backup: BackupService
        private set

    override fun onCreate() {
        super.onCreate()
        http = Net.createClient()
        val settings = SettingsStore(this)
        library = Library(AppDatabase.create(this), settings, Net(this, http), scope)
        backup = BackupService(library)
    }

    /** Logotipos e capas com o mesmo cliente HTTP (sem cookies) e cache em disco. */
    override fun newImageLoader(context: PlatformContext): ImageLoader = ImageLoader.Builder(context)
        .components { add(OkHttpNetworkFetcherFactory(callFactory = { http })) }
        .crossfade(true)
        .build()
}
