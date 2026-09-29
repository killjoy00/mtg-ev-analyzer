# Campaign Links owner guide

This is the operating guide for the static campaign-link system and Admin **Campaign Links / Link Builder** added in PR #518.

For acquisition and Daily-habit reporting, see [Launch measurement owner guide](LAUNCH-MEASUREMENT-OWNER-GUIDE.md). For release evidence, see [Campaign links closeout](reports/CAMPAIGN-LINKS-CLOSEOUT-2026-09-25.md).

## 1. What the tool does

Pack One now supports two kinds of campaign links:

1. **Tracked UTM URL** — a normal Pack One URL with `utm_source`, `utm_campaign`, and optional `utm_medium`. This URL can be used immediately.
2. **Static vanity URL** — a short Pack One route such as `https://packone.pro/go/reddit-launch/`. This route redirects to the tracked UTM URL. The Admin **Publish vanity link** button automates the reviewed registry change, generated page, required checks, merge, Pages build, and live-route verification.

The current published example is:

- vanity URL: `https://packone.pro/go/reddit-launch/`
- tracked destination: `https://packone.pro/?utm_source=reddit&utm_campaign=launch-week&utm_medium=social`

The redirect page is intentionally static. It does not call the backend, load analytics, or load advertising code. It redirects the browser to the tracked Pack One destination, where the existing acquisition logic records the visit.

## 2. Open the Admin Link Builder

Open:

`https://packone.pro/admin/?area=campaign-links`

Sign in with an account that has Pack One admin access.

The builder contains:

- **Slug** — optional for tracked-only links; required when you want a short `/go/` vanity URL;
- **Source** — where the visitor came from;
- **Campaign** — the initiative or push being measured;
- **Medium** — optional broad channel type;
- **Destination** — currently the Pack One homepage only.

As you type, the builder shows canonical normalized values, validation messages, the tracked UTM URL, the intended vanity URL, and the JSON entry that belongs in `campaign-links.json`.

The page also loads the checked-in campaign registry and warns if the normalized slug already exists.

## 3. Naming rules

### Slug

A slug must:

- be 1–64 characters;
- use lowercase ASCII letters, digits, and hyphens only;
- start and end with a letter or digit;
- not contain spaces, underscores, slashes, query strings, or path traversal.

The code rule is:

`/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/`

One-character slugs consisting of a letter or digit are valid.

Examples:

- valid: `reddit-launch`
- valid: `newsletter-2`
- invalid: `Reddit-Launch` in checked-in configuration
- invalid: `reddit_launch`
- invalid: `reddit/launch`
- invalid: `-reddit`

The Admin builder trims and lowercases interactive input. Checked-in configuration must already be canonical.

### Source, campaign, and medium

`source` and `campaign` are required. `medium` is optional.

Each value must be 1–40 characters and match:

`/^[a-z0-9][a-z0-9_-]{0,39}$/`

Use lowercase letters, digits, underscores, and hyphens. The first character must be a letter or digit.

Examples:

- valid: `reddit`
- valid: `launch-week`
- valid: `paid_social`
- invalid: `launch week`
- invalid: `r/magictcg`
- invalid: any 41-character value

Do not put names, email addresses, account IDs, usernames, or other personal information into campaign values.

### Destination

The only supported destination today is:

`/`

That means every static campaign link currently lands on the Pack One homepage after adding the UTM parameters.

## 4. Fast workflow: create a tracked link without a deploy

Use this when you do not need a short `/go/` URL.

1. Open the Admin Link Builder.
2. Enter source, campaign, and optional medium. Leave **Slug** blank if you only need the tracked URL.
3. Confirm the source/campaign fields have no validation errors.
4. Copy **Tracked UTM URL**.
5. Share that URL directly.

Example:

`https://packone.pro/?utm_source=reddit&utm_campaign=launch-week&utm_medium=social`

A slug is not required for this tracked-only workflow. No repository change is required when you share only the tracked UTM URL.

After Pack One captures valid acquisition parameters, the existing browser logic removes the `utm_*` parameters from the visible address bar.

## 5. Publish a vanity `/go/<slug>/` link

Use this when you want a stable Pack One-owned short URL.

### One-click Admin workflow

1. Open the Admin Link Builder.
2. Enter the campaign values and a unique slug.
3. Confirm the canonical values are correct.
4. Click **Publish vanity link** once.
5. Keep the page open if you want live status. Admin polls the published registry and changes the message to **Published** only after the deployed route appears.

The browser never receives a GitHub credential. The production growth backend re-checks the account session, CSRF proof, Pack One admin grant and campaign fields, then dispatches only the fixed `.github/workflows/campaign-link-publish.yml` workflow.

That reviewed workflow:

1. starts from current `main`;
2. adds the canonical entry to `campaign-links.json` and regenerates `go/<slug>/index.html`;
3. validates the generated source;
4. pushes an automation-owned branch and opens a pull request to protected `main`;
5. explicitly dispatches the required `test` and `browser` checks for that exact head commit and waits for both to pass;
6. merges only after those checks pass;
7. explicitly requests a GitHub Pages build from merged `main`; and
8. fetches the public vanity URL until the expected redirect page is live.

Do not distribute the vanity URL until Admin says **Published**. The tracked UTM URL remains usable immediately and does not depend on this workflow.

### One-time GitHub repository prerequisite

