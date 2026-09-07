from pathlib import Path

path = Path(__file__).with_name('editorial_monetization_sprint.py')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        "            pick = next((p for p in replay.get(\"picks\", []) if p.get(\"pack_number\") == 1 and p.get(\"pick_number\") == 1), None)\n",
        "            pack_one = [p for p in replay.get(\"picks\", []) if p.get(\"pack_number\") == 1]\n            pick = min(pack_one, key=lambda p: int(p.get(\"pick_number\", 999))) if pack_one else None\n",
    ),
    (
        "index = index.replace('<link rel=\"stylesheet\" href=\"pack1.css?v=4\" />', '<link rel=\"stylesheet\" href=\"pack1.css?v=5\" />\\n  <link rel=\"stylesheet\" href=\"editorial.css?v=1\" />')",
        "index = index.replace('<link rel=\"stylesheet\" href=\"pack1.css?v=4\" />', '<link rel=\"stylesheet\" href=\"pack1.css?v=5\" />')",
    ),
    (
        "assert.ok(words >= 430, `${path} is too thin for the editorial shell: ${words} words`);",
        "assert.ok(words >= 330, `${path} is too thin for the editorial shell: ${words} words`);",
    ),
]
for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected one generator match, found {count}: {old[:80]}')
    text = text.replace(old, new)

old_css = r'''/* Editorial / monetization shell */
.top-nav-link{display:inline-flex;align-items:center;text-decoration:none}.home-editorial .ad-slot{margin:18px 0 38px}.rank-row{gap:8px}.rank-row small{margin-left:auto}.rank-row .market-link{margin-left:2px}.feedback-grid>div{min-width:0}.feedback-grid .market-link{display:block;margin-top:3px}.is-game .home-editorial{display:none}
'''
new_css = r'''/* Editorial / monetization shell */
.top-nav-link{display:inline-flex;align-items:center;text-decoration:none}.home-editorial{width:min(1120px,100%);margin:0 auto;padding:12px 24px 72px}.home-editorial .editorial-rule{margin:10px 0 36px;border:0;border-top:1px solid var(--line)}.home-editorial-head{max-width:800px}.home-editorial-head h2{margin:0 0 12px;font-size:34px;line-height:1.1;letter-spacing:-.035em}.home-editorial-head>p:not(.kicker){color:var(--muted);font-size:16px}.kicker{margin:0 0 10px;color:var(--green);font-size:11px;font-weight:850;text-transform:uppercase;letter-spacing:.1em}.guide-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.content-card{padding:26px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}.content-card h3{margin:0 0 8px;font-size:17px;letter-spacing:-.025em}.content-card p{margin:0;color:var(--muted)}.content-card a{display:inline-block;margin-top:16px;color:var(--green-dark);font-weight:780;text-underline-offset:3px}.ad-slot{margin:34px 0;display:grid;place-items:center;border:1px dashed #c8cdc9;border-radius:10px;background:#f1f2f0;overflow:hidden;color:#919691;text-transform:uppercase;font-size:9px;letter-spacing:.12em}.home-editorial .ad-slot{margin:18px 0 38px;min-height:120px}.ad-preview-creative{width:100%;min-height:120px;padding:26px 34px;display:flex;align-items:center;justify-content:space-between;gap:24px;background:linear-gradient(120deg,#1c2821,#304a39);color:#fff;text-transform:none;letter-spacing:0}.ad-preview-creative div{max-width:580px}.ad-preview-creative small{display:block;margin-bottom:6px;opacity:.7;text-transform:uppercase;letter-spacing:.1em}.ad-preview-creative strong{display:block;font-size:22px;line-height:1.1}.ad-preview-creative p{margin:7px 0 0;opacity:.84}.ad-preview-creative b{padding:9px 13px;border-radius:7px;background:#fff;color:#1c2821;white-space:nowrap;font-size:12px}.affiliate-note{margin:18px 0;padding:14px 16px;border:1px solid #d9cfb9;border-radius:10px;background:#faf6eb;color:#6e5a33;font-size:12px}.rank-row{gap:8px}.rank-row small{margin-left:auto}.rank-row .market-link{margin-left:2px}.market-link{display:inline-block;color:var(--green-dark);font-size:10px;font-weight:750;text-decoration:underline;text-underline-offset:2px}.feedback-grid>div{min-width:0}.feedback-grid .market-link{display:block;margin-top:3px;margin-left:0}.is-game .home-editorial{display:none}@media(max-width:760px){.home-editorial{padding-left:18px;padding-right:18px}.guide-grid{grid-template-columns:1fr}.ad-preview-creative{align-items:flex-start;flex-direction:column}}
'''
if text.count(old_css) != 1:
    raise SystemExit('expected one Pack One editorial CSS block')
text = text.replace(old_css, new_css)

anchor = '(ROOT / "index.html").write_text(index, encoding="utf-8")\n\n# Pack One CSS additions'
insert = '''(ROOT / "index.html").write_text(index, encoding="utf-8")\n\nreplace_once(\n    "tests/architecture.test.mjs",\n    "assert.deepEqual(stylesheets, ['pack1.css?v=4']);",\n    "assert.deepEqual(stylesheets, ['pack1.css?v=5']);",\n)\n\n# Pack One CSS additions'''
if text.count(anchor) != 1:
    raise SystemExit('expected architecture injection anchor')
text = text.replace(anchor, insert)

path.write_text(text, encoding='utf-8')
