"""Render the website header's actual P¹ glyphs and CSS layout for native icons.

Run from any directory after installing fonttools[woff], cairosvg, and Pillow.
The committed PNGs are build inputs; native builds do not run this generator.
"""
from pathlib import Path
from io import BytesIO
from math import ceil, floor
import re

import cairosvg
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'mobile/assets/images'


def declarations(path, selector):
    css = (ROOT / path).read_text()
    match = re.search(re.escape(selector) + r'\s*\{([^}]+)\}', css)
    if not match:
        raise ValueError(f'Missing website selector {selector}')
    return dict(re.findall(r'([\w-]+)\s*:\s*([^;]+);', match[1]))


def px(value):
    if not value.endswith('px'):
        raise ValueError(f'Expected website pixel measurement: {value}')
    return float(value[:-2])


base = declarations('pack1.css', '.brand-mark')
mark = declarations('visual-c.css', '.brand-mark')
p_style = declarations('visual-c.css', '.brand-mark > span')
one_style = declarations('visual-c.css', '.brand-mark > sup')
width, height = px(mark['width']), px(mark['height'])
gap = px(mark['gap'])
tracking = float(base['letter-spacing'].removesuffix('em')) * px(base['font-size'])
background = declarations('visual-c.css', ':root')['--green']

# The website selects Source Sans 3's available 700 face for its CSS weight 900.
# Preserve its real glyph, rather than substituting a superscript Unicode glyph.
glyphs = []
for source, character, size, top in [
    ('assets/fonts/barlow-condensed-600.woff2', 'P', px(p_style['font-size']), 0),
    ('assets/fonts/source-sans-3-700.woff2', '1', px(one_style['font-size']), px(one_style['top'])),
]:
    font = TTFont(ROOT / source)
    name = font.getBestCmap()[ord(character)]
    paths = SVGPathPen(font.getGlyphSet())
    font.getGlyphSet()[name].draw(paths)
    scale = size / font['head'].unitsPerEm
    line_top = (height - size) / 2 + top
    metrics = font['hhea']
    baseline = line_top + (size - (metrics.ascent - metrics.descent) * scale) / 2 + metrics.ascent * scale
    # Browser flex geometry is quantized to 1/64 CSS pixel.
    advance = ceil((font['hmtx'][name][0] * scale + tracking) * 64) / 64
    glyphs.append((paths.getCommands(), scale, baseline, advance))

x = (height - width) / 2 + floor((width - sum(g[3] for g in glyphs) - gap) * 32) / 64
paths = []
for commands, scale, baseline, advance in glyphs:
    paths.append(f'<path transform="translate({x:.6f} {baseline:.6f}) scale({scale:.6f} {-scale:.6f})" d="{commands}"/>')
    x += advance + gap
art = ''.join(paths)


def svg(adaptive=False):
    bg = '' if adaptive else f'<rect width="{height:g}" height="{height:g}" fill="{background}"/>'
    # Keep the same glyph proportions inside Android's circular safe zone.
    transform = f' transform="translate({height * .05:g} {height * .05:g}) scale(.9)"' if adaptive else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 {height:g} {height:g}">'
            f'{bg}<g fill="#fff"{transform}>{art}</g></svg>')


OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'brand-mark.svg').write_text(svg() + '\n')
for filename, adaptive in [('icon.png', False), ('adaptive-icon-foreground.png', True), ('adaptive-icon-monochrome.png', True)]:
    png = cairosvg.svg2png(bytestring=svg(adaptive).encode(), output_width=4096, output_height=4096)
    image = Image.open(BytesIO(png)).resize((1024, 1024), Image.Resampling.LANCZOS)
    image = image.convert('RGBA' if adaptive else 'RGB')
    image.save(OUT / filename)
    if adaptive:
        alpha = image.getchannel('A')
        for y in range(1024):
            for x in range(1024):
                if alpha.getpixel((x, y)) > 32:
                    assert (x - 512) ** 2 + (y - 512) ** 2 <= (1024 * 66 / 108 / 2) ** 2, 'mark exceeds Android safe zone'
    print(f'{filename}: {image.size}, {image.mode}')
