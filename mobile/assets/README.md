# Pack One mobile artwork

The production app/store icon is committed at:

- `images/icon.png` — 1024×1024 PNG using the Pack One P¹ mark
- `images/brand-mark.svg` — vector outlines from the website's actual header fonts and CSS layout
- `images/header-mark.png` — the website's 36×40 blue header badge, used directly on native Home instead of a Unicode monogram
- `images/adaptive-icon-foreground.png` and `images/adaptive-icon-monochrome.png` — the same mark inside Android's circular safe zone

Expo app config uses this image for production builds.

The icon is intentionally source-controlled so local Xcode/Gradle builds do not depend on an Expo/EAS account or remote asset service. If the icon changes later, replace the PNG deliberately and review it at actual launcher sizes before submission.

Regenerate with `python3 mobile/scripts/generate-brand-icons.py` after installing `fonttools[woff]`, `cairosvg`, and `Pillow`. The generator reads the header's `.brand-mark` styles in `pack1.css` / `visual-c.css` and the self-hosted website WOFF2 files. It preserves the Barlow Condensed P, Source Sans 3 numeral, inherited letter spacing, and superscript offset. Native builds use the committed PNGs without these Python dependencies.
