#!/usr/bin/env python3
"""Rebuild owner-approved November 23 store images from pinned native captures.

Image content comes exclusively from the real native screenshot artifacts.
The output is accepted ONLY if all 18 files exactly match the approved SHA256s.
"""
from pathlib import Path
from io import BytesIO
from hashlib import sha256
import json
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps

BASE=Path.cwd()
ROOT=BASE/'reviewed-store-assets'
OUT={k:ROOT/k for k in ('google-play','iphone','ipad')}
for p in OUT.values(): p.mkdir(parents=True,exist_ok=True)
F=BASE/'approved-fonts'
F.mkdir(exist_ok=True)
font_map={
 'headline':'assets/fonts/barlow-condensed-700.woff2',
 'brand':'assets/fonts/barlow-condensed-600.woff2',
 'body':'assets/fonts/source-sans-3-400.woff2',
 'semibold':'assets/fonts/source-sans-3-600.woff2',
}
for key,source in font_map.items():
  font=TTFont(str(BASE/source))
  font.flavor=None
  font.save(str(F/(key+'.ttf')))
HEAD=str(F/'headline.ttf')
BRAND=str(F/'brand.ttf')
BODY=str(F/'body.ttf')
SEMIBOLD=str(F/'semibold.ttf')
N=Image.Resampling.LANCZOS
BG='#f7f8fa'
INK='#101820'
MUTED='#5f6770'
LINE='#d5dbe1'

class Source:
  def __init__(self,folder):
    self.folder=BASE/'source-native'/folder
  def read(self,path):
    return (self.folder/path).read_bytes()
android=Source('android-store')
android_acc=Source('android-acceptance')
ios=Source('ios-store')
ios_prior=Source('ios-prior')
ios_acc=Source('ios-acceptance')
mark_source=Image.open(BytesIO(android.read('android/03-daily-hub.jpg'))).convert('RGB')
mark=mark_source.crop((127,413,194,483))

def rimg(source,path):
  return Image.open(BytesIO(source.read(path))).convert('RGB')

def type_font(filename,size):
  return ImageFont.truetype(filename,int(size))

def headline_font(value,width,init,minimum):
  size=init
  while size>minimum:
    bounds=ImageDraw.Draw(Image.new('RGB',(10,10))).textbbox((0,0),value,font=type_font(HEAD,size))
    if bounds[2]-bounds[0]<=width: break
    size-=2
  return type_font(HEAD,size)

def subtitle_font(value,width,init,minimum):
  size=init
  while size>minimum:
    bounds=ImageDraw.Draw(Image.new('RGB',(10,10))).textbbox((0,0),value,font=type_font(BODY,size))
    if bounds[2]-bounds[0]<=width: break
    size-=1
  return type_font(BODY,size)

def paste_capture(im,shot,frame,rad,border=True):
  x,y,w,h=frame
  shot=ImageOps.fit(shot,(w,h),method=N,centering=(0.5,0.5))
  shadow=Image.new('RGBA',im.size,(0,0,0,0))
  sd=ImageDraw.Draw(shadow)
  sd.rounded_rectangle((x+7,y+14,x+w+8,y+h+15),radius=rad,fill=(16,24,32,38))
  shadow=shadow.filter(ImageFilter.GaussianBlur(max(9,int(w*0.016))))
  im.alpha_composite(shadow)
  mask=Image.new('L',(w,h),0)
  md=ImageDraw.Draw(mask)
  md.rounded_rectangle((0,0,w-1,h-1),radius=rad,fill=255)
  im.paste(shot,(x,y),mask)
  if border:
    d=ImageDraw.Draw(im)
    d.rounded_rectangle((x,y,x+w-1,y+h-1),radius=rad,outline=LINE,width=max(2,int(w*0.002)))

def compose(platform,index,headline,subtitle,shot):
  if platform=='google-play':
    W,H=1080,1920;logo=(73,49,54);brand=(142,44,42);num=(1005,53,23);rule=(74,118,1006);head=(73,154,90,61);sub=(75,273,31,25);frame=(114,363,852,1515)
  elif platform=='iphone':
    W,H=1320,2868;logo=(92,74,67);brand=(180,70,51);num=(1220,88,29);rule=(92,171,1228);head=(92,226,112,74);sub=(94,371,41,31);frame=(105,505,1110,2320)
  else:
    W,H=2064,2752;logo=(137,95,83);brand=(244,91,66);num=(1928,118,32);rule=(138,218,1928);head=(138,273,164,99);sub=(142,476,52,40);frame=(190,633,1684,2047)
  im=Image.new('RGBA',(W,H),BG)
  d=ImageDraw.Draw(im)
  lx,ly,ls=logo
  im.paste(mark.resize((ls,ls),N),(lx,ly))
  bx,by,bs=brand
  d.text((bx,by),'PACK ONE',font=type_font(BRAND,bs),fill=INK)
  nx,ny,ns=num
  d.text((nx,ny),f'{index:02} / 06',font=type_font(SEMIBOLD,ns),fill=MUTED,anchor='rt')
  d.line((rule[0],rule[1],rule[2],rule[1]),fill=LINE,width=2 if W<=1320 else 3)
  hx,hy,hi,hmin=head
  d.text((hx,hy),headline,font=headline_font(headline,W-2*hx,hi,hmin),fill=INK)
  sx,sy,si,smin=sub
  d.text((sx,sy),subtitle,font=subtitle_font(subtitle,W-2*sx,si,smin),fill=MUTED)
  paste_capture(im,shot,frame,rad=16 if W==1080 else 22 if W==1320 else 25)
  return im.convert('RGB')

