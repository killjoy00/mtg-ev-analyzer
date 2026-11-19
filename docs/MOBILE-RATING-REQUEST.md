# Native StoreKit rating request

After a real, current-day iOS Daily result is visible for four uninterrupted
seconds, the app records the completed run locally and may invoke StoreKit's
system-provided rating UI. It never requests ratings while drafting, on
friend/creator runs, in Practice, in preview screenshots, or on Android.

The user must have completed runs on at least three distinct Pacific days.
A run is only counted once; the same app version never requests twice, and
a ninety-day cross-version cooldown is enforced locally. Apple may suppress
the UI independently (annual limits, account settings, TestFlight).
A failure to read/write local state or reach StoreKit never affects gameplay.

The same function has pure gate tests and deliberately does not read scores,
ratings, profile identity, paid membership, or personal information.
