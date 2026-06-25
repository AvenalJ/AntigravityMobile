import java.io.File

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "de.xyourp.antigravitymobile"
    compileSdk = 36
    buildToolsVersion = "35.0.0" // pin to the version installed in this environment

    defaultConfig {
        applicationId = "de.xyourp.antigravitymobile"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        create("release") {
            val storeFilePath = project.findProperty("AGM_RELEASE_STORE_FILE") as String?
            if (storeFilePath != null) {
                val resolved = File(rootProject.projectDir, storeFilePath)
                if (resolved.exists()) {
                    storeFile = resolved
                    storePassword = project.findProperty("AGM_RELEASE_STORE_PASSWORD") as String?
                    keyAlias = project.findProperty("AGM_RELEASE_KEY_ALIAS") as String?
                    keyPassword = project.findProperty("AGM_RELEASE_KEY_PASSWORD") as String?
                }
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Use the release keystore if it has been configured + exists; otherwise
            // the build still configures (and `assembleDebug` always works).
            val rc = signingConfigs.getByName("release")
            if (rc.storeFile != null) signingConfig = rc
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    lint {
        // False positive: MainActivity extends ComponentActivity (an Activity),
        // but lintVital can't resolve the AndroidX superclass and aborts the release.
        disable += "Instantiatable"
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
            excludes += "/META-INF/*.kotlin_module"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    debugImplementation(libs.androidx.ui.tooling)

    implementation(libs.androidx.datastore.preferences)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.coil.compose)
}
