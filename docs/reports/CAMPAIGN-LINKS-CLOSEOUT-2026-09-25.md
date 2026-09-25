# Campaign links release closeout — 2026-09-25

## Outcome

The static Pack One campaign-link system and Admin **Campaign Links / Link Builder** are implemented, merged, deployed, and accepted in production.

PR #518, **Add static campaign links and admin link builder**, merged to `main` as:

`1f0df9bd1f26e304a7bd737d2a869ddcb4700de1`

The release adds a reviewed static `/go/<slug>/` route system backed by `campaign-links.json`, deterministic generation, an Admin link builder, shared acquisition validation, tests, and the first published link:

`https://packone.pro/go/reddit-launch/`

Its tracked destination is:

`https://packone.pro/?utm_source=reddit&utm_campaign=launch-week&utm_medium=social`

No backend, database, DNS, credential, Cloudflare, or GitHub workflow changes were part of PR #518.

## What shipped

### Static campaign registry

The root `campaign-links.json` file is the source of truth for published vanity routes.

The initial registry contains one entry:

```json
{
  "slug": "reddit-launch",
  "destination": "/",
  "source": "reddit",
  "campaign": "launch-week",
  "medium": "social"
}
```

Configuration is validated before generation. Unknown fields, duplicate slugs, malformed values, and unsupported destinations are rejected.

### Shared validation

`campaign-links.mjs` is shared by the generator, Admin builder, tests, and browser acquisition normalization.

Acquisition values use:

`/^[a-z0-9][a-z0-9_-]{0,39}$/`

They are 1–40 characters, begin with a letter or digit, and use lowercase letters, digits, underscores, or hyphens.

Campaign slugs use:

`/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/`

They are 1–64 characters, lowercase, and use letters, digits, and internal hyphens.

Interactive builder input is trimmed and lowercased. Checked-in configuration must already be canonical.

### Deterministic route generation

`scripts/generate-campaign-links.mjs` turns each registry entry into:

`go/<slug>/index.html`

The generated page:

- redirects with `location.replace(...)`;
- provides a normal fallback link;
- uses first-party Pack One social metadata;
- sets `noindex,nofollow`;
- canonicalizes to the Pack One homepage;
- contains no external scripts;
- does not bootstrap the Pack One app, analytics, or advertising.

The generator has a `--check` mode that fails on missing, stale, or orphan generated routes. Normal generation deletes only orphan directories carrying the generator marker.

### Admin Campaign Links / Link Builder

The Admin navigation now includes **Campaign Links** at:

`https://packone.pro/admin/?area=campaign-links`

The builder:

- accepts slug, source, campaign, optional medium, and destination;
- shows canonical normalized values;
- shows inline validation errors;
- previews the tracked UTM URL;
- previews the intended vanity URL;
- produces the exact JSON registry entry;
- copies the tracked URL, vanity URL, or JSON entry;
- loads the current checked-in campaign registry;
- warns when the normalized slug already exists;
- prevents copying a duplicate JSON entry;
- states explicitly that copying/building does not publish the vanity route.

The current destination set intentionally supports only the homepage (`/`).

### Runtime acquisition alignment

`bootstrap.mjs` now uses the same `normalizeAcquisitionValue` implementation as the campaign-link tooling instead of carrying a separate acquisition regex.

That keeps runtime capture, Admin validation, checked-in configuration, and tests aligned on the same acquisition-value contract.

## Tests and release evidence

The first #518 PR test run passed:

- test **36147466125** — success.

The corresponding first E2E run **36147466132** failed only in the new Admin browser contract because the test used a label selector whose accessible name changed when inline validation text was present. Product behavior was not changed; the test was narrowed to stable field-name selectors.

The final PR rerun then passed:

| Gate | Run |
| --- | --- |
| Test | **36148044301** |
| Browser / E2E | **36148044296** |

PR #518 was then merged as `1f0df9bd1f26e304a7bd737d2a869ddcb4700de1`.

Post-merge verification passed:

