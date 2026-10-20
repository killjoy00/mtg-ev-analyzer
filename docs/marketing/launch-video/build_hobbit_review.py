#!/usr/bin/env python3
"""Build an honest Pack One / The Hobbit (HOB) launch-video review cut.

All card images are genuine Scryfall card renders from set HOB. These are
illustrative cards, never represented as a real pack, live run, trophy pick,
player score, or Reality Fracture footage. The narration is an original,
third-person synthetic studio voice (not a clone of the creator).
"""
from __future__ import annotations

import json
import math
import re
import subprocess
import time
import urllib.parse
import urllib.request
import wave
import zipfile
from pathlib import Path

import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "pack-one-launch-editable-project.zip"
WORK = ROOT / "_hobbit_video_work"
OUTPUT = ROOT
ART = WORK / "hobbit_art"
FRAMES = WORK / "frames"
SOUND = WORK / "audio"
WIDTH, HEIGHT, FPS = 1920, 1080, 24
VOICE = "am_michael"
VOICE_SPEED = 1.04
INK, MUTED, BLUE = "#101820", "#5f6770", "#1e4d7a"
DARK, PAGE, LINE, SOFT = "#15395b", "#f7f8fa", "#d5dbe1", "#e5edf4"
CARD_NAMES = [
    "Bilbo, Luckwearer",
    "Smaug the Magnificent",
    "Thorin, Mountain-king",
    "Riddles in the Dark",
    "Wood Elves",
    "Lake-town Lookout",
    "Bombur, Gentle Dreamer",
    "Dori, Bearer of Friends",
    "Silvan Reveler",
    "Mirkwood Pathmaker",
    "Thranduil, Sindarin Liege",
    "Elven Raft-Steerer",
]
SCENES = [
    dict(id="01", kind="hook", title="What would\nyou take?", kicker="THE FUN PART OF DRAFTING",
         blurb="One pick can get a whole draft group talking.",
         narration="Quick question. When you open a draft pack, how long does it take you to decide what you'd pick? That's the fun part for me.", hold=2.1),
    dict(id="02", kind="thinking", title="The fun is\nin the decision.", kicker="WHY PACK ONE EXISTS",
         blurb="Look at the options. Make your call. See a different perspective.",
         narration="I love looking at a pack, weighing a couple of options, and finding out what another drafter would have done. It's a surprisingly fun thing to practice.", hold=1.0),
    dict(id="03", kind="brand", title="So I built\nPack One.", kicker="EIGHT PICKS. YOUR CALL.",
         blurb="A daily drafting game, focused on individual pick decisions.",
         narration="That's why I built Pack One. It's a daily game around those individual decisions, without asking you to sit through an entire draft.", hold=1.3),
    dict(id="04", kind="eight", title="8 separate picks.\n8 trophy drafts.", kicker="HERE'S HOW IT WORKS",
         blurb="Each decision starts in a different real trophy draft.",
         narration="Each challenge has eight picks from eight different real trophy drafts. Not eight picks from the same draft. Eight separate situations, each with its own context.", hold=1.4),
    dict(id="05", kind="gallery", title="Make your pick.\nThen compare.", kicker="THE REVEAL",
         blurb="See the pack and the cards the original drafter already took.",
         narration="You see the pack and what that player had already drafted. You make your choice, lock it in, and then find out what the trophy drafter actually picked.", hold=1.5),
    dict(id="06", kind="two", title="Disagreement\nis the point.", kicker="WHY IT'S INTERESTING",
         blurb="Sometimes you match. Sometimes you'd still take something else.",
         narration="Sometimes you match their pick. Sometimes you still like your own choice better. Either way, there's something to think about, and maybe something to argue about with friends.", hold=1.2),
    dict(id="07", kind="share", title="Share your result.", kicker="BRING YOUR DRAFT GROUP",
         blurb="A score to compare. A few picks worth discussing.",
         narration="At the end, you get a score and a Share button. Send it to your draft group and see who made the same calls. A different pick doesn't automatically mean it was a bad one.", hold=1.4),
    dict(id="08", kind="daily", title="3 new Dailies.\nEvery day.", kicker="CHOOSE YOUR TABLE",
         blurb="Draft Run  /  Powered Cube  /  Latest Set",
         narration="There are three new Dailies every day. Draft Run, Powered Cube, and Latest Set. You can play one or try all three.", hold=1.5),
    dict(id="09", kind="cta", title="Eight picks.\nYour call.", kicker="TRY PACK ONE",
         blurb="packone.pro",
         narration="If you like drafting, give Pack One a try. Pick your cards, share your result, and tell me which decision you found the hardest. I'd really like to hear what you think.", hold=3.5),
]
MODEL_DIR = WORK / "voice"
MODEL_FILE = MODEL_DIR / "kokoro-v1.0.int8.onnx"
VOICES_FILE = MODEL_DIR / "voices-v1.0.bin"

