# Pack One brand and marketing assets

> **Canonical entry point.** If you need to know what Pack One looks like or which committed files to reuse, start here. This document indexes the identity already in production; it does not define a new one.

Pack One intentionally keeps working assets where the product and release tooling already use them. Do **not** move or duplicate them into `assets/brand/` just to make this directory self-contained.

## Quick answer

| Need | Use |
| --- | --- |
| Canonical P¹ vector | `mobile/assets/images/brand-mark.svg` |
| P¹ raster for composed graphics | `mobile/assets/images/header-mark.png` |
| Native/store app icon | `mobile/assets/images/icon.png` |
| Website/header treatment | `index.html` + `visual-c.css` |
| Web brand fonts | `fonts.css` + `assets/fonts/` |
| Native brand fonts | `mobile/assets/fonts/` + `mobile/src/components/BrandFonts.tsx` |
| Current general OG image | `social-preview-v6.png` |
| Editable/source form for the shallow OG banner | `assets/pack-one-share-banner-v1.svg` |
| Beat the Creator social renderer | `scripts/generate-creator-social-card.py` |
| Native/store screenshot pipeline | `.github/workflows/mobile-store-screenshots.yml` + `mobile/scripts/capture-store-screenshots-*.sh` |

## How to resolve apparent conflicts

Use this order instead of guessing from filenames:

1. This guide for the canonical role of each asset.
2. `visual-c.css` and current product-specific CSS such as `daily-home.css` for production visual tokens.
3. `index.html` plus `visual-c.css` for the live website/header identity.
4. `fonts.css` and the committed font files for typography.
5. `docs/DESIGN-SYSTEM.md` for the product-level visual rationale.
6. Collateral-specific generators or source files for that collateral only.

`pack1.css` is still an imported compatibility/base stylesheet, but `visual-c.css` overrides its older green, rounded-card system with the live light Pack One treatment. Do not treat an old `pack1.css` value as canonical merely because its variable name sounds global.

## Logo and identity

### P¹ mark

The P¹ mark is the reusable Pack One symbol. Canonical committed forms are:

- **Vector:** `mobile/assets/images/brand-mark.svg` — outlined glyphs derived from the website's actual header fonts and CSS geometry.
- **Header raster:** `mobile/assets/images/header-mark.png` — a raster export of the live header badge geometry, used directly by native Home and appropriate for raster composition.
- **Native/store icon:** `mobile/assets/images/icon.png` — the 1024×1024 app/store icon generated from the same identity.
- **Public web icon:** `pack-one-icon-v1.png` — the current public favicon/apple-touch/Twitter image URL. It is distribution collateral with a stable public role, not the master source for new logo work.

`mobile/scripts/generate-brand-icons.py` is the deterministic generation path for the vector mark and native raster exports. It reads the header's `.brand-mark` rules from `pack1.css` / `visual-c.css` and the repo-owned fonts. `mobile/assets/README.md` documents that native asset contract.

**Do not recreate or approximate P¹ with a Unicode superscript, arbitrary font, hand-drawn replacement, or host-installed typeface.** A branded generator should consume `brand-mark.svg` when vector input is supported or `header-mark.png` when raster composition is simpler.

Use **P¹ alone** where the product name is already clear or the surface is icon-sized: app/launcher icons, favicon/avatar-like uses, compact badges, or an already-branded layout.

Use **P¹ + Pack One** for a primary standalone brand impression: site/header branding, marketing graphics, store/listing collateral, and social artwork that may be seen away from Pack One.

### Pack One wordmark treatment

The canonical wordmark treatment is the live product treatment rather than a separate logo file: the name **Pack One** is set in **Barlow Condensed 600** beside the P¹ badge. See the `.brand-mark` + `.brand-copy` markup in `index.html` and the corresponding rules in `visual-c.css`.

Casing can follow the current component: the website header uses `Pack One`; the current Beat the Creator scorecard uses `PACK ONE`. The underlying family/weight and relationship to P¹ are the important identity signals.

`assets/pack-one-share-banner-v1.svg` is a current shallow-banner source/reference whose outlined wordmark uses Source Sans 3 Bold. That is an **asset-specific distribution treatment**, not a second master wordmark. New general brand work should start from the live header treatment or an existing branded generator rather than copying the banner outlines.

## Typography

Pack One uses two repo-owned families:

