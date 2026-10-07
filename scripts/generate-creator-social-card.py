#!/usr/bin/env python3
"""Render deterministic Pack One creator-challenge social images from repo-owned brand assets."""

import argparse
import re
import tempfile
from datetime import date
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

try:
    from fontTools.ttLib import TTFont
except ImportError as exc:
    raise SystemExit(
        "Pack One creator cards require fonttools[woff]; install the pinned creator renderer dependencies."
    ) from exc


ROOT = Path(__file__).resolve().parents[1]
BRAND_MARK = ROOT / "mobile/assets/images/header-mark.png"
FONT_SOURCES = {
    ("display", 600): ROOT / "assets/fonts/barlow-condensed-600.woff2",
    ("display", 700): ROOT / "assets/fonts/barlow-condensed-700.woff2",
    ("body", 400): ROOT / "assets/fonts/source-sans-3-400.woff2",
    ("body", 600): ROOT / "assets/fonts/source-sans-3-600.woff2",
    ("body", 700): ROOT / "assets/fonts/source-sans-3-700.woff2",
}
OG_SIZE = (1200, 630)
SQUARE_SIZE = (1080, 1080)
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def required(path: Path, label: str) -> Path:
    if not path.is_file():
        raise SystemExit(f"Missing Pack One {label}: {path.relative_to(ROOT)}")
    return path


def css_color(path: Path, variable: str) -> str:
    text = required(path, "style source").read_text(encoding="utf-8")
    match = re.search(rf"{re.escape(variable)}\s*:\s*(#[0-9a-fA-F]{{6}})", text)
    if not match:
        raise SystemExit(f"Missing Pack One color token {variable} in {path.relative_to(ROOT)}")
    return match.group(1).lower()


def cube_accent() -> str:
    path = required(ROOT / "daily-home.css", "Powered Cube style source")
    text = path.read_text(encoding="utf-8")
    match = re.search(
        r'daily-home-game\[data-environment="powered-cube"\]\s*\{[^}]*border-left-color\s*:\s*(#[0-9a-fA-F]{6})',
        text,
    )
    if not match:
        raise SystemExit("Missing Pack One Powered Cube accent in daily-home.css")
    return match.group(1).lower()


def palette() -> dict[str, str]:
    visual = ROOT / "visual-c.css"
    pack = ROOT / "pack1.css"
    return {
        "page": css_color(visual, "--page"),
        "surface": css_color(visual, "--surface"),
        "surface_soft": css_color(visual, "--surface-soft"),
        "ink": css_color(visual, "--ink"),
        "muted": css_color(visual, "--muted"),
        "line": css_color(visual, "--line"),
        "line_strong": css_color(visual, "--line-strong"),
        "blue": css_color(visual, "--green"),
        "blue_soft": css_color(visual, "--green-soft"),
        "cube": cube_accent(),
        "latest": css_color(pack, "--red"),
    }


class RepositoryFonts:
    def __init__(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="packone-social-fonts-")
        self._paths: dict[tuple[str, int], Path] = {}
        self._cache: dict[tuple[str, int, int], ImageFont.FreeTypeFont] = {}
        for key, source in FONT_SOURCES.items():
            required(source, "font")
            target = Path(self._tmp.name) / f"{key[0]}-{key[1]}.ttf"
            try:
                font = TTFont(source, recalcTimestamp=False)
                font.flavor = None
                font.save(target, reorderTables=False)
                font.close()
            except Exception as exc:
                raise SystemExit(
                    f"Could not load Pack One font {source.relative_to(ROOT)}; fonttools[woff] is required."
                ) from exc
            self._paths[key] = target

    def get(self, family: str, weight: int, size: int) -> ImageFont.FreeTypeFont:
        key = (family, weight, size)
        if key not in self._cache:
            self._cache[key] = ImageFont.truetype(
                self._paths[(family, weight)],
                size=size,
                layout_engine=ImageFont.Layout.BASIC,
            )
        return self._cache[key]

    def close(self):
        self._tmp.cleanup()


def text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> int:
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0]


def split_token(draw, token, font, max_width):
    parts, current = [], ""
    for char in token:
        candidate = current + char
        if current and text_width(draw, candidate, font) > max_width:
            parts.append(current)
            current = char
        else:
            current = candidate
    if current:
        parts.append(current)
    return parts or [token]