def call(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)

def get(url: str, attempts: int = 4) -> bytes:
    for n in range(attempts):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "PackOneVideoProduction/2.0 (public card art preview; github.com/killjoy00/mtg-ev-analyzer)",
                "Accept": "application/json, image/jpeg, image/png, */*",
            })
            with urllib.request.urlopen(req, timeout=35) as response:
                return response.read()
        except Exception as e:
            if n == attempts - 1:
                raise RuntimeError(f"Download failed: {url}: {e}") from e
            time.sleep((n + 1) * 1.7)
    raise RuntimeError("retry exhausted")

def ensure_source() -> None:
    for directory in (WORK, ART, FRAMES, SOUND, MODEL_DIR):
        directory.mkdir(parents=True, exist_ok=True)
    if not (WORK / "assets/SourceSans3-Regular.ttf").exists():
        with zipfile.ZipFile(SOURCE) as z:
            for entry in z.namelist():
                if entry.startswith("assets/"):
                    z.extract(entry, WORK)

def acquire_cards() -> list[tuple[str, Path]]:
    cards = []
    for i, name in enumerate(CARD_NAMES):
        path = ART / f"{i:02d}.jpg"
        meta = ART / f"{i:02d}.json"
        if not path.exists() or path.stat().st_size < 10000:
            query = urllib.parse.urlencode({"exact": name, "set": "hob"})
            info = json.loads(get(f"https://api.scryfall.com/cards/named?{query}"))
            if info.get("set") != "hob":
                raise ValueError(f"{name}: source set is not HOB")
            images = info.get("image_uris") or next((face.get("image_uris") for face in info.get("card_faces", []) if face.get("image_uris")), {})
            url = images.get("large") or images.get("normal")
            if not url or not url.startswith("https://"):
                raise ValueError(f"Missing official card image for {name}")
            path.write_bytes(get(url))
            meta.write_text(json.dumps({"name": info.get("name"), "set": info["set"], "scryfall_uri": info.get("scryfall_uri"),
                                        "image_url": url, "id": info.get("id")}, indent=2) + "\n")
            time.sleep(0.12)
        # Verify image file is valid, not a 403 HTML response or fake art.
        with Image.open(path) as im:
            im.verify()
        cards.append((name, path))
    if len(cards) != len(CARD_NAMES):
        raise RuntimeError("The HOB card gallery is incomplete.")
    return cards

def font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    names = {
        "regular": "SourceSans3-Regular.ttf",
        "semibold": "SourceSans3-Semibold.ttf",
        "bold": "SourceSans3-Bold.ttf",
        "display": "BarlowCondensed-Bold.ttf",
    }
    return ImageFont.truetype(str(WORK / "assets" / names[weight]), size)

def drawtext(draw: ImageDraw.ImageDraw, position: tuple[int,int], text: str,
             size: int, color: str = INK, weight: str = "regular",
             anchor: str | None = None):
    draw.text(position, text, font=font(size, weight), fill=color, anchor=anchor, spacing=8)

def wrap(draw: ImageDraw.ImageDraw, text: str, max_w: int, size: int = 38,
         weight: str = "regular") -> str:
    out = []
    for para in text.split("\n"):
        line = ""
        for word in para.split():
            test = (line + " " + word).strip()
            if line and draw.textlength(test, font=font(size, weight)) > max_w:
                out.append(line)
                line = word
            else:
                line = test
        out.append(line)
    return "\n".join(out)