| Role | Family / weight | Web files | Native files |
| --- | --- | --- | --- |
| Headings, wordmark, scores | Barlow Condensed 600–700 | `assets/fonts/barlow-condensed-600.woff2`, `assets/fonts/barlow-condensed-700.woff2` | `mobile/assets/fonts/BarlowCondensed-Semibold.ttf`, `mobile/assets/fonts/BarlowCondensed-Bold.ttf` |
| Reading text and controls | Source Sans 3 400–700 | `assets/fonts/source-sans-3-400.woff2`, `assets/fonts/source-sans-3-600.woff2`, `assets/fonts/source-sans-3-700.woff2` | `mobile/assets/fonts/SourceSans3-Regular.ttf`, `mobile/assets/fonts/SourceSans3-Semibold.ttf`, `mobile/assets/fonts/SourceSans3-Bold.ttf` |

`fonts.css` is the web `@font-face` contract. Native loading is in `mobile/src/components/BrandFonts.tsx`.

Branded generators must use these committed fonts. Do not silently substitute DejaVu, Liberation, Arial, a generic system sans, or whatever happens to be installed on a runner for final Pack One collateral.

If a renderer requires TTF input, use a committed native TTF when that is the intended platform input or follow the deterministic repo-owned conversion pattern in `scripts/generate-creator-social-card.py`: load the WOFF2 with `fonttools[woff]`, clear the WOFF flavor, and save a temporary TTF. The creator publication workflow pins those renderer dependencies; it does not depend on host fonts.

## Canonical palette

These are semantic production colors from the live light implementation:

| Use | Value | Production source |
| --- | --- | --- |
| Page | `#f7f8fa` | `visual-c.css --page` |
| Surface | `#ffffff` | `visual-c.css --surface` |
| Soft surface | `#edf1f5` | `visual-c.css --surface-soft` |
| Ink | `#101820` | `visual-c.css --ink` |
| Muted text | `#5f6770` | `visual-c.css --muted` |
| Fine rule | `#d5dbe1` | `visual-c.css --line` |
| Strong rule | `#9ca5ac` | `visual-c.css --line-strong` |
| Primary Pack One blue | `#1e4d7a` | `visual-c.css --green` / `--blue` |
| Dark Pack One blue | `#15395b` | `visual-c.css --green-dark` |
| Soft Pack One blue | `#e5edf4` | `visual-c.css --green-soft` / `--blue-soft` |
| Powered Cube accent | `#976822` | `daily-home.css` Powered Cube row |

The `--green` variable name is historical; its live value is Pack One blue. Powered Cube's brown/gold is an environment accent, not a replacement brand color. Other environment accents remain component-owned; read the current production component CSS instead of promoting every local color into a global palette.

The shallow social banner currently contains an asset-local `#f8f7f2` background. That is not the canonical page token and should not replace `#f7f8fa` in new product or marketing work.

## Look and feel

Pack One's established direction is a **light tournament scorecard**:

- clean, light page and white surfaces;
- clear numbering and score hierarchy;
- compact competitive display typography;
- fine rules and restrained borders;
- P¹ / Pack One identity used deliberately rather than repeatedly as decoration;
- restrained environment accents;
- gameplay card art used as product content, not decorative branding.

Preserve the existing guidance against introducing unrelated generic fantasy imagery, decorative MTG art as brand identity, AI-looking illustration, glassmorphism, gratuitous gradients, unrelated font systems, or generic startup/SaaS visual language.

This is not a rule that every surface must look identical. Reuse the identity, typography, palette, spacing/rule language, and existing production patterns appropriate to the surface.

## Asset inventory

### Canonical reusable brand assets

| Asset | Role |
| --- | --- |
| `mobile/assets/images/brand-mark.svg` | Master reusable vector P¹ mark. |
| `mobile/assets/images/header-mark.png` | Raster P¹ header badge for composed graphics/native UI. |
| `mobile/assets/images/icon.png` | Native/store app icon. |
| `mobile/assets/images/adaptive-icon-foreground.png` | Android adaptive foreground generated from the mark. |
| `mobile/assets/images/adaptive-icon-monochrome.png` | Android monochrome adaptive mark. |
| `assets/fonts/*.woff2` + `fonts.css` | Canonical web font sources and declarations. |
| `mobile/assets/fonts/*.ttf` | Bundled native font files. |
| `index.html` + `visual-c.css` | Canonical live header/wordmark composition and production design tokens. |

Do not duplicate these binaries into `assets/brand/`. Their existing paths are production inputs.

### Current generated/distribution collateral

