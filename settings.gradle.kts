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
