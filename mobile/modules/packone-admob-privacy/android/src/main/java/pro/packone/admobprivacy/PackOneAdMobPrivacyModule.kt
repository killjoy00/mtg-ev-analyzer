package pro.packone.admobprivacy

import com.google.android.gms.ads.MobileAds
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues

class PackOneAdMobPrivacyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PackOneAdMobPrivacy")

    AsyncFunction("mayStart") { true }

    AsyncFunction("prepare") {
      val context = appContext.reactContext?.applicationContext ?: return@AsyncFunction false
      MobileAds.disableMediationAdapterInitialization(context)
      true
    }.runOnQueue(Queues.MAIN)

    // Google requires initialization before changing this preference.
    AsyncFunction("allowBanner") {
      MobileAds.putPublisherFirstPartyIdEnabled(false)
    }.runOnQueue(Queues.MAIN)
  }
}