GitHub Actions must be allowed to create pull requests for this repository:

**Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**

Pack One does not bypass this setting. If it is disabled, the workflow stops after producing the validated automation branch and does not push directly to `main`.

Auto-merge does not need to be enabled. The campaign workflow waits for the required checks itself and then performs the protected merge.

### Recovery-only manual path

If the automation is unavailable, the old manual path remains valid: add the canonical object to `campaign-links.json`, run `node scripts/generate-campaign-links.mjs`, run `node scripts/generate-campaign-links.mjs --check` and `npm test`, then commit the registry and generated page through a normal PR. Do not hand-edit generated redirect HTML.

## 6. What the generator checks

`node scripts/generate-campaign-links.mjs --check` fails when:

- a configured route is missing;
- a generated page is stale;
- a generator-owned `go/<slug>/` directory exists without a matching registry entry.

Normal generation removes orphan directories only when their `index.html` carries the generator marker. It does not broadly delete unrelated directories under `go/`.

The registry validator also rejects:

- unknown fields;
- duplicate slugs;
- non-canonical slugs;
- malformed acquisition values;
- unsupported destinations.

## 7. Retire or change a campaign link

Treat published vanity URLs as durable whenever possible.

### To stop using a campaign but preserve old links

Leave the existing entry and generated route in place. Stop distributing it.

This is the safest option for links that may exist in old posts, messages, bookmarks, or screenshots.

### To remove a vanity route

1. Remove its entry from `campaign-links.json`.
2. Run `node scripts/generate-campaign-links.mjs`.
3. Run `node scripts/generate-campaign-links.mjs --check`.
4. Run `npm test`.
5. Commit the registry change and generated deletion through a normal PR.

After deployment, the old `/go/<slug>/` route will no longer exist.

### To change attribution

Prefer creating a new slug instead of silently changing the UTM meaning of a widely distributed existing vanity URL. Reusing one public vanity URL for a different source or campaign makes historical interpretation harder.

## 8. How the redirect page behaves

Each generated redirect page:

- is a static HTML file;
- uses `location.replace(...)` to send the browser to the tracked destination;
- includes a normal fallback link if JavaScript does not redirect;
- uses Pack One social metadata;
- declares `noindex,nofollow`;
- canonicalizes to the Pack One homepage;
- does not load Pack One application bootstrap code;
- does not load analytics, advertising, or third-party scripts.

Acquisition measurement happens after the visitor reaches the tracked Pack One page.

## 9. Read the results

Campaign links feed the existing first-touch acquisition reporting introduced in PR #505.

Open:

`https://packone.pro/admin/`

Use **Daily habit cohorts** to compare first-Daily people and mature next-day, 7-day, and 3-in-7 outcomes by first touch and campaign.

Remember:

- first touch is sticky;
- a later campaign does not overwrite an earlier first touch;
- `direct`, `pre_tracking`, external-referrer hostnames, and `result_share` have specific meanings;
- immature cohorts are not failures;
- `3-in-7 daily health` is a rolling count, not a conversion rate.

See [Launch measurement owner guide](LAUNCH-MEASUREMENT-OWNER-GUIDE.md) for the full reporting workflow.

## 10. Recommended campaign workflow

For each new push:

1. Choose one stable campaign name.
2. Create one source-specific link per channel.
3. Use a clear slug that will still make sense later.
4. Use the Admin builder to catch normalization and validation problems.
5. Use the tracked URL immediately if speed matters.
6. Click **Publish vanity link**; the reviewed automation owns `campaign-links.json`, generation, required checks, protected merge and Pages publication.
7. Do not change attribution on an already distributed vanity URL.
8. Read mature outcomes rather than reacting to very small or immature cohorts.

Example family:

- `/go/reddit-launch/` → source `reddit`, campaign `launch-week`, medium `social`
- `/go/discord-launch/` → source `discord`, campaign `launch-week`, medium `social`
- `/go/newsletter-launch/` → source `newsletter`, campaign `launch-week`, medium `email`

Using one campaign name across sources lets the owner compare the same initiative without collapsing the acquisition source.

## 11. Troubleshooting

### The builder says a slug already exists

Use a new slug. Duplicate slugs are rejected by the checked-in registry validator.

### Copy buttons are disabled

Fix the inline validation errors first. Copying the JSON entry is also disabled when the slug duplicates an existing published entry.

### Publish is accepted but the vanity URL never becomes live

Do not distribute the URL yet. Check the **publish Pack One campaign link** workflow. The most common configuration failure is that GitHub Actions is still forbidden from creating pull requests. The workflow fails safely rather than writing directly to `main`.

If a PR exists, confirm its required `test` and `browser` checks passed, the PR merged, and the Pages build completed. The Admin message changes to **Published** only after the deployed registry contains the slug.

### The vanity URL returns 404

Treat the route as unpublished. Confirm the slug appears in the deployed `campaign-links.json` and that the generated `go/<slug>/index.html` reached the successful Pages build.

### The tracked URL works but no campaign row appears yet

The link can be functioning before there is enough qualifying product activity to create a useful cohort. Acquisition is best-effort browser-side; Daily habit outcomes come from completed stored Daily sessions.

### The generator check fails

Run the generator without `--check`, inspect the resulting config/page changes, then run `--check` and `npm test` again. Do not manually patch generated redirect HTML to make the check pass.
