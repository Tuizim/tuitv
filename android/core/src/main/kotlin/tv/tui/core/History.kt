package tv.tui.core

/**
 * Histórico e "continuar assistindo" de séries no estilo Netflix: a série aparece uma única vez e
 * continuar leva sempre ao episódio mais adiante que o usuário já assistiu.
 * Mesmas regras de web/packages/business-rules/src/history.ts.
 */

/** Uma linha do histórico: um canal, um filme ou uma série inteira (com todos os episódios vistos). */
data class HistoryRow<T>(
    /** Entrada que representa a linha. Na série, o episódio mais adiante já assistido. */
    val entry: T,
    /** Série: todas as entradas dela, da mais recente para a mais antiga. */
    val episodes: List<T>? = null,
)

/** Posição de um episódio do histórico na série (0 ou nulo quando a lista não informa). */
data class EpisodeOrder(val season: Int?, val episode: Int?, val playedAt: Long) {
    internal val numbered get() = (season ?: 0) > 0 || (episode ?: 0) > 0
}

/** `a` está mais adiante na série que `b`? Pela temporada e episódio; sem números, o assistido por último. */
fun isFurtherEpisode(a: EpisodeOrder, b: EpisodeOrder): Boolean {
    if (a.numbered && b.numbered) {
        val season = (a.season ?: 0) - (b.season ?: 0)
        if (season != 0) return season > 0
        val episode = (a.episode ?: 0) - (b.episode ?: 0)
        if (episode != 0) return episode > 0
    }
    return a.playedAt > b.playedAt
}

/**
 * Junta os episódios de cada série numa única linha, na posição do episódio visto por último.
 * `entries` vem do mais recente para o mais antigo (ordem do histórico); `seriesId` é nulo para canais e filmes.
 */
fun <T> collapseSeriesHistory(entries: List<T>, seriesId: (T) -> String?, order: (T) -> EpisodeOrder): List<HistoryRow<T>> {
    class Bucket(var entry: T, val episodes: MutableList<T>)
    val rows = ArrayList<Any>() // T (linha simples) ou Bucket (série)
    val bySeries = HashMap<String, Bucket>()
    for (entry in entries) {
        val sid = seriesId(entry)
        if (sid == null) {
            rows.add(HistoryRow(entry))
            continue
        }
        val bucket = bySeries[sid]
        if (bucket == null) {
            Bucket(entry, mutableListOf(entry)).also { bySeries[sid] = it; rows.add(it) }
            continue
        }
        bucket.episodes.add(entry)
        if (isFurtherEpisode(order(entry), order(bucket.entry))) bucket.entry = entry
    }
    @Suppress("UNCHECKED_CAST")
    return rows.map { if (it is HistoryRow<*>) it as HistoryRow<T> else (it as Bucket).let { b -> HistoryRow(b.entry, b.episodes.toList()) } }
}

data class EpisodeProgress(val position: Long, val completed: Boolean)

data class ContinueTarget(
    val episode: MediaItem,
    /** Retomar da posição salva (episódio iniciado e não concluído). */
    val resume: Boolean,
)

/**
 * Episódio para continuar a série: o mais adiante (na ordem da série) que já foi assistido;
 * se ele foi concluído, o seguinte. Sem nada assistido, ou com a série toda vista, o primeiro.
 */
fun continueEpisode(series: SeriesGroup, progress: (String) -> EpisodeProgress?): ContinueTarget? {
    val flat = series.seasons.flatMap { it.episodes }
    if (flat.isEmpty()) return null
    for (i in flat.indices.reversed()) {
        val entry = progress(flat[i].id) ?: continue
        if (!entry.completed) return ContinueTarget(flat[i], entry.position > 0)
        return ContinueTarget(flat.getOrNull(i + 1) ?: flat.first(), false)
    }
    return ContinueTarget(flat.first(), false)
}
