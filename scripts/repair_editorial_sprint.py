from pathlib import Path

path = Path(__file__).with_name('editorial_monetization_sprint.py')
text = path.read_text(encoding='utf-8')
old = "            pick = next((p for p in replay.get(\"picks\", []) if p.get(\"pack_number\") == 1 and p.get(\"pick_number\") == 1), None)\n"
new = "            pack_one = [p for p in replay.get(\"picks\", []) if p.get(\"pack_number\") == 1]\n            pick = min(pack_one, key=lambda p: int(p.get(\"pick_number\", 999))) if pack_one else None\n"
if text.count(old) != 1:
    raise SystemExit('expected opening-pick selector once')
path.write_text(text.replace(old, new), encoding='utf-8')
