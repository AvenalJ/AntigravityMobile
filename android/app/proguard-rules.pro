# kotlinx.serialization — keep generated serializers
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class **$$serializer { *; }
-keepclasseswithmembers class de.xyourp.antigravitymobile.** {
    *** Companion;
}
-keep,includedescriptorclasses class de.xyourp.antigravitymobile.**$$serializer { *; }
-keepclassmembers @kotlinx.serialization.Serializable class de.xyourp.antigravitymobile.** {
    *** Companion;
    *** INSTANCE;
    kotlinx.serialization.KSerializer serializer(...);
}

# OkHttp — platform classes referenced reflectively
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
