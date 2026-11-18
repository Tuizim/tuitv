package tv.tui.tuitv.data

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject

/** Mesmos campos de ParentalSettings em web/packages/shared-models. */
data class ParentalSettings(
    val enabled: Boolean = false,
    val pinHash: String? = null,
    val pinSalt: String? = null,
    val hideAdult: Boolean = true,
    /** Categorias bloqueadas manualmente (nomes normalizados). */
    val lockedGroups: List<String> = emptyList(),
)

enum class AspectMode(val id: String) { CONTAIN("contain"), COVER("cover"), FILL("fill") }

/** Mesmos campos e valores padrão de Settings em web/packages/shared-models (DEFAULT_SETTINGS). */
data class Settings(
    val theme: String = "dark",
    val language: String = "pt-BR",
    val autoplay: Boolean = true,
    val autoReconnect: Boolean = true,
    /** Segundos. */
    val connectionTimeout: Int = 15,
    val audioLanguage: String = "",
    val subtitlesEnabled: Boolean = false,
    val subtitleLanguage: String = "",
    val aspect: AspectMode = AspectMode.CONTAIN,
    val volume: Double = 1.0,
    /** Horas; 0 desativa a atualização automática. */
    val autoRefreshHours: Int = 24,
    val allowPrivateHosts: Boolean = false,
    val parental: ParentalSettings = ParentalSettings(),
) {
    /** Formato JSON idêntico ao da Web (usado também no backup). [includePin] = false omite o PIN. */
    fun toJson(includePin: Boolean = true): JSONObject = JSONObject()
        .put("theme", theme)
        .put("language", language)
        .put("autoplay", autoplay)
        .put("autoReconnect", autoReconnect)
        .put("connectionTimeout", connectionTimeout)
        .put("audioLanguage", audioLanguage)
        .put("subtitlesEnabled", subtitlesEnabled)
        .put("subtitleLanguage", subtitleLanguage)
        .put("aspect", aspect.id)
        .put("volume", volume)
        .put("autoRefreshHours", autoRefreshHours)
        .put("allowPrivateHosts", allowPrivateHosts)
        .put(
            "parental",
            JSONObject()
                .put("enabled", if (includePin) parental.enabled else false)
                .put("hideAdult", parental.hideAdult)
                .put("lockedGroups", JSONArray(parental.lockedGroups))
                .apply {
                    if (includePin) {
                        parental.pinHash?.let { put("pinHash", it) }
                        parental.pinSalt?.let { put("pinSalt", it) }
                    }
                },
        )

    companion object {
        fun fromJson(json: JSONObject?): Settings {
            if (json == null) return Settings()
            val d = Settings()
            val p = json.optJSONObject("parental")
            val locked = p?.optJSONArray("lockedGroups")
            return Settings(
                theme = json.optString("theme", d.theme),
                language = json.optString("language", d.language),
                autoplay = json.optBoolean("autoplay", d.autoplay),
                autoReconnect = json.optBoolean("autoReconnect", d.autoReconnect),
                connectionTimeout = json.optInt("connectionTimeout", d.connectionTimeout).coerceIn(5, 120),
                audioLanguage = json.optString("audioLanguage", d.audioLanguage),
                subtitlesEnabled = json.optBoolean("subtitlesEnabled", d.subtitlesEnabled),
                subtitleLanguage = json.optString("subtitleLanguage", d.subtitleLanguage),
                aspect = AspectMode.entries.firstOrNull { it.id == json.optString("aspect") } ?: d.aspect,
                volume = json.optDouble("volume", d.volume).let { if (it.isNaN()) 1.0 else it.coerceIn(0.0, 1.0) },
                autoRefreshHours = json.optInt("autoRefreshHours", d.autoRefreshHours).coerceAtLeast(0),
                allowPrivateHosts = json.optBoolean("allowPrivateHosts", d.allowPrivateHosts),
                parental = ParentalSettings(
                    enabled = p?.optBoolean("enabled", false) ?: false,
                    pinHash = p?.optString("pinHash")?.ifEmpty { null },
                    pinSalt = p?.optString("pinSalt")?.ifEmpty { null },
                    hideAdult = p?.optBoolean("hideAdult", true) ?: true,
                    lockedGroups = locked?.let { a -> List(a.length()) { a.optString(it) }.filter { it.isNotEmpty() } } ?: emptyList(),
                ),
            )
        }
    }
}

/** Preferências persistidas como JSON (mesmo formato da Web) em SharedPreferences. */
class SettingsStore(context: Context) {
    private val prefs = context.getSharedPreferences("tuitv", Context.MODE_PRIVATE)
    private val state = MutableStateFlow(load())
    val settings: StateFlow<Settings> = state.asStateFlow()
    val current: Settings get() = state.value

    private fun load(): Settings = try {
        Settings.fromJson(prefs.getString(KEY, null)?.let(::JSONObject))
    } catch (_: Exception) {
        Settings()
    }

    @Synchronized
    fun update(transform: (Settings) -> Settings) {
        val next = transform(state.value)
        prefs.edit { putString(KEY, next.toJson().toString()) }
        state.value = next
    }

    /** Pequenos valores de estado (ex.: último canal), fora das configurações. */
    fun getString(key: String): String? = prefs.getString("state.$key", null)
    fun putString(key: String, value: String?) = prefs.edit { putString("state.$key", value) }

    private companion object {
        const val KEY = "settings"
    }
}
