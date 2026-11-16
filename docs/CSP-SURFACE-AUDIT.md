# Pack One CSP source audit (no policy deployed)

Issue: #1515. This is the **first stage of CSP hardening**, not a
Content-Security-Policy enforcement change or a Content-Security-Policy-
Report-Only header. GitHub Pages does not allow arbitrary HTTP response
headers through its Jekyll config; adding a `<meta http-equiv="Content-
Security-Policy-Report-Only">` would not be a valid substitute.

## How the inventory works

Run `node scripts/audit-site-csp.mjs`. It uses the same tracked-file
allowlist as the actual Pages parity job, limiting scanning to intended
public pages, CSS and JavaScript. The output is a machine-readable
`artifacts/site-csp-audit.json` artifact plus a CI summary.

The scanner records:

- Inline `<script>` text sizes and exact SHA-256 CSP hash expressions,
  page-specific `<style>` blocks, inline style and on-event attributes.
- External script references and literal HTTPS origins in approved site
  source. An origin is a *hint*, not a necessary or safe CSP source.
- Source-code occurrences of dynamic script creation, `.src` assignment,
  dynamic `import()`, HTML sinks, `document.write`, `eval`, `Function`,
  workers and popup creation. These are review leads, not confirmed
  vulnerabilities.
- Existing meta CSP policies, if any.

The scanner is intentionally not a full HTML parser, AST, runtime
dependency graph, CSP enforcement policy, or authenticated vulnerability
test. It can find URLs in comments and cannot see runtime-calculated
ad/auth URLs, injected frames, Web Workers or external script behavior.

## Before any real CSP header

1. Review and classify each *required runtime* origin by CSP directive
   (`script-src`, `connect-src`, `img-src`, `frame-src`, `style-src`,
   `font-src`); treat ad, Patreon, auth popup and Neon API paths as
   separate test cases. Reject unknown origins instead of blanket
   wildcard grants.
2. Verify exact inline script hashes and computed injection paths for
   homepage, account/Elite, Practice, Ads, admin, creator/share and
   mobile deep links. Include both Chromium and WebKit.
3. Make the first experiment a real HTTP
   `Content-Security-Policy-Report-Only` **header in an isolated
   preview/edge environment only**, with redacted, aggregated reports
   and no user identifiers. Do not add a misleading meta report-only
   policy to GitHub Pages.
4. Compare observed violations with known-good guest, authenticated,
   ads-enabled and ad-free flows. Only then plan independently
   reversible enforcement, preserving `upgrade-insecure-requests` and
   adding appropriate `object-src`/`base-uri` restrictions.

This audit sends no requests to production auth, Neon, ad networks or
Vercel. It does not change public-site delivery.
