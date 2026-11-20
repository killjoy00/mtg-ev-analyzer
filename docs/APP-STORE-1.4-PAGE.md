# Pack One iOS 1.4 App Store page

New en-US subtitle: Daily Limited Draft Challenge. Name stays Pack One.
Copy source: .github/pack-one-app-store-1.4.json.
A path-scoped GitHub Action applies the localized product information to the specific editable iOS 1.4 record and verifies each field. It does not submit, release or attach a build.

## Native App Store images

Refreshed iOS and Android five-image order: What would you pick?; See the trophy drafter's pick; Three new Dailies every day; See how you stack up; More drafts. More reps.
All five use actual preview-mode native screens with isolated, representative fixture data. iPhone and iPad captions use the deterministic Swift compositor and Android uses FFmpeg framing with matching captions, both without inventing app UI. Keep original iPhone/iPad dimensions and 1080x1920 Android phone output. The Elite subscription review image is not modified for 1.4. The fourth image uses a store-only six-player leaderboard fixture rather than the rarely used Picks to revisit feature. The screenshot-only sample rankings do not affect production or native acceptance tests. Capture again after the November 19 design/copy parity merges; visually inspect all 15 resulting screens before any version-pinned store upload. The main-push capture request is separate from any store upload.

The guarded screenshot upload job can accept a separate 1.4 request naming a successful, source-pinned capture run. Do not create that request until reviewing generated captures on the merged main containing the separate home-copy PR #1616.

## Release gates

Do not submit 1.4 or change release settings as part of product-page work. Verify the signed AdMob privacy manifest and actual App Store Connect privacy disclosures before submitting. Accessibility badge claims require a physical VoiceOver/Dynamic Type verification. Do not remove currently declared data collection merely for marketing.
