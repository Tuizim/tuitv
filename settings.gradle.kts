// Build Gradle do TuiTV (Kotlin/Android). O ecossistema Web usa pnpm + Turborepo (ver package.json).
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

include(":kotlin-core")
project(":kotlin-core").projectDir = file("packages/kotlin-core")

// Aplicativo Android TV / Fire TV.
include(":android-tv")
project(":android-tv").projectDir = file("apps/android-tv")