def paste_card(canvas: Image.Image, name_and_path: tuple[str, Path],
               x: int, y: int, width: int, angle: int = 0) -> None:
    _, path = name_and_path
    with Image.open(path) as img:
        img = img.convert("RGB")
        h = round(width * img.height / img.width)
        card = img.resize((width, h), Image.Resampling.LANCZOS)
        if angle:
            card = card.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    shadow = Image.new("RGBA", (card.width + 18, card.height + 20), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((11, 13, card.width+11, card.height+13), radius=13, fill=(16, 24, 32, 35))
    canvas.paste(shadow, (x-7, y-4), shadow)
    canvas.paste(card, (x, y))

def scene_image(scene: dict, cards: list[tuple[str,Path]]) -> Image.Image:
    im = Image.new("RGB", (WIDTH, HEIGHT), PAGE)
    d = ImageDraw.Draw(im)
    brand = Image.open(WORK / "assets/header-mark.png").convert("RGBA")
    brand = brand.resize((65, 65), Image.Resampling.LANCZOS)
    im.paste(brand, (77, 52), brand)
    drawtext(d, (158, 57), "Pack One", 58, INK, "display")
    drawtext(d, (1840, 77), "VIDEO REVIEW  /  HOBBIT CARDS", 23, MUTED, "semibold", "ra")
    d.line((78, 140, 1842, 140), fill=LINE, width=2)
    drawtext(d, (84, 183), scene["kicker"], 26, BLUE, "bold")
    kind, scene_id = scene["kind"], int(scene["id"])
    heading_size = 124 if kind not in ("eight", "gallery") else 110
    drawtext(d, (82, 244), scene["title"], heading_size, INK, "display")
    blurb_y = 565 if kind in ("eight", "gallery") else 578
    drawtext(d, (88, blurb_y), wrap(d, scene["blurb"], 680, 43), 43, MUTED)
    if kind == "brand":
        symbol = brand.resize((300,300),Image.Resampling.LANCZOS)
        im.paste(symbol,(1220,290),symbol)
        drawtext(d, (1190, 690), "A NEW WAY TO STUDY PICKS", 39, BLUE, "display")
    elif kind == "eight":
        for i in range(8):
            paste_card(im, cards[(i+2)%len(cards)], 900+(i%4)*224, 264+(i//4)*321, 193)
    elif kind in ("hook", "thinking", "gallery", "two"):
        picks = {
            "hook": (0,1,2),
            "thinking": (3,4,5),
            "gallery": (6,7,8),
            "two": (9,10,11),
        }[kind]
        for i, idx in enumerate(picks):
            paste_card(im, cards[idx], 861+i*325, 316 if i!=1 else 274, 280)
    elif kind == "share":
        d.rounded_rectangle((950, 340, 1798, 727), 28, fill="white", outline=LINE, width=4)
        drawtext(d, (1000, 390), "RUN COMPLETE", 37, INK, "display")
        drawtext(d, (1000, 462), "Your decisions.", 48, MUTED, "regular")
        drawtext(d, (1000, 528), "Your score.", 48, MUTED, "regular")
        d.rounded_rectangle((1290, 610, 1740, 706), 15, fill=BLUE)
        drawtext(d, (1515, 652), "Share result  →", 48, "white", "display", "mm")
        drawtext(d, (1030, 760), "Illustrative UI — not an actual score", 27, MUTED, "semibold")
    elif kind == "daily":
        for i, (n, subtitle) in enumerate([
            ("Draft Run", "8 picks / 8 trophy drafts"),
            ("Powered Cube", "Powered cards, tough decisions"),
            ("Latest Set", "Practice the current format"),
        ]):
            y=282+i*198
            d.rounded_rectangle((885,y,1815,y+162), 16, fill="white", outline=LINE, width=3)
            d.rounded_rectangle((885,y,896,y+162), 4, fill=BLUE)
            drawtext(d, (940,y+20), n, 68, INK, "display")
            drawtext(d, (942,y+100), subtitle, 29, MUTED, "regular")
    elif kind == "cta":
        for i, idx in enumerate((0,3,1)):
            paste_card(im, cards[idx], 900+i*302, 320 if i!=1 else 260, 262)
        d.rounded_rectangle((82,760,770,887),18,fill=BLUE)
        drawtext(d,(425,821),"PLAY AT PACKONE.PRO",49,"white","display","mm")
    drawtext(d, (82, 997), f"{scene_id:02d} / {len(SCENES):02d}", 24, MUTED, "semibold")
    if kind in ("hook","thinking","eight","gallery","two","cta"):
        drawtext(d,(1840,984),"The Hobbit (HOB) card art — visual examples, not recorded gameplay",
                 22,MUTED,"regular","ra")
    else:
        drawtext(d,(1840,995),"packone.pro",28,BLUE,"semibold","ra")
    return im

def tss(sec: float) -> str:
    ms=round(sec*1000)
    h,ms=divmod(ms,3600000); m,ms=divmod(ms,60000); s,ms=divmod(ms,1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"

def build_audio() -> list[dict]:
    if not MODEL_FILE.exists() or not VOICES_FILE.exists():
        raise RuntimeError("Download Kokoro voice models in the workflow before rendering.")
    from kokoro_onnx import Kokoro
    tts=Kokoro(str(MODEL_FILE),str(VOICES_FILE))
    cursor=0.0
    cue_lines=[]
    metadata=[]
    for i,scene in enumerate(SCENES):
        speechfile=SOUND/f"{scene['id']}.wav"
        if not speechfile.exists():
            audio,sr=tts.create(scene["narration"], voice=VOICE, speed=VOICE_SPEED, lang="en-us")
            sf.write(speechfile, audio, sr, subtype="PCM_16")
        audio,sr=sf.read(speechfile,dtype="float32")
        if audio.ndim==2:audio=audio.mean(axis=1)
        secs=float(len(audio)/sr)
        if secs < 3 or float(np.max(np.abs(audio))) < 0.02:
            raise RuntimeError(f"Audio missing or silent for scene {scene['id']}")
        duration=max(7.0,secs+scene["hold"]+0.55)
        # Pre-roll for caption readability, modest hold after narration.
        silence=np.zeros(int(.38*sr),dtype=np.float32)
        pad=np.zeros(max(0,int(duration*sr)-len(audio)-len(silence)),dtype=np.float32)
        aligned=np.concatenate((silence,audio,pad))[:int(duration*sr)]
        sf.write(SOUND/f"{scene['id']}-aligned.wav",aligned,sr,subtype="PCM_16")
        words=scene["narration"].split()
        chunks=[]; current=[]
        for w in words:
            if current and len(" ".join(current+[w]))>66:
                chunks.append(" ".join(current));current=[]
            current.append(w)
        if current:chunks.append(" ".join(current))
        weights=[max(len(s),7) for s in chunks]
        offset=0.0
        for chunk,w in zip(chunks,weights):
            span=secs*w/sum(weights)
            cue_lines.append((cursor+.38+offset,cursor+.38+offset+span,chunk))
            offset+=span
        row={**scene,"duration":round(duration,3),"start":round(cursor,3),"end":round(cursor+duration,3)}
        metadata.append(row)
        cursor+=duration
        print(f"Voice scene {scene['id']}: {secs:.1f}s spoken, {duration:.1f}s total",flush=True)
    srt="\n\n".join(f"{i+1}\n{tss(a)} --> {tss(b)}\n{c}" for i,(a,b,c) in enumerate(cue_lines))+"\n"
    (OUTPUT/"pack-one-launch-hobbit-v2.srt").write_text(srt)
    (OUTPUT/"pack-one-launch-hobbit-v2-narration.txt").write_text(
        "\n\n".join(f"{s['id']} | {s['title'].replace(chr(10),' ')}\n{s['narration']}" for s in SCENES)+"\n")
    (OUTPUT/"pack-one-launch-hobbit-v2.json").write_text(json.dumps({
        "version":2,"video_kind":"review","set":"HOB","voice_engine":"Kokoro ONNX",
        "voice":VOICE,"voice_speed":VOICE_SPEED,"duration_seconds":round(cursor,2),
        "illustrative_cards":True,"real_trophy_picks_depicted":False,
        "real_gameplay_recording":False,"scenes":metadata},indent=2)+"\n")
    return metadata

def render_video(timeline: list[dict], cards: list[tuple[str,Path]]) -> Path:
    parts=[]
    for scene in timeline:
        image=scene_image(scene,cards)
        frame=FRAMES/f"{scene['id']}.png"
        image.save(frame)
        out=FRAMES/f"{scene['id']}.mp4"
        d=scene["duration"]
        call(["ffmpeg","-y","-hide_banner","-loglevel","error",
              "-loop","1","-framerate",str(FPS),"-i",str(frame),
              "-i",str(SOUND/f"{scene['id']}-aligned.wav"),"-t",str(d),
              "-vf",f"fade=t=in:st=0:d=0.20:color=0xf7f8fa,fade=t=out:st={max(0.0,d-.22):.3f}:d=0.20:color=0xf7f8fa,format=yuv420p",
              "-c:v","libx264","-preset","veryfast","-crf","20","-threads","2",
              "-c:a","aac","-b:a","160k","-ar","48000","-r",str(FPS),str(out)])
        parts.append(out)
        print(f"Video scene {scene['id']} complete",flush=True)
    concat=FRAMES/"parts.txt"
    concat.write_text("".join(f"file '{p}'\n" for p in parts))
    out=OUTPUT/"pack-one-launch-hobbit-review-v2.mp4"
    call(["ffmpeg","-y","-hide_banner","-loglevel","error","-f","concat","-safe","0",
          "-i",str(concat),"-i",str(OUTPUT/"pack-one-launch-hobbit-v2.srt"),
          "-map","0:v:0","-map","0:a:0","-map","1:0",
          "-c:v","copy","-c:a","copy","-c:s","mov_text",
          "-metadata:s:s:0","language=eng",
          "-metadata","title=Pack One — Hobbit card preview (v2)",
          "-movflags","+faststart",str(out)])
    return out

def contact_sheet(timeline: list[dict]) -> None:
    columns=3
    thumb_w,thumb_h=480,270
    sheet=Image.new("RGB",(thumb_w*columns,math.ceil(len(timeline)/columns)*300),"white")
    d=ImageDraw.Draw(sheet)
    for i,scene in enumerate(timeline):
        with Image.open(FRAMES/f"{scene['id']}.png") as src:
            img=src.resize((thumb_w,thumb_h),Image.Resampling.LANCZOS)
        x=i%columns*thumb_w;y=i//columns*300
        sheet.paste(img,(x,y))
        d.text((x+10,y+275),f"{scene['start']:.0f}s  {scene['title'].replace(chr(10),' ')}",
               fill="#202020",font=ImageFont.truetype(str(WORK/"assets/SourceSans3-Regular.ttf"),18))
    sheet.save(OUTPUT/"pack-one-launch-hobbit-v2-contact-sheet.jpg",quality=92)

def main() -> None:
    ensure_source()
    cards=acquire_cards()
    timeline=build_audio()
    out=render_video(timeline,cards)
    contact_sheet(timeline)
    probe=subprocess.check_output(["ffprobe","-v","error","-show_entries",
                                   "format=duration:stream=codec_type,width,height",
                                   "-of","json",str(out)],text=True)
    quality=json.loads(probe)
    video=next((s for s in quality["streams"] if s["codec_type"]=="video"),None)
    if not video or video.get("width")!=WIDTH or video.get("height")!=HEIGHT:
        raise RuntimeError("Output video resolution mismatch.")
    if not any(s["codec_type"]=="audio" for s in quality["streams"]):
        raise RuntimeError("Output has no narration audio.")
    seconds=float(quality["format"]["duration"])
    if abs(seconds-timeline[-1]["end"])>1.25:
        raise RuntimeError("Output duration mismatch.")
    print(json.dumps({"output":str(out),"bytes":out.stat().st_size,
                      "duration_seconds":seconds,"cards":len(cards),
                      "voice":VOICE,"captions":True}),flush=True)

if __name__=="__main__":
    main()
