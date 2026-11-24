type AdMobPrivacyModule = {
  mayStart: () => Promise<boolean>;
  prepare: () => Promise<boolean>;
  allowBanner: () => Promise<boolean>;
};

export async function loadAdMobPrivacyQa() {
  const { requireOptionalNativeModule } = await import('expo');
  return requireOptionalNativeModule<AdMobPrivacyModule>('PackOneAdMobPrivacy');
}

export async function mayOpenAdMobPrivacyChoices() {
  const privacy = await loadAdMobPrivacyQa();
  return privacy?.mayStart();
}
