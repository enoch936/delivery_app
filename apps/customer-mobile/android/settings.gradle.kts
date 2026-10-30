// Fix for AGP AndroidLocationsException caused by duplicate ANDROID_PREFS_ROOT and ANDROID_USER_HOME env vars
run {
    try {
        val pe = Class.forName("java.lang.ProcessEnvironment")
        val fields = listOf("theEnvironment", "theUnmodifiableEnvironment")
        for (fieldName in fields) {
            try {
                val field = pe.getDeclaredField(fieldName)
                field.isAccessible = true
                val map = field.get(null) as? MutableMap<String, String>
                map?.remove("ANDROID_PREFS_ROOT")
            } catch (_: Exception) {}
        }
    } catch (_: Exception) {}
}

pluginManagement {
    val flutterSdkPath =
        run {
            val properties = java.util.Properties()
            file("local.properties").inputStream().use { properties.load(it) }
            val flutterSdkPath = properties.getProperty("flutter.sdk")
            require(flutterSdkPath != null) { "flutter.sdk not set in local.properties" }
            flutterSdkPath
        }

    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    id("com.android.application") version "9.1.0" apply false
    id("org.jetbrains.kotlin.android") version "2.4.0" apply false
}

include(":app")