google_specs=[
 ('01-real-7-win-drafts.jpg','Real 7-win drafts.','Eight decisions from eight different trophy runs.',android,'android/01-daily-decision.jpg'),
 ('02-see-the-trophy-pick.jpg','See the trophy pick.','Choose your card, then see what the drafter took.',android,'android/02-reveal-comparison.jpg'),
 ('03-eight-picks-one-score.jpg','Eight picks. One score.','See how your run went, pick by pick.',android_acc,'journey-result.png'),
 ('04-three-new-dailies.jpg','Three new Dailies.','Draft Run, Powered Cube and Latest Set.',android,'android/03-daily-hub.jpg'),
 ('05-same-picks-for-everyone.jpg','Same picks for everyone.','Compare scores on the daily leaderboard.',android,'android/04-leaderboard.jpg'),
 ('06-keep-practicing.jpg','Keep practicing.','Regular Draft Run practice is free with an account.',android,'android/05-practice.jpg'),
]
ios_specs=[
 ('01-real-7-win-drafts.jpg','Real 7-win drafts.','Eight decisions from eight different trophy runs.','01-daily-decision.jpg'),
 ('02-see-the-trophy-pick.jpg','See the trophy pick.','Choose your card, then see what the drafter took.','02-reveal-comparison.jpg'),
 ('03-look-back-at-your-picks.jpg','Look back at your picks.','See your choices alongside the trophy drafter.','insights'),
 ('04-three-new-dailies.jpg','Three new Dailies.','Draft Run, Powered Cube and Latest Set.','03-daily-hub.jpg'),
 ('05-same-picks-for-everyone.jpg','Same picks for everyone.','Compare scores on the daily leaderboard.','04-leaderboard.jpg'),
 ('06-keep-practicing.jpg','Keep practicing.','Regular Draft Run practice is free with an account.','05-practice.jpg')
]
for i,(name,headline,subtitle,source,path) in enumerate(google_specs,1):
  shot=rimg(source,path)
  if source==android:
    shot=shot.crop((90,305,990,1905))
  else:
    shot=shot.crop((0,0,1170,2080))
  im=compose('google-play',i,headline,subtitle,shot)
  im.save(OUT['google-play']/name,'JPEG',quality=94,optimize=True,subsampling=0)

for platform in ('iphone','ipad'):
  for i,(name,headline,subtitle,scene) in enumerate(ios_specs,1):
    if scene=='insights':
      shot=rimg(ios_acc,f'{platform}/{platform}-member-insights-insights-large.png')
    else:
      shot=rimg(ios_prior if i==1 else ios,f'{platform}/{scene}')
      if platform=='iphone':
        shot=shot.crop((130,540,1190,2810))
      else:
        shot=shot.crop((208,255 if i==1 else 520,1858,2715))
    im=compose(platform,i,headline,subtitle,shot)
    im.save(OUT[platform]/name,'JPEG',quality=94,optimize=True,subsampling=0)

approved=json.loads((BASE/'.github/pack-one-approved-six-screenshots.json').read_text())
expected=approved['sha256']
actual={}
for platform in ('google-play','iphone','ipad'):
  files=sorted(OUT[platform].glob('*.jpg'))
  if len(files)!=6:
    raise SystemExit(f'Expected six {platform} screenshots, found {len(files)}')
  for p in files:
    key=f'{platform}/{p.name}'
    value=sha256(p.read_bytes()).hexdigest()
    actual[key]=value
    if expected.get(key)!=value:
      raise SystemExit(f'REJECTED image {key}: approved={expected.get(key)} actual={value}')
if set(actual)!=set(expected):
  raise SystemExit('Approved screenshot file list does not match rendered outputs.')
print(json.dumps({'verified':True,'imageCount':len(actual),'iosVersion':'1.5','platforms':{p:6 for p in OUT}},indent=2))
