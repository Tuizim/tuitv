package tv.tui.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

/** Mesmos casos de web/app/src/lib/xtream.test.ts. */
class XtreamApiTest {
    private val login = XtreamLogin("http://srv.example:8080", "joão", "s&nha")

    @Test
    fun `conta - aceita ativa, recusa senha e conta inativa, detecta servidor sem API`() {
        val account = XtreamApi.account("""{"user_info":{"auth":1,"status":"Active","exp_date":"1893499200","max_connections":"2"}}""")
        assertEquals(XtreamAccount("Active", 1893499200000, 2), account)
        assertNull(assertFailsWith<XtreamAuthException> { XtreamApi.account("""{"user_info":{"auth":0}}""") }.status)
        assertEquals("Expired", assertFailsWith<XtreamAuthException> { XtreamApi.account("""{"user_info":{"auth":"1","status":"Expired"}}""") }.status)
        assertFailsWith<XtreamNoApiException> { XtreamApi.account("<html>404</html>") }
        assertFailsWith<XtreamNoApiException> { XtreamApi.account("") }
        assertFailsWith<XtreamNoApiException> { XtreamApi.account("[]") }
    }

    @Test
    fun `categorias - ids repetidos e respostas que nao sao listas`() {
        assertEquals(
            listOf(RemoteCategory("1", "Abertos")),
            XtreamApi.categories("""[{"category_id":1,"category_name":"Abertos"},{"category_id":"1","category_name":"Repetida"},{"category_name":"Sem id"}]"""),
        )
        assertEquals(emptyList(), XtreamApi.categories("{}"))
        assertEquals(emptyList(), XtreamApi.categories("null"))
    }

    @Test
    fun `canais e filmes viram itens com ids estaveis e enderecos de reproducao`() {
        val live = XtreamApi.streams(
            """[{"stream_id":11,"name":" Canal Um ","stream_icon":"https://img.example/um.png","epg_channel_id":"canal.um","category_id":"1"},{"stream_id":"x","name":"Inválido"},{"name":"Sem id"}]""",
            "pl1", login, ContentKind.LIVE, mapOf("1" to "Abertos"),
        )
        assertEquals(1, live.size)
        val channel = live[0]
        assertEquals("pl1:x:l:11", channel.id)
        assertEquals("Canal Um", channel.name)
        assertEquals("http://srv.example:8080/live/jo%C3%A3o/s%26nha/11.ts", channel.url)
        assertEquals("https://img.example/um.png", channel.logo)
        assertEquals("Abertos", channel.group)
        assertEquals("canal.um", channel.tvgId)

        val movie = XtreamApi.streams(
            """[{"stream_id":"501","name":"Corrida Final (2022)","container_extension":"mkv","stream_icon":"javascript:alert(1)","category_id":"10","epg_channel_id":null}]""",
            "pl1", login, ContentKind.MOVIE, mapOf("10" to "Ação"),
        ).single()
        assertEquals("pl1:x:m:501.mkv", movie.id)
        assertEquals("http://srv.example:8080/movie/jo%C3%A3o/s%26nha/501.mkv", movie.url)
        assertEquals(2022, movie.year)
        assertNull(movie.logo) // endereço de imagem inseguro descartado
    }

    @Test
    fun `series chegam sem episodios e os episodios vem ao abrir a serie`() {
        val stub = XtreamApi.seriesList(
            """[{"series_id":77,"name":"Vale Escuro","cover":"https://img.example/v.jpg","releaseDate":"2021-03-01","category_id":"20","plot":"Segredos."}]""",
            "pl1", mapOf("20" to "Drama"),
        ).single()
        assertEquals(RemoteSeries("pl1:s:x77", "pl1", "x77", "Vale Escuro", "https://img.example/v.jpg", "Drama", 2021, "Segredos."), stub)
        assertEquals("77", XtreamApi.remoteSeriesId(stub.seriesKey))
        assertNull(XtreamApi.remoteSeriesId("abc"))

        // Formato em lista de listas (alguns painéis), com episódios fora de ordem.
        val (series, episodes) = XtreamApi.seriesEpisodes(
            """{"info":{"name":"Vale Escuro"},"episodes":[[{"id":"7002","episode_num":"2","title":"Neblina","container_extension":"mp4","season":"1","info":{}},{"id":"7001","episode_num":1,"title":"Chegada","container_extension":"mp4","season":1,"info":{"duration_secs":"2400"}}],[{"id":"7101","episode_num":1,"title":"","container_extension":"mkv","season":2}]]}""",
            "pl1", login, "77", stub, mapOf("20" to "Drama"),
        )
        assertEquals(stub.copy(plot = "Segredos."), series)
        assertEquals(listOf("Chegada", "Neblina", "T2 E1"), episodes.map { it.name })
        val first = episodes[0]
        assertEquals("pl1:x:e:77:7001.mp4", first.id)
        assertEquals("http://srv.example:8080/series/jo%C3%A3o/s%26nha/7001.mp4", first.url)
        assertEquals(2400, first.duration)
        assertEquals(SeriesInfo("Vale Escuro", "x77", 1, 1), first.series)

        // Formato em objeto por temporada.
        val (_, byObject) = XtreamApi.seriesEpisodes(
            """{"info":{"name":"Outra","cover":"https://img.example/o.jpg"},"episodes":{"1":[{"id":"1","episode_num":1,"title":"Piloto","container_extension":"mp4","season":1}]}}""",
            "pl1", login, "9", null, emptyMap(),
        )
        assertEquals("Outra", byObject.single().series!!.title)
        assertEquals("https://img.example/o.jpg", byObject.single().logo)
    }

    @Test
    fun `reconstroi favoritos e historico pelo id`() {
        val live = XtreamApi.itemFromId("pl1", login, "pl1:x:l:11", "Canal Um")!!
        assertEquals(ContentKind.LIVE, live.kind)
        assertEquals("http://srv.example:8080/live/jo%C3%A3o/s%26nha/11.ts", live.url)
        assertEquals("http://srv.example:8080/movie/jo%C3%A3o/s%26nha/501.mkv", XtreamApi.itemFromId("pl1", login, "pl1:x:m:501.mkv", "Filme")!!.url)
        assertEquals("x77", XtreamApi.itemFromId("pl1", login, "pl1:x:e:77:7001.mp4", "Ep")!!.series!!.seriesKey)
        assertNull(XtreamApi.itemFromId("pl1", login, "pl1:x:m:501.<script>", "x"))
        assertNull(XtreamApi.itemFromId("pl1", login, "outra:x:l:11", "x"))
    }

    @Test
    fun `endereco da API com credenciais codificadas`() {
        assertEquals(
            "http://srv.example:8080/player_api.php?username=jo%C3%A3o&password=s%26nha&action=get_live_streams&category_id=1",
            XtreamApi.url(login, mapOf("action" to "get_live_streams", "category_id" to "1")),
        )
    }
}
