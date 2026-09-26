# Pack One web/native parity matrix

Updated 2026-09-25.

## Release rule

Pack One mobile v1 is a native presentation of the same user product as `packone.pro`, not a reduced companion app. A user-facing web capability must have one of these outcomes before the first public mobile release:

1. **Native parity** — the same authoritative feature exists in native.
2. **Canonical-web continuation** — native intentionally opens the same Pack One web resource when duplicating it would create legal/security drift.
3. **Explicit external blocker** — the feature cannot be enabled safely until an identified store/account configuration is completed.

Anything else is a release-blocking parity defect.

The server remains authoritative for gameplay, scoring, identity, ranking, career, entitlement, and stored friend-run state. Native must not fork those rules.

## Product surfaces

| Web surface / behavior | Native v1 equivalent | Parity state |
| --- | --- | --- |
| Three fixed Dailies | Native Daily home + Draft Run | Native parity |
| Daily completion ordering / View result | Daily home reads authoritative Daily status | Native parity |
| Daily streak and Pacific reset cue | Daily home | Native parity |
| Guest Daily play | Draft Run | Native parity |
| Save/validate guest Daily after sign-in | Draft Run -> Account -> result validation | Native parity |
| Regular practice | Practice | Native parity |
| Powered Cube practice | Practice | Native parity |
| Custom-set practice | Practice set picker | Native parity |
| Practice set/pack rerolls | Draft Run | Native parity |
| Card zoom | Draft Run | Native parity |
| Your Pick vs Trophy Pick reveal | Draft Run feedback | Native parity |
| Model-supported alternatives / Why this score? | Draft Run feedback analysis | Native parity |
| Revealed pack + prior-pool review | Draft Run feedback | Native parity |
| Review all eight completed decisions | Draft Run result review | Native parity |
| Daily/share result text | Native share sheet | Native parity |
| Stored practice share / friend run | Native shared-run invite + exact stored replay | Native parity |
| Shared-run comparison scores | Native invite/result flow | Native parity |
| Today leaderboard | Leaderboard | Native parity |
| This week leaderboard | Leaderboard | Native parity |
| This season leaderboard | Leaderboard | Native parity |
| All-time leaderboard | Leaderboard | Native parity |
| Current-season label/date context | Leaderboard + My Pack One | Native parity |
| Public profile from leaderboard | Player Profile | Native parity |
| Career snapshot | My Pack One | Native parity |
| Recent performance | My Pack One | Native parity |
| Best environments | My Pack One | Native parity |
| Achievements + locked progress | My Pack One | Native parity |
| Showcase achievement | My Pack One + Account settings | Native parity |
| Daily history | My Pack One | Native parity |
| Archive progress | My Pack One | Native parity |
| Shared-run W/L/T record | My Pack One | Native parity |
| Paginated game history | My Pack One | Native parity |
| Share public profile / record | My Pack One | Native parity |
| Edit leaderboard/display name | Account | Native parity |
| Resolve username-taken / username-required | Account | Native parity |
| Public profile toggle | Account | Native parity |
| Favorite environment | Account | Native parity |
| Email/password sign-up/sign-in | Account | Native parity |
| Google sign-in | Account | Native parity |
| Sign in with Apple | Account | Native parity |
| Sign out | Account | Native parity |
| Account deletion | Account | Native parity |
| Forgot-password request | Account | Native parity |
| Verification-email resend | Account | Native parity |
| Signed-in password change + revoke all sessions | Account | Native parity |
| Password-reset credential completion | Pack One reset page opened from the email | Canonical-web continuation until verified web-link association is complete; reset credentials are not sent through an unverified custom URL scheme |
| Existing Patreon/Elite status | Account | Native parity |
| Connect existing Patreon membership | Account | Native parity |
| Refresh Patreon access | Account | Native parity |
| Disconnect Patreon | Account | Native parity |
| Patreon join/upgrade purchase CTA | Not active in the store build yet | Explicit external blocker: digital-feature purchase steering must not be enabled until applicable App Store storefront handling and Google Play external-content-links enrollment/integration are configured |
| Revealed-card TCGplayer links | Why this score? comparison | Native parity |
| Daily-home TCGplayer fallback | Daily home, using the same Patreon `ads_allowed` suppression | Native parity |
| Google display advertising | No native ad SDK | Current parity because Google delivery is disabled on web; enabling web/native Google ads is a separate reviewed release |
| How to Play | How to Play | Native parity |
| Scoring | Scoring | Native parity |
| Method | Method | Native parity |
| Live Sets catalog | Sets | Native parity |
| MSH editorial set archive | Set Archive | Native parity |
| ECL editorial set archive | Set Archive | Native parity |
| TMT editorial set archive | Set Archive | Native parity |
| SOS editorial set archive | Set Archive | Native parity |
| Learn hub | Learn | Native parity |
| First-pick discipline guide | Limited Guide | Native parity |
| Reading consensus guide | Limited Guide | Native parity |
| Staying open guide | Limited Guide | Native parity |
| Card strength vs. deck fit guide | Limited Guide | Native parity |
| About Pack One | About & Support | Native parity |
| Support contact | About & Support | Native parity |
| Partnership contact | About & Support | Native parity |
| Privacy Policy | Canonical `packone.pro/privacy/` opened from native | Canonical-web continuation to keep legal copy single-source |
| Terms | Canonical `packone.pro/terms/` opened from native | Canonical-web continuation to keep legal copy single-source |
| Disclosure | Canonical `packone.pro/disclosure/` opened from native | Canonical-web continuation to keep legal copy single-source |

