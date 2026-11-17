// Núcleo Kotlin compartilhado pelos aplicativos Android e Android TV.
// Kotlin/JVM puro (sem dependência do Android SDK): parser M3U, classificação, chaves estáveis,
// validação de endereços e backup — com as MESMAS regras dos pacotes TypeScript.
plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

dependencies {
    // org.json faz parte do Android; aqui é necessário apenas para compilar e testar na JVM.
    compileOnly(libs.json)
    testImplementation(libs.json)
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
    // Arquivos de referência compartilhados com o TypeScript (PRD RF-004).
    systemProperty("tuitv.fixtures", rootProject.file("packages/m3u-parser/fixtures").absolutePath)
    testLogging { events("passed", "failed", "skipped") }
}