def wrap_text(draw, text, font, max_width):
    lines: list[str] = []
    current = ""
    for raw in str(text).split():
        tokens = split_token(draw, raw, font, max_width)
        for index, token in enumerate(tokens):
            candidate = token if not current else f"{current} {token}"
            if text_width(draw, candidate, font) <= max_width:
                current = candidate
            else:
                if current:
                    lines.append(current)
                current = token
            if index < len(tokens) - 1 and current:
                lines.append(current)
                current = ""
    if current:
        lines.append(current)
    return lines or [""]


def fit_wrapped(draw, fonts, text, max_width, max_lines, start, minimum, weight=700):
    for size in range(start, minimum - 1, -1):
        font = fonts.get("display", weight, size)
        lines = wrap_text(draw, text, font, max_width)
        if len(lines) <= max_lines:
            return font, lines
    raise SystemExit("Creator challenge headline cannot fit the Pack One social-card layout.")


def draw_lines(draw, xy, lines, font, fill, spacing):
    x, y = xy
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        box = draw.textbbox((x, y), line or "Ag", font=font)
        y += (box[3] - box[1]) + spacing
    return y


def source_day_label(value: str) -> str:
    if not value:
        return ""
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise SystemExit("source-day must be YYYY-MM-DD") from exc
    return f"{MONTHS[parsed.month - 1]} {parsed.day}, {parsed.year}"


def challenge_context(environment: str, source_type: str, source_day: str):
    environments = {
        "mixed": ("DRAFT RUN", "blue"),
        "powered-cube": ("POWERED CUBE", "cube"),
        "latest": ("LATEST SET", "latest"),
    }
    if environment not in environments:
        raise SystemExit("invalid environment")
    environment_label, accent_key = environments[environment]
    if source_type == "daily":
        day = source_day_label(source_day)
        if not day:
            raise SystemExit("Daily creator cards require source-day")
        source_label = f"DAILY · {day.upper()}"
    elif source_type == "practice":
        source_label = "PRACTICE RUN"
    else:
        raise SystemExit("invalid source type")
    return environment_label, source_label, accent_key


def mark_image(height: int) -> Image.Image:
    mark = Image.open(required(BRAND_MARK, "P¹ header mark")).convert("RGBA")
    width = round(mark.width * (height / mark.height))
    return mark.resize((width, height), Image.Resampling.LANCZOS)


def draw_brand(image, draw, fonts, colors, x, y, mark_height, wordmark_size):
    mark = mark_image(mark_height)
    image.alpha_composite(mark, (x, y))
    wordmark_x = x + mark.width + 18
    wordmark = fonts.get("display", 600, wordmark_size)
    draw.text((wordmark_x, y + round(mark_height * 0.04)), "PACK ONE", font=wordmark, fill=colors["ink"])
    body = fonts.get("body", 600, max(16, round(wordmark_size * 0.38)))
    draw.text(
        (wordmark_x + 1, y + round(mark_height * 0.61)),
        "DRAFT DECISION CHALLENGE",
        font=body,
        fill=colors["muted"],
    )


def draw_score(draw, fonts, colors, x, y, score):
    label = fonts.get("body", 700, 18)
    draw.text((x, y), "CREATOR SCORE", font=label, fill=colors["muted"])
    number = fonts.get("display", 700, 128)
    suffix = fonts.get("display", 600, 48)
    score_text = str(score)
    score_y = y + 24
    draw.text((x, score_y), score_text, font=number, fill=colors["ink"])
    width = text_width(draw, score_text, number)
    draw.text((x + width + 10, score_y + 66), "/100", font=suffix, fill=colors["muted"])


def draw_context(draw, fonts, colors, x, y, width, environment_label, source_label, accent_key):
    accent = colors[accent_key]
    draw.rectangle((x, y, x + 4, y + 104), fill=accent)
    draw.line((x + 22, y, x + width, y), fill=colors["line"], width=1)
    eyebrow = fonts.get("body", 700, 16)
    environment_font = fonts.get("display", 700, 34)
    source_font = fonts.get("body", 600, 18)
    draw.text((x + 22, y + 15), "CHALLENGE RUN", font=eyebrow, fill=colors["muted"])
    draw.text((x + 22, y + 38), environment_label, font=environment_font, fill=accent)
    draw.text((x + 22, y + 78), source_label, font=source_font, fill=colors["muted"])


