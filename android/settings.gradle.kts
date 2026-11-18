// Build Gradle do TuiTV Android (TV, Fire TV, celular e tablet).
// Web e Samsung usam pnpm + Turborepo (ver ../package.json).
pluginManagement {
    repositories {
        gradlePluginPortal()
        google()
        mavenCentral()
    }
}
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "TuiTV"

// Núcleo Kotlin/JVM: parser, regras, EPG, busca e controle parental (mesmas regras do TypeScript).
include(":core")

// Aplicativo Android TV / Fire TV / celular / tablet.
include(":app")
