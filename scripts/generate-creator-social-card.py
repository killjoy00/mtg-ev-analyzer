#!/usr/bin/env python3
import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W,H=1200,630

def font(size,bold=False):
    candidates=[
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate,size)
    return ImageFont.load_default()

def fit(draw,text,max_width,start,bold=False):
    size=start
    while size>28:
        f=font(size,bold)
        if draw.textbbox((0,0),text,font=f)[2] <= max_width:
            return f
        size-=2
    return font(size,bold)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--output",required=True)
    p.add_argument("--creator",required=True)
    p.add_argument("--score",required=True,type=int)
    p.add_argument("--environment",required=True)
    p.add_argument("--source-type",required=True,choices=["practice","daily"])
    p.add_argument("--source-day",default="")
    args=p.parse_args()
    if not (0<=args.score<=100):
        raise SystemExit("score must be 0-100")
    label={"mixed":"Draft Run","powered-cube":"Powered Cube","latest":"Latest Set"}.get(args.environment)
    if not label:
        raise SystemExit("invalid environment")
    image=Image.new("RGB",(W,H),"#101416")
    draw=ImageDraw.Draw(image)
    draw.rounded_rectangle((58,54,W-58,H-54),radius=28,fill="#171d20",outline="#425158",width=2)
    draw.text((96,92),"PACK ONE",font=font(30,True),fill="#d9e3e7")
    draw.text((96,147),"BEAT THE CREATOR",font=font(24,True),fill="#d7b56d")
    title=f"Can you beat {args.creator}?"
    draw.text((96,205),title,font=fit(draw,title,1005,58,True),fill="#ffffff")
    draw.text((96,310),f"{args.score}/100",font=font(92,True),fill="#ffffff")
    source=f"{label} {'Daily' if args.source_type=='daily' else 'Practice'}"
    if args.source_type=="daily" and args.source_day:
        source += f" · {args.source_day}"
    draw.text((96,430),source,font=font(30,False),fill="#bcc8cd")
    draw.text((96,500),"Play the same eight draft decisions.",font=font(31,True),fill="#d7b56d")
    Path(args.output).parent.mkdir(parents=True,exist_ok=True)
    image.save(args.output,format="PNG",optimize=True)

if __name__=="__main__":
    main()
