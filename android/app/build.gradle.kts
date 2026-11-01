plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val webAppUrl = (project.findProperty("webAppUrl") as String?)
    ?: System.getenv("WEB_APP_URL")?.takeIf { it.isNotBlank() }
    ?: "https://astra-ai-site.vercel.app/"
val appVersionCode = System.getenv("VERSION_CODE")?.toIntOrNull() ?: 1

android {
    namespace = "com.astraai.mobile"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.astraai.mobile"
        minSdk = 24
        targetSdk = 35
        versionCode = appVersionCode
        versionName = "1.0.$appVersionCode"
        buildConfigField("String", "WEB_APP_URL", "\"$webAppUrl\"")
    }

    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
}
