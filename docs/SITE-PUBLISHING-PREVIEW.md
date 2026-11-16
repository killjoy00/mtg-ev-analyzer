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