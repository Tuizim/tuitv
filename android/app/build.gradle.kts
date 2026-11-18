import java.util.Properties

// Aplicativo TuiTV para Android TV, Google TV e Fire TV.
// Kotlin embutido no AGP 9; Compose for TV, Media3 (ExoPlayer) e Room.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
}

// Assinatura de release: lida de android/app/keystore.properties (fora do Git).
// Sem esse arquivo, o build de release é assinado com a chave de depuração local,
// o que basta para instalar por APK, mas não para publicar em loja.
val keystoreFile = file("keystore.properties")
val keystore = Properties().apply { if (keystoreFile.exists()) keystoreFile.inputStream().use(::load) }

// Versão: no CI vem da tag do Git (-Ptuitv.version=1.2.3); localmente, 0.1.0.
// versionCode cresce a cada versão (1.2.3 → 10203), o que o Android exige para aceitar a atualização.
val appVersion = (findProperty("tuitv.version") as String?)?.removePrefix("v") ?: "0.1.0"
val appVersionCode = Regex("""^(\d+)\.(\d+)\.(\d+)(-[\w.]+)?$""").matchEntire(appVersion)
    ?.destructured?.let { (major, minor, patch) -> major.toInt() * 10_000 + minor.toInt() * 100 + patch.toInt() }
    ?: error("Versão inválida: '$appVersion' (use MAIOR.MENOR.CORREÇÃO, ex.: 1.2.3)")

android {
    namespace = "tv.tui.tuitv"
    compileSdk = 37

    defaultConfig {
        applicationId = "tv.tui.tuitv"
        // API 23 cobre Android TV 6+ e todos os Fire TV com Fire OS 6 ou mais recente.
        minSdk = 23
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersion
    }

    signingConfigs {
        if (keystore.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            all {
                // Arquivos de referência compartilhados com o TypeScript e o kotlin-core.
                it.systemProperty("tuitv.fixtures", rootProject.file("../web/packages/m3u-parser/fixtures").absolutePath)
                // Capturas de tela dos testes de interface (verificação visual).
                it.systemProperty("tuitv.screenshots", layout.buildDirectory.dir("screenshots").get().asFile.absolutePath)
                it.systemProperty("robolectric.graphicsMode", "NATIVE")
                it.maxHeapSize = "2g"
            }
        }
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/versions/9/OSGI-INF/MANIFEST.MF")
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    implementation(project(":core"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.process)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material.icons.core)
    implementation(libs.tv.material)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)

    implementation(libs.media3.exoplayer)
    implementation(libs.media3.exoplayer.hls)
    implementation(libs.media3.ui)
    implementation(libs.media3.datasource.okhttp)

    implementation(libs.okhttp)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.test.junit)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.mockwebserver)
    debugImplementation(libs.compose.ui.test.manifest)
}
