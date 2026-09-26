# Native shared-run continuity acceptance

Tracker: #575. Implementation: #620, building on #611, #612, #613, #615, #616 and #617.

## Product contract

A shared invitation identifies stored decisions, not a request to generate another random run. Native preview, authentication, acceptance, gameplay, comparison, retry and reopening must retain that distinction.

- Modern 24-character share links open `shared-run`. Historical 12-character challenges keep their separate canonical-web continuation.
- Preview alone does not start a run. The player explicitly accepts; the server checks access and returns the authoritative run UUID.
- SecureStore associates the share and server UUID with the exact player and account. A failed GET of a known UUID never falls back to a new POST.
- A lost start response is retried through the server's shared-start recovery; no client practice idempotency key is introduced.
- Gameplay uses the existing DraftRun screen and the server's revision, puzzle, answer and comparison payloads. Shared runs cannot reroll.
- Successful secure-session persistence returns an initiating sign-in to the same invitation. Optional account, profile or catalog enrichment does not determine authentication success.
- Home's **Your last shared run** entry finds this device's last checkpoint for the current account. It does not require reopening the original link and does not automatically redirect every cold launch.
- A saved partial run reopens its latest feedback before continuing. Completed runs reopen their result; creator reopening does not invent an opponent.
- Pre-pick prior-pool zoom does not select or submit a pick.

## Automated evidence and its limits

Run `npm test` from `mobile/`. The existing lifecycle, DraftRun and secure-storage suites remain required. `test:shared-run-screen` adds actual-screen tests for invitation acceptance, authentication return, UUID recovery, ambiguous responses, account/route races, result sharing, pool zoom and Home-based discovery. Root tests retain the pure recovery coordinator and URL normalization contracts.

The mounted tests compile production screen and storage modules, mocking platform/navigation boundaries and API transport. They are not physical-device tests. The Apple browser-handoff fixture is not an iOS native-Apple sign-in test. Server uniqueness and committed result persistence require the separate isolated backend smoke from #615; a client mock does not establish those properties.

The current storage primitive retains one last shared-run checkpoint per device, owner-scoped. Older invitations can still recover their server run through explicit acceptance. This is not a locally indexed history of all shared invitations.

Record exact source SHA, PR merge ref, workflow attempt, test counts and native artifact identities in #575. A passed source PR does not establish production gateway deployment, signed store delivery or physical acceptance.

## Physical acceptance still required on the exact integrated RC

- Open a regular and Powered Cube invitation from a message on iPhone, iPad and Android. Verify narrow HTTPS association and that invalid links do not start a Daily.
- Preview as a guest, sign in using email, Google, iOS native Apple and Android browser Apple as applicable, then return to the original invitation. Check cancel and Back navigation and slow optional enrichment.
- Accept, play several decisions, background/foreground while feedback is visible, and return from the native share sheet without losing state.
- Kill the app, launch from its icon, choose **Your last shared run** on Home, and verify the same server UUID and answers without a new start. Repeat after completing the run and after upgrading the RC.
- Simulate a response lost after server start and after a committed pick. Verify one server run, correct recovered feedback and no duplicate result/event.
- Switch accounts during preview, start and pick. Verify the previous account's data never becomes the new account's run. Repeat sign-out/sign-in with the same account.
- Reopen as the creator and as a recipient. Verify original creator result, exact win/loss/tie comparison and unchanged no-reroll rules.
- Check pool zoom, VoiceOver/TalkBack labels, large text and representative iPad layouts.

Do not mark these device checks complete from CI alone. Keep the broader product-parity and release gates in #575 open until their independent evidence is recorded.