| Gate | Run |
| --- | --- |
| GitHub Pages build/deploy | **36148541521** |
| Production smoke | **36148542621** |
| Test | **36148542614** |
| Browser / E2E | **36148542654** |

The final E2E run completed successfully on attempt 2. The Pages deployment built and deployed the exact #518 merge revision. Production smoke successfully fetched `https://packone.pro/` and completed its production contract checks.

This environment did not independently perform a manual browser fetch of the custom-domain `/go/reddit-launch/` route because direct custom-domain resolution was unavailable here. The release claim is instead grounded in the exact-revision Pages deployment, the committed generated route, the route-generation/unit coverage, the Admin browser contract, and the successful production smoke for the deployed site. No manual live-route check is being represented as completed.

## Scope boundary

PR #518 changed only static/browser/test/package surfaces:

- `admin/admin.css`
- `admin/admin.mjs`
- `admin/campaign-links.mjs`
- `admin/index.html`
- `bootstrap.mjs`
- `campaign-links.json`
- `campaign-links.mjs`
- `go/reddit-launch/index.html`
- `package.json`
- `scripts/generate-campaign-links.mjs`
- `tests/admin-e2e.mjs`
- `tests/campaign-links.test.mjs`

It did not change:

- Neon Functions;
- database schema or migrations;
- DNS;
- Cloudflare configuration;
- credentials or secrets;
- GitHub Actions workflow files.

## Relationship to launch measurement

PR #518 is a frontend/operator layer on top of the acquisition measurement shipped in PR #505.

The vanity page itself does not record attribution. It redirects to the tracked Pack One homepage URL. The existing Pack One acquisition code then captures valid UTM values and the launch-measurement backend reports first-touch and Daily habit outcomes.

This preserves the existing measurement semantics:

- first touch remains sticky;
- later campaigns do not replace earlier first touch;
- malformed acquisition values are rejected;
- `result_share` keeps its existing path;
- `direct` and `pre_tracking` retain their existing meanings;
- completed Daily sessions remain authoritative for habit outcomes.

## Operational boundary

The Admin builder is a link construction and validation tool, not a publishing service.

A tracked UTM URL can be copied and used immediately.

A vanity `/go/<slug>/` URL is published only after:

1. its entry is committed to `campaign-links.json`;
2. `scripts/generate-campaign-links.mjs` generates the static page;
3. the generated page is committed;
4. the normal site PR merges;
5. the matching GitHub Pages deployment succeeds.

This boundary is deliberate: published vanity routes remain reviewable, deterministic, and versioned in Git.

## Known limitations

- Static campaign destinations currently support only the homepage.
- Publishing a vanity route requires a repository change and Pages deployment.
- The Admin builder does not write to GitHub or publish automatically.
- Removing a registry entry and regenerating will remove that generator-owned route after deployment; old distributed links should therefore usually be preserved.
- Acquisition capture is browser-side and best-effort; habit outcomes are based on stored Daily completions.

## Documentation

The release is documented in:

- [Campaign Links owner guide](../CAMPAIGN-LINKS-OWNER-GUIDE.md) — day-to-day creation, publication, retirement, validation, and troubleshooting;
- [Launch measurement owner guide](../LAUNCH-MEASUREMENT-OWNER-GUIDE.md) — attribution and habit-report interpretation;
- [Decision quality reporting](../DECISION-MEASUREMENTS.md) — measurement definitions and owner-report behavior;
- [Current state](../CURRENT-STATE.md) — verified production boundary.

## Final state

As of this closeout:

- PR #518 is merged;
- exact merge revision `1f0df9bd1f26e304a7bd737d2a869ddcb4700de1` is deployed through GitHub Pages;
- the production smoke, post-merge test, and final post-merge E2E are green;
- `https://packone.pro/go/reddit-launch/` is the first committed vanity route;
- the Admin Campaign Links builder is part of the deployed Admin surface;
- runtime and builder acquisition validation share one implementation;
- no backend/database/DNS/credential/workflow migration was required;
- no known release blocker remains.
