from pathlib import Path

path = Path('growth.mjs')
text = path.read_text(encoding='utf-8')
old = "  event('challenge_open',{ target_score:target, challenger:by||'friend', kind:'seed' });\n}"
new = "  event('challenge_open',{ target_score:target, challenger:by||'friend', kind:'seed' });\n  if(!challengeStartTracked){\n    challengeStartTracked=true;\n    event('challenge_start',{ mode:modeFromPage(), target_score:target, challenger:by||'friend', source:'rendered_challenge' });\n  }\n}"
if text.count(old) != 1:
    raise SystemExit(f'expected one challenge banner analytics block, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('challenge_start now records from the rendered seeded challenge')