| Asset/tool | Role |
| --- | --- |
| `assets/pack-one-share-banner-v1.svg` | Editable/source representation for the current shallow general share banner; collateral-specific, not the identity master. |
| `social-preview-v6.png` | Current 1200×240 Open Graph image used by homepage, Daily share routes, and generated campaign redirects. |
| `pack-one-icon-v1.png` | Current public web icon used for favicon/apple-touch and compact Twitter sharing. |
| `scripts/generate-creator-social-card.py` | Canonical Beat the Creator renderer. It reads the P¹ header mark, repo-owned fonts, and production palette sources and emits 1200×630 OG plus 1080×1080 square scorecards. |
| `creator/<slug>/creator-card.png`, `creator/<slug>/creator-card-square.png` | Per-publication creator collateral. Treat these as generated outputs, never as logo masters. A route can retain the output from the generator version that originally published it until intentionally republished. |
| `.github/workflows/mobile-store-screenshots.yml` | Generates current native store screenshot artifacts from production screens and deterministic fixtures. |
| `mobile/scripts/capture-store-screenshots-ios.sh`, `mobile/scripts/capture-store-screenshots-android.sh` | Platform capture tools for store screenshots. |
| `docs/mobile-store-submission.md` | Current store-submission asset requirements and review boundaries. |
| `.github/workflows/app-store-screenshots.yml`, `.github/workflows/google-play-listing-assets.yml` | Guarded distribution paths for reviewed screenshot/icon assets. |

Store screenshots are generated/reviewed release artifacts, not reusable identity masters. Recreate them through the established screenshot tooling when product UI changes; do not use screenshots as source artwork for a new brand asset.

### Historical / superseded collateral

The following root social previews remain committed as release history but have been superseded by `social-preview-v6.png` for live metadata:

- `social-preview.png`
- `social-preview-v2.png`
- `social-preview-v3.jpg`
- `social-preview-v4.jpg`
- `social-preview-v5.png`

Repository history shows these were successive preview revisions, and current default-branch metadata/tests point to v6. They have no current live-reference role on `main`; retain them as historical release evidence unless a separate cleanup proves deletion is safe.

Do not infer that every old-looking asset is deprecated. Historical mobile evidence under `docs/mobile-evidence/` and store-delivery records are audit/release evidence and should remain historical evidence.

## Concrete usage examples

### Website/header branding

Start with `index.html`:

```html
<span class="brand-mark" aria-hidden="true"><span>P</span><sup>1</sup></span>
<span class="brand-copy"><strong>Pack One</strong></span>
```

Then use `visual-c.css` for the live dimensions, blue field, Barlow/Source Sans relationship, spacing, and wordmark sizing. Do not screenshot the header to manufacture another logo file.

### General social / Open Graph graphic

For the current generic share treatment, inspect:

- `assets/pack-one-share-banner-v1.svg` for the committed shallow-banner source/reference;
- `social-preview-v6.png` for the currently served raster;
- `index.html` and `campaign-links.mjs` for current social metadata.

If creating a new class of social artwork, reuse the canonical P¹ asset and repo-owned fonts rather than tracing `social-preview-v6.png` or approximating it.

### Beat the Creator

Use `scripts/generate-creator-social-card.py` as the concrete branded-generator example. It already:

- composites `mobile/assets/images/header-mark.png`;
- converts the canonical WOFF2 fonts deterministically rather than using host fonts;
- reads the live Pack One color tokens from the production CSS;
- uses the tournament-scorecard hierarchy;
- emits dedicated OG and square formats.

The generated files under `creator/<slug>/` are distribution outputs. Change the generator when the shared template intentionally changes; do not hand-edit a published PNG and treat it as a new brand source.

### Native/app icon and store collateral

For the native identity, start with `mobile/assets/README.md`, `mobile/scripts/generate-brand-icons.py`, and `mobile/assets/images/icon.png`. `mobile/app.config.ts` consumes the committed native artwork.

For store screenshots, use the capture workflow/scripts and `docs/mobile-store-submission.md`. Store screenshot artifacts reflect the current product UI; they are not a separate design system.

## Checklist for a new branded generator

Before merging a new Pack One marketing generator:

1. Consume a canonical P¹ asset instead of recreating the mark.
2. Use the committed Barlow Condensed / Source Sans 3 files; fail clearly if required brand inputs are unavailable.
3. Read or deliberately mirror current production tokens instead of copying old `pack1.css` defaults.
4. Keep the light scorecard hierarchy unless the existing product surface gives a better directly-supported pattern.
5. Keep environment color subordinate to Pack One identity.
6. Make output deterministic and test dimensions/inputs where it becomes publication or release infrastructure.
7. Document any new reusable output here instead of creating another hidden source of truth.

## Related documentation

- `docs/DESIGN-SYSTEM.md` — concise product visual direction and UI rationale.
- `mobile/assets/README.md` — native icon/mark generation contract.
- `docs/mobile-store-submission.md` — store image requirements and current submission process.

When brand implementation changes intentionally, update this guide in the same change so future work does not have to rediscover the identity across the repository.