def render_og(args, fonts, colors):
    image = Image.new("RGBA", OG_SIZE, colors["page"])
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, OG_SIZE[0], 4), fill=colors["blue"])
    draw_brand(image, draw, fonts, colors, 72, 38, 58, 39)
    draw.line((72, 122, 1128, 122), fill=colors["line_strong"], width=1)

    eyebrow = fonts.get("body", 700, 18)
    draw.text((72, 154), "BEAT THE CREATOR", font=eyebrow, fill=colors["blue"])
    title_font, title_lines = fit_wrapped(draw, fonts, args.headline, 1056, 3, 62, 38)
    draw_lines(draw, (72, 180), title_lines, title_font, colors["ink"], 2)

    environment_label, source_label, accent_key = challenge_context(
        args.environment, args.source_type, args.source_day
    )
    draw.line((72, 350, 1128, 350), fill=colors["line"], width=1)
    draw_score(draw, fonts, colors, 72, 374, args.score)
    draw_context(draw, fonts, colors, 515, 382, 613, environment_label, source_label, accent_key)

    draw.rectangle((72, 555, 1128, 556), fill=colors["line_strong"])
    cta = fonts.get("body", 700, 24)
    draw.text((72, 577), "Play the same 8 draft decisions", font=cta, fill=colors["blue"])
    domain = fonts.get("body", 600, 19)
    domain_text = "packone.pro"
    draw.text((1128 - text_width(draw, domain_text, domain), 581), domain_text, font=domain, fill=colors["muted"])
    return image.convert("RGB")


def render_square(args, fonts, colors):
    image = Image.new("RGBA", SQUARE_SIZE, colors["page"])
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, SQUARE_SIZE[0], 5), fill=colors["blue"])
    draw_brand(image, draw, fonts, colors, 70, 52, 66, 44)
    draw.line((70, 148, 1010, 148), fill=colors["line_strong"], width=1)

    eyebrow = fonts.get("body", 700, 19)
    draw.text((70, 190), "BEAT THE CREATOR", font=eyebrow, fill=colors["blue"])
    title_font, title_lines = fit_wrapped(draw, fonts, args.headline, 940, 3, 76, 44)
    draw_lines(draw, (70, 220), title_lines, title_font, colors["ink"], 4)

    environment_label, source_label, accent_key = challenge_context(
        args.environment, args.source_type, args.source_day
    )
    draw.line((70, 500, 1010, 500), fill=colors["line"], width=1)
    draw_score(draw, fonts, colors, 70, 548, args.score)
    draw_context(draw, fonts, colors, 520, 564, 490, environment_label, source_label, accent_key)

    draw.rectangle((70, 925, 1010, 926), fill=colors["line_strong"])
    cta = fonts.get("body", 700, 28)
    draw.text((70, 956), "Play the same 8 draft decisions", font=cta, fill=colors["blue"])
    domain = fonts.get("body", 600, 21)
    draw.text((70, 1001), "packone.pro", font=domain, fill=colors["muted"])
    return image.convert("RGB")


def save_png(image: Image.Image, path: str):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, format="PNG", optimize=True)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, help="1200×630 Open Graph PNG")
    parser.add_argument("--square-output", help="1080×1080 square PNG")
    parser.add_argument("--creator", required=True)
    parser.add_argument("--headline", default="")
    parser.add_argument("--score", required=True, type=int)
    parser.add_argument("--environment", required=True, choices=["mixed", "powered-cube", "latest"])
    parser.add_argument("--source-type", required=True, choices=["practice", "daily"])
    parser.add_argument("--source-day", default="")
    args = parser.parse_args()
    if not 0 <= args.score <= 100:
        raise SystemExit("score must be 0-100")
    args.creator = str(args.creator).strip()
    if not args.creator:
        raise SystemExit("creator is required")
    args.headline = str(args.headline).strip() or f"Can you beat {args.creator}?"
    return args


def main():
    args = parse_args()
    colors = palette()
    fonts = RepositoryFonts()
    try:
        save_png(render_og(args, fonts, colors), args.output)
        if args.square_output:
            save_png(render_square(args, fonts, colors), args.square_output)
    finally:
        fonts.close()


if __name__ == "__main__":
    main()
