#!/usr/bin/env python3
"""Render two Pack One App Store 1.5 creative placements using real native app captures."""
import io
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from fontTools.ttLib import TTFont

ROOT=Path.cwd()
OUT=ROOT/'reviewed-creatives'
OUT.mkdir(exist_ok=True)
F=OUT/'fonts'
F.mkdir(exist_ok=True)
font_sources={
 'head':'assets/fonts/barlow-condensed-700.woff2',
 'brand':'assets/fonts/barlow-condensed-600.woff2',
 'body':'assets/fonts/source-sans-3-400.woff2',
}
fonts={}
for key,source in font_sources.items():
  face=TTFont(ROOT/source)
  face.flavor=None
  target=F/(key+'.ttf')
  face.save(target)
  fonts[key]=target
def font(key,size):
  return ImageFont.truetype(str(fonts[key]),int(size))

iphone=Image.open(ROOT/'source-native/ios-prior/iphone/01-daily-decision.jpg').convert('RGB')
ipad=Image.open(ROOT/'source-native/ios-prior/ipad/01-daily-decision.jpg').convert('RGB')
android=Image.open(ROOT/'source-native/android/android/03-daily-hub.jpg').convert('RGB')
N=Image.Resampling.LANCZOS
mark=android.crop((127,413,194,483)).resize((145,145),N)
INK='#121e2a';BLUE='#24537e';MUTED='#546371';BG='#f8fafb';RULE='#dce4ea'

def text(d,x,y,value,ft,fill,spacing):
  for line in value.split('\n'):
    d.text((x,y),line,font=ft,fill=fill)
    y+=spacing
def brand(canvas,x,y,scale,title_size):
  canvas.paste(mark.resize((scale,scale),N),(x,y))
  ImageDraw.Draw(canvas).text((x+scale+36,y-4),'Pack One',font=font('brand',title_size),fill=INK)
def panel(canvas,source,position,radius=30,blur=30):
  x,y,w,h=position
  source=source.resize((w,h),N)
  mask=Image.new('L',(w,h),0)
  ImageDraw.Draw(mask).rounded_rectangle((0,0,w-1,h-1),radius=radius,fill=255)
  shade=Image.new('RGBA',canvas.size,(0,0,0,0))
  ImageDraw.Draw(shade).rounded_rectangle((x+15,y+20,x+w+15,y+h+20),radius=radius,fill=(18,43,65,42))
  canvas.alpha_composite(shade.filter(ImageFilter.GaussianBlur(blur)))
  canvas.paste(source,(x,y),mask)
  ImageDraw.Draw(canvas).rounded_rectangle((x,y,x+w-1,y+h-1),radius=radius,outline='#d5e1eb',width=5)

# Product page header, Apple 3840 x 1646.
W,H=3840,1646
hero=Image.new('RGBA',(W,H),BG)
d=ImageDraw.Draw(hero)
d.rectangle((0,0,W-1,14),fill=BLUE)
d.line((206,390,1780,390),fill=RULE,width=4)
brand(hero,213,172,147,118)
d=ImageDraw.Draw(hero)
text(d,215,488,'Real picks from\ntrophy drafts.',font('head',242),INK,242)
text(d,224,1110,'See the earlier picks and the cards in the pack.\nThen see what the trophy drafter took.',font('body',63),MUTED,93)
panel(hero,ipad.crop((200,600,1860,2405)),(2140,35,1520,1610),radius=32,blur=31)
hero=hero.convert('RGB')
assert hero.size==(3840,1646)
hero.save(OUT/'pack-one-15-trophy-header.png',format='PNG',optimize=True)

# Search results, Apple 3840 x 2560.
W,H=3840,2560
search=Image.new('RGBA',(W,H),BG)
d=ImageDraw.Draw(search)
d.rectangle((0,0,W-1,14),fill=BLUE)
brand(search,221,188,169,144)
d=ImageDraw.Draw(search)
d.line((215,460,1760,460),fill=RULE,width=4)
text(d,218,575,'Real trophy drafts.\nWhat would you pick?',font('head',205),INK,232)
text(d,232,1272,'See the earlier picks and the pack.\nThen see what the drafter took.',font('body',72),MUTED,113)
panel(search,iphone.crop((130,860,1190,2450)),(2110,168,1490,2240),radius=37,blur=42)
search=search.convert('RGB')
assert search.size==(3840,2560)
search.save(OUT/'pack-one-15-trophy-search.png',format='PNG',optimize=True)
print('Rendered Pack One trophy-worded 1.5 header and search art in RGB PNG with genuine earlier picks.')
