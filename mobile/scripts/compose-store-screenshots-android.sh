#!/usr/bin/env bash
set -euo pipefail

# Frame actual 1080x1920 native Android captures with the same Pack One
# branding and story order as the iOS screenshots. No app UI is fabricated.
root="$1"
[[ -n "$root" ]] || { echo "Store screenshot root required" >&2; exit 1; }
font="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
[[ -f "$font" ]] || { echo "Required store caption font is missing" >&2; exit 1; }
command -v ffmpeg >/dev/null

while IFS='|' read -r name caption; do
  file="$root/android/$name.jpg"
  [[ -s "$file" ]] || { echo "Missing native Android capture: $file" >&2; exit 1; }
  scratch="$(mktemp -d)"
  printf '%s\n' "$caption" > "$scratch/title.txt"
  ffmpeg -hide_banner -loglevel error -y -i "$file" -frames:v 1 \
    -vf "scale=900:1600:flags=lanczos,pad=1080:1920:90:305:color=0xf6f7fa,drawbox=x=89:y=304:w=902:h=1602:color=0xcfd4dd:t=2,drawtext=fontfile=$font:text='PACK ONE':fontcolor=0x506a94:fontsize=28:x=64:y=65,drawtext=fontfile=$font:textfile=$scratch/title.txt:fontcolor=0x192337:fontsize=54:x=64:y=138" \
    -q:v 2 "$scratch/composed.jpg"
  [[ $(stat -c%s "$scratch/composed.jpg") -gt 50000 ]] || { echo "Blank Android composite: $file" >&2; exit 1; }
  mv "$scratch/composed.jpg" "$file"
  rm -rf "$scratch"
done <<'CAPTIONS'
01-daily-decision|What would you pick?
02-reveal-comparison|See the trophy drafter's pick
03-daily-hub|Three new Dailies every day
04-leaderboard|Find the picks to revisit.
05-practice|More drafts. More reps.
CAPTIONS
