package tv.tui.tuitv

import android.content.Context
import android.net.Uri
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.GZIPOutputStream
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.util.Collections
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.HttpUrl.Companion.toHttpUrl
import okio.Buffer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import tv.tui.core.Backup
import tv.tui.core.ContentKind
import tv.tui.core.GroupCount
import tv.tui.core.Parental
import tv.tui.tuitv.data.BackupService
import tv.tui.tuitv.data.GroupFilter
import tv.tui.tuitv.data.ImportError
import tv.tui.tuitv.data.ImportException
import tv.tui.tuitv.data.Library
import tv.tui.tuitv.data.Net
import tv.tui.tuitv.data.SettingsStore
import tv.tui.tuitv.data.db.AppDatabase

/** Camada de dados sobre Room real (Robolectric), com os arquivos de referência compartilhados. */
@RunWith(AndroidJUnit4::class)
class DataLayerTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val fixtures = File(System.getProperty("tuitv.fixtures")!!)
    private lateinit var db: AppDatabase
    private lateinit var scope: CoroutineScope
    private lateinit var library: Library
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val settings = SettingsStore(context)
        // O servidor de teste roda em 127.0.0.1 (rede local).
        settings.update { it.copy(allowPrivateHosts = true) }
        library = Library(db, settings, Net(context, Net.createClient()), scope)
        server = MockWebServer().apply { start() }
    }

    @After
    fun tearDown() {
        server.close()
        scope.cancel()
        db.close()
    }

    private fun fixtureUri(name: String): Uri = Uri.fromFile(File(fixtures, name))

    private fun tempFile(bytes: ByteArray, name: String): Uri {
        val file = File(context.cacheDir, name).apply { writeBytes(bytes) }
        return Uri.fromFile(file)
    }

    private suspend fun <T> eventually(block: suspend () -> T?): T = withTimeout(5000) {
        while (true) {
            block()?.let { return@withTimeout it }
            delay(20)
        }
        @Suppress("UNREACHABLE_CODE") error("")
    }

    @Test
    fun `importa arquivo de referencia e organiza categorias`() = runBlocking {
        val playlist = library.addPlaylistFile(fixtureUri("basic.m3u"), "basic.m3u", "Referência")
        assertEquals(6, playlist.itemCount)
        assertEquals(6, playlist.live)
        assertEquals(
            listOf(GroupCount("Abertos", 4), GroupCount("Esportes", 1), GroupCount("Notícias", 1)),
            library.groups(ContentKind.LIVE).first(),
        )
        assertEquals(6, library.items(ContentKind.LIVE, GroupFilter.All).first().size)
        assertEquals(4, library.items(ContentKind.LIVE, GroupFilter.Named("Abertos")).first().size)
        assertEquals(listOf("Notícias 24h"), library.search("noticias").live.map { it.name })
        assertEquals(listOf("Canal Um HD", "Canal Um SD"), library.search("um canal").live.map { it.name })
    }

    @Test
    fun `filmes e series a partir da lista de referencia`() = runBlocking {
        library.addPlaylistFile(fixtureUri("vod.m3u"), "vod.m3u", "")
        val movies = library.items(ContentKind.MOVIE, GroupFilter.All).first().map { it.name }
        assertEquals(listOf("O Grande Filme (2019)", "Outro Filme - 2021", "Planeta Azul [2006]"), movies)
        val series = library.series(GroupFilter.All).first()
        assertEquals(listOf("A Série", "Aventura", "Coração Valente", "Minissérie Sem Marcação", "Risadas"), series.map { it.title }.sorted())
        val a = series.first { it.title == "A Série" }
        assertEquals(3, a.episodes)
        val episodes = library.episodes(a.playlistId, a.seriesKey).first()
        assertEquals(listOf(1 to 1, 1 to 2, 2 to 1), episodes.map { it.series!!.season to it.series!!.episode }.sortedWith(compareBy({ it.first }, { it.second })))
        assertTrue(library.search("serie").series.any { it.title == "A Série" })
    }

    @Test
    fun `atualizacao por endereco nao duplica e remove o que saiu da lista`() = runBlocking {
        val v1 = "#EXTM3U\n#EXTINF:-1 tvg-id=\"a\" group-title=\"G\",Canal A\nhttp://x.example/a?t=1\n#EXTINF:-1 tvg-id=\"b\" group-title=\"G\",Canal B\nhttp://x.example/b\n"
        val v2 = "#EXTM3U\n#EXTINF:-1 tvg-id=\"a\" group-title=\"G\",Canal A\nhttp://x.example/a?t=2\n"
        server.enqueue(MockResponse.Builder().body(v1).build())
        server.enqueue(MockResponse.Builder().body(v2).build())
        val playlist = library.addPlaylistUrl("", server.url("/lista.m3u").toString())
        val before = library.items(ContentKind.LIVE, GroupFilter.All).first()
        assertEquals(2, before.size)
        library.toggleFavorite(before[0].id, ContentKind.LIVE, playlist.id)

        val refreshed = library.refreshPlaylist(playlist.id)
        assertEquals(1, refreshed.itemCount)
        val after = library.items(ContentKind.LIVE, GroupFilter.All).first()
        assertEquals(listOf(before[0].id), after.map { it.id })
        assertEquals("http://x.example/a?t=2", after[0].url)
        // O favorito sobrevive à atualização (o id não depende do endereço).
        assertTrue(library.isFavorite(before[0].id).first())
        // O endereço fica cifrado (ou marcado) no banco, nunca em texto puro.
        assertFalse(db.playlists().get(playlist.id)!!.urlSealed!!.startsWith("http"))
    }

    @Test
    fun `login sem a API do servidor importa get php, adiciona o guia e permite trocar a senha`() = runBlocking {
        val m3u = "#EXTM3U\n#EXTINF:-1 tvg-id=\"um.br\" group-title=\"Abertos\",Canal Um\nhttp://x.example/live/joao/s/1.ts\n"
        val xml = "<tv><channel id=\"um.br\"><display-name>Canal Um</display-name></channel></tv>"
        val noApi = MockResponse.Builder().code(404).build()
        server.enqueue(noApi)
        server.enqueue(MockResponse.Builder().body(m3u).build())
        server.enqueue(MockResponse.Builder().body(xml).build())
        val host = "${server.hostName}:${server.port}/"

        val playlist = library.addPlaylistLogin("", host, " joão ", "s&nha")
        // Primeiro a API do login (player_api.php); sem ela, a lista M3U do mesmo login é importada.
        assertTrue(server.takeRequest().target.startsWith("/player_api.php?username=jo%C3%A3o&password=s%26nha"))
        assertFalse(playlist.remote)
        assertEquals(1, playlist.itemCount)
        assertEquals(server.hostName, playlist.name)
        assertEquals("/get.php?username=jo%C3%A3o&password=s%26nha&type=m3u_plus&output=ts", server.takeRequest().target)
        assertEquals("joão", playlist.login?.username)
        assertEquals("s&nha", playlist.login?.password)

        // A lista não anunciou guia: o xmltv.php do mesmo login é adicionado e baixado.
        val source = eventually { library.epgSources.value.firstOrNull()?.takeIf { it.channelCount > 0 } }
        assertEquals("/xmltv.php?username=jo%C3%A3o&password=s%26nha", server.takeRequest().target)
        assertTrue(source.url!!.contains("xmltv.php"))

        // Senha nova do provedor: mesma lista, favoritos mantidos.
        val item = library.items(ContentKind.LIVE, GroupFilter.All).first().single()
        library.toggleFavorite(item.id, ContentKind.LIVE, playlist.id)
        server.enqueue(noApi)
        server.enqueue(MockResponse.Builder().body(m3u).build())
        val changed = library.changePlaylistSource(playlist.id, login = Triple(host, "joão", "nova"))
        assertTrue(server.takeRequest().target.startsWith("/player_api.php"))
        assertEquals(playlist.id, changed.id)
        assertEquals("/get.php?username=jo%C3%A3o&password=nova&type=m3u_plus&output=ts", server.takeRequest().target)
        assertTrue(library.isFavorite(item.id).first())
        assertEquals(1, library.playlists.first { it?.size == 1 }!!.size)

        val missing = runCatching { library.addPlaylistLogin("", host, "joão", " ") }.exceptionOrNull() as ImportException
        assertEquals(ImportError.LOGIN_MISSING, missing.error)
        val badHost = runCatching { library.addPlaylistLogin("", "ftp://x", "a", "b") }.exceptionOrNull() as ImportException
        assertEquals(ImportError.URL_MALFORMED, badHost.error)
    }

    @Test
    fun `gzip e Windows-1252 sao detectados`() = runBlocking {
        val text = "#EXTM3U\n#EXTINF:-1 group-title=\"Notícias\",Canal Ação\nhttp://a.example/1\n"
        val gz = ByteArrayOutputStream().also { out -> GZIPOutputStream(out).use { it.write(text.toByteArray(charset("windows-1252"))) } }.toByteArray()
        library.addPlaylistFile(tempFile(gz, "lista.m3u.gz"), "lista.m3u.gz", "")
        val item = library.items(ContentKind.LIVE, GroupFilter.All).first().single()
        assertEquals("Canal Ação", item.name)
        assertEquals("Notícias", item.group)
    }

    @Test
    fun `erros de importacao sao explicados`() = runBlocking {
        suspend fun errorOf(block: suspend () -> Unit): ImportError = try {
            block()
            error("deveria falhar")
        } catch (e: ImportException) {
            e.error
        }
        server.enqueue(MockResponse.Builder().body("<html>pagina</html>").build())
        assertEquals(ImportError.NOT_M3U, errorOf { library.addPlaylistUrl("", server.url("/a").toString()) })
        server.enqueue(MockResponse.Builder().code(404).build())
        assertEquals(ImportError.HTTP, errorOf { library.addPlaylistUrl("", server.url("/b").toString()) })
        server.enqueue(MockResponse.Builder().body("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg1.ts\n").build())
        assertEquals(ImportError.HLS_MANIFEST, errorOf { library.addPlaylistUrl("", server.url("/c.m3u8").toString()) })
        assertEquals(ImportError.URL_SCHEME, errorOf { library.addPlaylistUrl("", "ftp://x.example/l.m3u") })
        library.settingsStore.update { it.copy(allowPrivateHosts = false) }
        assertEquals(ImportError.URL_PRIVATE, errorOf { library.addPlaylistUrl("", "http://192.168.0.10/l.m3u") })
        // Nenhuma importação com falha deixa lista ou itens para trás.
        assertTrue(library.playlists.value.orEmpty().isEmpty())
        assertTrue(db.items().countActive().first() == 0)
    }

    @Test
    fun `guia xmltv por endereco e programa atual`() = runBlocking {
        val now = System.currentTimeMillis()
        fun xmltv(ms: Long): String {
            val c = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC")).apply { timeInMillis = ms }
            return "%04d%02d%02d%02d%02d00 +0000".format(c.get(1), c.get(2) + 1, c.get(5), c.get(11), c.get(12))
        }
        val xml = """<?xml version="1.0"?><tv>
            <channel id="um.br"><display-name>Canal Um</display-name></channel>
            <programme start="${xmltv(now - 1_800_000)}" stop="${xmltv(now + 1_800_000)}" channel="um.br"><title>Jornal</title></programme>
            <programme start="${xmltv(now + 1_800_000)}" stop="${xmltv(now + 5_400_000)}" channel="um.br"><title>Filme</title></programme>
            </tv>"""
        val m3u = "#EXTM3U url-tvg=\"${server.url("/guia.xml")}\"\n#EXTINF:-1 tvg-id=\"um.br\",Canal Um HD\nhttp://x.example/1\n"
        server.enqueue(MockResponse.Builder().body(m3u).build())
        server.enqueue(MockResponse.Builder().body(Buffer().write(gzip(xml))).addHeader("Content-Type", "application/gzip").build())
        library.addPlaylistUrl("Com guia", server.url("/lista.m3u").toString())
        // O guia anunciado no cabeçalho (url-tvg) é adicionado e baixado automaticamente.
        val source = eventually { library.epgSources.value.firstOrNull()?.takeIf { it.programmeCount > 0 } }
        assertEquals(2, source.programmeCount)
        val item = library.items(ContentKind.LIVE, GroupFilter.All).first().single()
        val nn = eventually { library.nowNext(item) }
        assertEquals("Jornal", nn.current?.title)
        assertEquals(listOf("Filme"), nn.next.map { it.title })
    }

    private fun gzip(text: String) = ByteArrayOutputStream().also { out -> GZIPOutputStream(out).use { it.write(text.toByteArray()) } }.toByteArray()

    @Test
    fun `restaura backup cifrado gerado pela Web e exporta de volta`() = runBlocking {
        val backup = BackupService(library)
        val text = File(fixtures, "backup/web-encrypted.json").readText()
        val summary = backup.restore(text, "tuitv-fixture")
        assertEquals(1, summary.playlists)
        assertEquals(1, summary.favorites)
        val playlist = library.playlists.first { it?.isNotEmpty() == true }!!.single()
        assertEquals("Referência", playlist.name)
        assertEquals(6, library.items(ContentKind.LIVE, GroupFilter.All).first().size)
        assertEquals(1, library.favorites.first().size)

        // Exporta com senha e restaura em um banco vazio.
        val exported = backup.export("segredo")
        assertFalse(exported.contains("Referência"))
        val envelope = JSONObject(exported)
        assertEquals("android-tv", envelope.getString("platform"))
        assertTrue(envelope.getBoolean("encrypted"))

        val db2 = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
        val library2 = Library(db2, SettingsStore(context), Net(context, Net.createClient()), scope)
        BackupService(library2).restore(exported, "segredo")
        assertEquals(6, library2.items(ContentKind.LIVE, GroupFilter.All).first().size)
        db2.close()
    }

    @Test
    fun `controle parental oculta categorias ate o PIN`() = runBlocking {
        library.addPlaylistFile(fixtureUri("basic.m3u"), "basic.m3u", "")
        val pin = Parental.hashPin("1234")
        library.settingsStore.update {
            it.copy(parental = it.parental.copy(enabled = true, pinHash = pin.pinHash, pinSalt = pin.pinSalt, lockedGroups = listOf("esportes")))
        }
        assertFalse(library.groups(ContentKind.LIVE).first().any { it.name == "Esportes" })
        assertEquals(5, library.items(ContentKind.LIVE, GroupFilter.All).first().size)
        assertFalse(library.unlock("0000"))
        assertTrue(library.unlock("1234"))
        assertTrue(library.groups(ContentKind.LIVE).first().any { it.name == "Esportes" })
        assertEquals(6, library.items(ContentKind.LIVE, GroupFilter.All).first().size)
    }

    @Test
    fun `historico registra posicao e conclusao`() = runBlocking {
        library.addPlaylistFile(fixtureUri("vod.m3u"), "vod.m3u", "")
        val movie = library.items(ContentKind.MOVIE, GroupFilter.All).first().first()
        library.recordPlayback(movie, 600, 6000)
        val entry = eventually { library.historyEntry(movie.id) }
        assertEquals(600L, entry.position)
        assertFalse(entry.completed)
        library.recordPlayback(movie, 5800, 6000)
        assertNotNull(eventually { library.historyEntry(movie.id)?.takeIf { it.completed } })
    }

    /**
     * Provedor Xtream simulado (usuário "joão", senha "s&nha") — mesmos dados do servidor de apoio da Web
     * (apps/web/e2e/fixture-server.mjs). [calls] registra as ações pedidas ao player_api.php.
     */
    private fun xtreamServer(): MutableList<String> {
        val calls = Collections.synchronizedList(ArrayList<String>())
        val live = """[{"stream_id":11,"name":"Canal Um HD","epg_channel_id":"canal.um","category_id":"1"},{"stream_id":12,"name":"Canal Dois","category_id":"1"},{"stream_id":13,"name":"Canal Um SD","category_id":"1"},{"stream_id":21,"name":"Esporte 1","category_id":"2"},{"stream_id":31,"name":"Notícias 24h","category_id":"3"}]"""
        val vod = """[{"stream_id":501,"name":"Corrida Final (2022)","container_extension":"mp4","category_id":"10"},{"stream_id":502,"name":"Drama na Serra","container_extension":"mkv","category_id":"11"}]"""
        val series = """[{"series_id":77,"name":"Vale Escuro","releaseDate":"2021-03-01","category_id":"20","plot":"Segredos."}]"""
        val info = """{"info":{"name":"Vale Escuro"},"episodes":{"1":[{"id":"7001","episode_num":1,"title":"Chegada","container_extension":"mp4","season":1},{"id":"7002","episode_num":2,"title":"Neblina","container_extension":"mp4","season":1}],"2":[{"id":"7101","episode_num":1,"title":"Retorno","container_extension":"mkv","season":2}]}}"""
        fun byCategory(json: String, category: String?): String {
            if (category == null) return json
            val array = org.json.JSONArray(json)
            return org.json.JSONArray((0 until array.length()).map { array.getJSONObject(it) }.filter { it.getString("category_id") == category }).toString()
        }
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val url = "http://x${request.target}".toHttpUrl()
                val ok = { body: String -> MockResponse.Builder().body(body).build() }
                if (url.encodedPath == "/xmltv.php") return ok("<tv><channel id=\"canal.um\"><display-name>Canal Um HD</display-name></channel></tv>")
                if (url.encodedPath != "/player_api.php") return MockResponse.Builder().code(404).build()
                if (url.queryParameter("username") != "joão" || url.queryParameter("password") != "s&nha") return ok("""{"user_info":{"auth":0}}""")
                val action = url.queryParameter("action") ?: ""
                val category = url.queryParameter("category_id")
                calls += if (category != null) "$action:$category" else action.ifEmpty { "login" }
                return ok(
                    when (action) {
                        "" -> """{"user_info":{"auth":1,"status":"Active","exp_date":"1893499200","max_connections":"2"}}"""
                        "get_live_categories" -> """[{"category_id":"1","category_name":"Abertos"},{"category_id":"2","category_name":"Esportes"},{"category_id":"3","category_name":"Notícias"}]"""
                        "get_vod_categories" -> """[{"category_id":"10","category_name":"Filmes | Ação"},{"category_id":"11","category_name":"Filmes | Drama"}]"""
                        "get_series_categories" -> """[{"category_id":"20","category_name":"Séries | Drama"}]"""
                        "get_live_streams" -> byCategory(live, category)
                        "get_vod_streams" -> byCategory(vod, category)
                        "get_series" -> byCategory(series, category)
                        "get_series_info" -> info
                        else -> "[]"
                    },
                )
            }
        }
        return calls
    }

    @Test
    fun `login sob demanda - conecta sem baixar a lista e carrega cada categoria ao abrir`() = runBlocking {
        val calls = xtreamServer()
        val host = "${server.hostName}:${server.port}"
        val playlist = library.addPlaylistLogin("", host, "joão", "s&nha")
        assertTrue(playlist.remote)
        assertEquals(0, playlist.itemCount)
        assertEquals(listOf(3, 2, 1), listOf(playlist.live, playlist.movie, playlist.series))
        assertEquals(1893499200000L, playlist.expiresAt)
        // Só a conta e as categorias foram pedidas.
        assertEquals(listOf("get_live_categories", "get_series_categories", "get_vod_categories", "login"), calls.sorted())

        // Categorias do servidor aparecem antes de carregar o conteúdo delas.
        val groups = eventually { library.groups(ContentKind.LIVE).first().takeIf { it.isNotEmpty() } }
        assertEquals(listOf("Abertos", "Esportes", "Notícias"), groups.map { it.name })

        val abertos = eventually { library.items(ContentKind.LIVE, GroupFilter.Named("Abertos")).first().takeIf { it.isNotEmpty() } }
        assertEquals(listOf("Canal Um HD", "Canal Dois", "Canal Um SD"), abertos.map { it.name })
        assertEquals("http://$host/live/jo%C3%A3o/s%26nha/11.ts", abertos[0].url)
        assertTrue("get_live_streams:1" in calls)
        assertFalse("get_live_streams" in calls)
        // Nada do catálogo foi gravado no aparelho.
        assertTrue(db.items().forPlaylist(playlist.id).isEmpty())
        assertEquals(GroupCount("Abertos", 3), library.groups(ContentKind.LIVE).first().first())

        // Série: os episódios vêm ao abrir a série.
        val vale = eventually { library.series(GroupFilter.Named("Séries | Drama")).first().takeIf { it.isNotEmpty() } }.single()
        assertEquals("x77", vale.seriesKey)
        val episodes = eventually { library.episodes(playlist.id, vale.seriesKey).first().takeIf { it.isNotEmpty() } }
        assertEquals(listOf("Chegada", "Neblina", "Retorno"), episodes.map { it.name })
        assertTrue("get_series_info" in calls)

        // Favoritos guardam nome e capa.
        val movie = eventually { library.items(ContentKind.MOVIE, GroupFilter.Named("Filmes | Ação")).first().takeIf { it.isNotEmpty() } }.single()
        assertTrue(library.toggleFavorite(movie.id, ContentKind.MOVIE, playlist.id))
        assertTrue(library.toggleFavorite(vale.id, ContentKind.SERIES, playlist.id))
        assertEquals("Corrida Final (2022)", db.favorites().get(movie.id)!!.name)
        assertEquals("Vale Escuro", db.favorites().get(vale.id)!!.name)

        // Busca: o catálogo de cada tipo é pedido uma vez e filtrado no aparelho.
        assertEquals(listOf("Drama na Serra"), library.search("serra").movies.map { it.name })
        assertTrue(calls.containsAll(listOf("get_live_streams", "get_vod_streams", "get_series")))

        // O guia do mesmo login é adicionado.
        eventually { library.epgSources.value.firstOrNull { it.url?.contains("xmltv.php") == true } }

        // Nova sessão (mesmo banco): favoritos e item do histórico aparecem sem pedir o catálogo.
        library.recordPlayback(abertos[1], 0, 0)
        eventually { library.historyEntry(abertos[1].id) }
        val session = Library(db, library.settingsStore, Net(context, Net.createClient()), scope)
        calls.clear()
        val favorites = eventually { session.favorites.first().takeIf { it.size == 2 } }
        val favoriteMovie = favorites.filterIsInstance<tv.tui.tuitv.data.FavoriteEntry.Item>().single().item
        assertEquals("Corrida Final (2022)", favoriteMovie.name)
        assertEquals("http://$host/movie/jo%C3%A3o/s%26nha/501.mp4", favoriteMovie.url)
        assertEquals("Vale Escuro", favorites.filterIsInstance<tv.tui.tuitv.data.FavoriteEntry.Series>().single().series.title)
        assertEquals("Canal Dois", session.item(abertos[1].id)!!.name)
        assertTrue(calls.none { it.startsWith("get_") && !it.endsWith("_categories") })
    }

    @Test
    fun `lista antiga importada de um login passa a ser consultada sob demanda ao atualizar`() = runBlocking {
        server.enqueue(MockResponse.Builder().code(404).build())
        server.enqueue(MockResponse.Builder().body("#EXTM3U\n#EXTINF:-1 group-title=\"G\",Canal A\nhttp://x.example/a\n").build())
        val host = "${server.hostName}:${server.port}"
        val old = library.addPlaylistLogin("", host, "joão", "s&nha")
        assertEquals(1, old.itemCount)
        server.takeRequest()
        server.takeRequest()
        // O servidor passa a oferecer a API: "Atualizar" converte e libera o armazenamento.
        xtreamServer()
        val updated = library.refreshPlaylist(old.id)
        assertTrue(updated.remote)
        assertEquals(old.id, updated.id)
        assertTrue(db.items().forPlaylist(old.id).isEmpty())
    }

    @Test
    fun `backup com login sob demanda - restaura sem baixar a lista e exporta no formato da Web`() = runBlocking {
        val calls = xtreamServer()
        val url = tv.tui.core.Xtream.playlistUrl(tv.tui.core.XtreamLogin("http://${server.hostName}:${server.port}", "joão", "s&nha"))
        val data = JSONObject()
            .put(
                "playlists",
                org.json.JSONArray().put(
                    JSONObject().put(
                        "playlist",
                        JSONObject().put("id", "pl1").put("name", "Provedor").put("source", "url").put("url", url).put("active", true)
                            .put("createdAt", 1).put("updatedAt", 1).put("itemCount", 0)
                            .put("counts", JSONObject().put("live", 0).put("movie", 0).put("series", 0))
                            .put("provider", "xtream")
                            .put("account", JSONObject().put("expiresAt", 1893499200000L).put("categories", JSONObject().put("live", 3).put("movie", 2).put("series", 1))),
                    ),
                ),
            )
            .put(
                "favorites",
                org.json.JSONArray().put(
                    JSONObject().put("id", "pl1:x:m:502.mkv").put("kind", "movie").put("playlistId", "pl1").put("addedAt", 5)
                        .put("snapshot", JSONObject().put("name", "Drama na Serra").put("group", "Filmes | Drama")),
                ),
            )
            .put("history", org.json.JSONArray())
            .put("epgSources", org.json.JSONArray())
            .put("settings", JSONObject())
        val backup = BackupService(library)
        backup.restore(tv.tui.core.Backup.create(data, "web"), null)

        val playlist = library.playlists.first { it?.isNotEmpty() == true }!!.single()
        assertTrue(playlist.remote)
        assertEquals(listOf(3, 2, 1), listOf(playlist.live, playlist.movie, playlist.series))
        val favorite = eventually { library.favorites.first().singleOrNull() } as tv.tui.tuitv.data.FavoriteEntry.Item
        assertEquals("Drama na Serra", favorite.item.name)
        assertTrue(favorite.item.url.endsWith("/movie/jo%C3%A3o/s%26nha/502.mkv"))
        // Nenhuma lista M3U foi baixada.
        delay(300)
        assertTrue(calls.none { it.startsWith("get_") && !it.endsWith("_categories") })

        val exported = Backup.open(backup.export(null))
        val p = exported.getJSONArray("playlists").getJSONObject(0).getJSONObject("playlist")
        assertEquals("xtream", p.getString("provider"))
        assertEquals(3, p.getJSONObject("account").getJSONObject("categories").getInt("live"))
        assertEquals(0, p.getInt("itemCount"))
        assertEquals("Drama na Serra", exported.getJSONArray("favorites").getJSONObject(0).getJSONObject("snapshot").getString("name"))
    }
}
