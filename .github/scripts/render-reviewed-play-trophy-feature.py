#!/usr/bin/env python3
"""Rebuild the reviewed Pack One trophy-draft feature image from genuine native captures.

Only background, Pack One branding, headline and framed native screenshot are composed;
all card images and Earlier picks come from recorded app screenshots. No synthetic UI.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageFilter
from fontTools.ttLib import TTFont
import hashlib, json

ROOT=Path.cwd()
OUT=ROOT/'reviewed-play-feature'
OUT.mkdir(exist_ok=True)
F=OUT/'fonts'
F.mkdir(exist_ok=True)
N=Image.Resampling.LANCZOS

sources={
  'head':'assets/fonts/barlow-condensed-700.woff2',
  'brand':'assets/fonts/barlow-condensed-600.woff2',
  'body':'assets/fonts/source-sans-3-400.woff2',
}
for name,path in sources.items():
    face=TTFont(str(ROOT/path))
    face.flavor=None
    face.save(str(F/(name+'.ttf')))

# Both images were pinned to successful native-screenshot GitHub Actions artifacts.
ipad=Image.open(ROOT/'source-native/ios-prior/ipad/01-daily-decision.jpg').convert('RGB')
android=Image.open(ROOT/'source-native/android/android/03-daily-hub.jpg').convert('RGB')
# Match the crops used for the reviewed November 23 design.
source=ipad.crop((200,600,1860,2670)).resize((800,998),N)
logo=android.crop((127,413,194,483)).resize((145,145),N)

W,H,S=1024,500,3
im=Image.new('RGB',(W*S,H*S),'#f7f9fb')
d=ImageDraw.Draw(im)
ink='#111e2b'
blue='#275681'
muted='#536574'
rule='#dce4e9'
d.rectangle((0,0,W*S,5*S),fill=blue)
im.paste(logo.resize((70*S,70*S),N),(58*S,52*S))
brand_font=ImageFont.truetype(str(F/'brand.ttf'),49*S)
d.text((148*S,57*S),'Pack One',font=brand_font,fill=ink,stroke_width=0)
d.line((59*S,153*S,530*S,153*S),fill=rule,width=2*S)

head=ImageFont.truetype(str(F/'head.ttf'),82*S)
d.text((58*S,196*S),'Real picks from',font=head,fill=ink)
d.text((58*S,273*S),'trophy drafts.',font=head,fill=ink)
body=ImageFont.truetype(str(F/'body.ttf'),27*S)
d.text((61*S,407*S),'What would you take?',font=body,fill=muted)

src=source.crop((12,24,800,905))
x,y,x2,y2=(552,15,1013,489)
w,h=x2-x,y2-y
shadow=Image.new('RGBA',im.size,(0,0,0,0))
sd=ImageDraw.Draw(shadow)
sd.rounded_rectangle(((x+8)*S,(y+12)*S,(x2+8)*S,(y2+12)*S),
                     radius=25*S,fill=(27,61,91,54))
shadow=shadow.filter(ImageFilter.GaussianBlur(18*S))
im=Image.alpha_composite(im.convert('RGBA'),shadow)
shot=ImageOps.fit(src,(w*S,h*S),method=N,centering=(0.5,0.15))
mask=Image.new('L',(w*S,h*S),0)
ImageDraw.Draw(mask).rounded_rectangle((0,0,w*S-1,h*S-1),radius=22*S,fill=255)
im.paste(shot,(x*S,y*S),mask)
d=ImageDraw.Draw(im)
d.rounded_rectangle((x*S,y*S,(x2-1)*S,(y2-1)*S),
                    radius=22*S,outline='#d7e3eb',width=2*S)
im=im.convert('RGB').resize((W,H),N)

png=OUT/'pack-one-feature-trophy-1024x500.png'
jpg=OUT/'pack-one-feature-trophy-1024x500.jpg'
im.save(png,optimize=True)
im.save(jpg,quality=95,subsampling=0,optimize=True)

approved=json.loads((ROOT/'.github/google-play-trophy-feature-request.json').read_text())
for file,key in [(png,'pngSha256'),(jpg,'jpegSha256')]:
    with Image.open(file) as x:
      if x.size!=(1024,500) or x.mode!='RGB':
          raise SystemExit(f'Not an approved 1024x500 opaque RGB image: {file}')
    sha=hashlib.sha256(file.read_bytes()).hexdigest()
    print(f'RENDERED_FEATURE {file.name} sha256={sha}')
    if approved[key]!=sha:
        raise SystemExit(f'REJECTED feature image: {key} expected {approved[key]} but got {sha}. Nothing will be uploaded.')
print('Both reviewed feature image checksums verified.')
