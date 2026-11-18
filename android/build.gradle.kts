// Plugins declarados uma única vez na raiz (apply false) para que todos os módulos
// compartilhem o mesmo classpath — exigência do AGP 9 com Kotlin embutido.
plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.ksp) apply false
}
