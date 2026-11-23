# GitHub Pages allowlist preview (not deployed)

Issue: #1515. Current live Pages configuration is still **_config.yml** on
the repository root. This preview does **not** change Jekyll, Pages settings,
production routing, DNS, API quotas, or authentication.

## Source-only audit

The preview builder, scripts/build-pages-preview.mjs, derives candidate files
from the tracked Git index (not an untracked working directory glob). Root
web files are explicitly enumerated. Public route folders and public
data/corpus formats have narrowly constrained path patterns; directories
containing workflows, server code, SQL, tests, internal documentation,
research, mobile app code and result artifacts are excluded by default.

Run the offline audit:

    node scripts/build-pages-preview.mjs --check

Create a **local, unserved** deterministic preview copy:

    node scripts/build-pages-preview.mjs --out artifacts/pages-preview

The output directory must not already exist, so stale files cannot survive
a later allowlist change. All approved source bytes are copied unchanged
and SHA-256 checked in the return manifest. The regression tests verify
the tracked inventory, mandatory website/auth/deep-link paths, selected
HTML/CSS local references, literal browser-module import dependencies,
output checksums, font license notices, and denied paths.

CI also exercises the candidate at http://127.0.0.1:4174 with the existing
home, set guides, Practice, account/login, ads and profile Playwright
contracts. These tests use local fixtures and the production API guard. They
cover realistic dynamic imports and browser UI behavior while deliberately
avoiding live auth, ad networks and Neon traffic; they are **not** proof of
actual third-party login/ad integration or content delivery parity. The
existing 4173 root regression suite remains intact and runs separately.

The allowed output includes public data/corpus packages intentionally. Do
not blindly exclude these; site/client dependencies must be evaluated
before further reduction. This is a publication-surface reduction, not a
claim of confidential data removal: the repository itself is public.

## Required before changing production Pages source

1. Compare this copied output path-by-path with GitHub's **actual Jekyll
   deployment output**, including handling for .well-known and CNAME.
2. Serve the preview directory and run the site's browser checks against
   that directory, including anonymous play, login/redirect, ads, Elite,
   Admin, Practice, historic and current shares, creator/campaign paths,
   set guides, mobile universal links, and public puzzle/image downloads.
   Computed JS imports and authenticated/network dependencies require
   runtime tests; static reference and literal import checks alone are not enough.
3. Review publication manifest deltas and sample HTTP responses; record
   exact paths, total bytes, and measurable request/cache outcomes.
4. Only then make a separately reversible Pages source/configuration
   change with a rollback plan and protected release acceptance.

This source-only PR must not be mistaken for a published security fix.
## Reversible Jekyll publication candidate (PR #1578)

The existing site uses the branch-root Jekyll publisher; GitHub Pages
cannot consume the copied preview directly without changing repository
Pages-source settings. The candidate keeps that publishing mechanism and
instead adds explicit `_config.yml` exclusions for non-site source trees,
package metadata, reports and internal Markdown. This changes **live Pages
output** once merged; merely opening the PR does not deploy it.

The dedicated `Pages release parity` CI workflow runs GitHub's actual
`jekyll-build-pages` action **without deploying**, then verifies the result
with `scripts/check-pages-jekyll-parity.mjs`. All tracked public files must
be present with byte-for-byte identical contents; all other output is
rejected except an explicitly reviewed Jekyll theme-generated CSS file.
It then validates the actual Jekyll site with the existing isolated browser
and account/ads/Practice fixtures. No production Neon or ad-provider calls
occur in those tests. The PR also probes existing public URLs with
`scripts/verify-pages-production.mjs --baseline` (read-only).

On each successful GitHub Pages deployment, `Pages post-deployment public
allowlist` probes public mobile associations, ads.txt, site/legal/auth
routes and the denylist of development-source URLs. If any denied file is
still publicly served or a required path disappears, the check fails. A
HTML 503 error from the CDN on a non-HTML source URL means the file is currently
inaccessible, but is **not** treated as proof of a 404; the verifier records
a warning. A 200 response, redirect, unexpected error response, or source
content still fails enforcement. The independent Jekyll parity check verifies
that excluded files are absent from the generated site itself.
The underlying GitHub repository remains publicly accessible; this is a
Pages publication-surface reduction, **not removal of repository access**.

### Rollback and limitations

If the new Pages output causes a regression, revert the release PR's
`_config.yml` exclusion additions (restoring `include: [\".well-known\"]`)
and allow GitHub Pages to rebuild from main. Confirm Pages deploy, the
production smoke job and public mobile/ads routes. During rollback the
post-deploy allowlist verification may intentionally fail because the old
publisher serves development files: treat that alarm as expected until the
new exclusions are safely restored. Preserve `CNAME` and `.well-known`
content throughout.

Byte-identical assets and isolated browser fixtures substantially constrain
risk but **cannot authenticate a real user with third-party providers or
render live advertisements in this isolated CI**. Actual sign-in and ad
partner behavior must remain covered by production monitoring and any
future controlled real-account review. Artifact file-size reductions are
not measured CDN cache or transfer-cost reductions.
