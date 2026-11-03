# flutter_secure_storage loads nested callback and cipher classes reflectively.
# Without these rules R8 reports missing classes and fails the release build.
-keep class com.it_nomads.fluttersecurestorage.** { *; }
-keepclassmembers class com.it_nomads.fluttersecurestorage.** { *; }
-dontwarn com.it_nomads.fluttersecurestorage.**