## Link parity

Native recognizes the Pack One web links that correspond to product surfaces instead of silently routing them home:

- Daily / leaderboard URLs
- public profile URLs
- stored friend/shared-run URLs
- How to Play, Scoring, Method, Sets
- Learn and all four published guide URLs
- four published set archive URLs
- About / Contact
- Privacy / Terms / Disclosure

The binary also declares:

- iOS Associated Domain: `applinks:packone.pro`
- Android verified HTTPS intent: `https://packone.pro/*`

Production verification still requires the hosted domain association files. Do not fabricate them:

- Apple AASA requires the real Apple Team ID.
- Android `assetlinks.json` requires the Google Play **app-signing** certificate SHA-256, not the upload-key certificate.

Until those values are obtained from the store accounts, HTTPS links continue to work in the browser and the app's internal rewrite contract remains tested, but Universal Links / Android App Links are not considered externally verified.

## iPad parity

iPad is a first-class v1 surface. `ios.supportsTablet=true` stays enabled.

Parity implementation uses bounded content widths for home, account, career/profile, Learn/articles, Sets/set archives, leaderboards, and shared-run invitation surfaces. Physical iPad acceptance remains required for:

- portrait and landscape layout
- touch targets
- card grid / zoom
- long article and profile surfaces
- authentication / deletion
- share sheet
- external link handoffs
- no clipping or unusable excessive-width layouts

## Not part of end-user mobile parity

These web/repository surfaces are operational rather than consumer product features and are not copied into the app:

- Admin
- campaign-link builder
- measurement/analytics reports
- corpus operations / publication controls
- release workflows
- maintenance controls
- internal review / QA utilities

Their absence from native is intentional and must not be counted as a user-product parity defect.

## Release evidence

A parity item is not complete merely because code exists. Before public release, evidence must show:

1. all parity PRs are merged to current `main`;
2. repository test, E2E, mobile, iOS, and Android gates are green;
3. a fresh iOS 1.0 TestFlight RC and Android 1.0 Play RC are built from that exact current main;
4. representative iPhone, iPad, and Android physical-device acceptance passes;
5. exact stored friend links and public profile links work;
6. store-account link-association identifiers are configured and verified;
7. the Patreon purchase CTA remains disabled unless the required store program/configuration is explicitly completed.
