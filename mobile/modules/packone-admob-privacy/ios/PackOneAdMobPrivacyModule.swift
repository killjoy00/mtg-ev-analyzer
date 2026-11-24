import AppTrackingTransparency
import ExpoModulesCore
import GoogleMobileAds

public class PackOneAdMobPrivacyModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PackOneAdMobPrivacy")

    AsyncFunction("mayStart") {
      self.mayStart()
    }.runOnQueue(.main)

    AsyncFunction("prepare") {
      guard self.mayStart() else { return false }
      MobileAds.shared.requestConfiguration.setPublisherFirstPartyIDEnabled(false)
      MobileAds.shared.disableMediationInitialization()
      return true
    }.runOnQueue(.main)

    AsyncFunction("allowBanner") {
      self.mayStart()
    }.runOnQueue(.main)
  }

  private func mayStart() -> Bool {
    switch ATTrackingManager.trackingAuthorizationStatus {
    case .denied, .restricted, .notDetermined: return true
    case .authorized: return false
    @unknown default: return false
    }
  }
}
