# Regras do R8 para o TuiTV. Room, Media3, Coil e OkHttp trazem as próprias regras.

# org.json faz parte do Android; o kotlin-core o usa apenas na compilação.
-dontwarn org.json.**

# Mensagens de erro de reprodução usam o nome da exceção.
-keepnames class androidx.media3.** extends java.lang.Throwable
