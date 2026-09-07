from pathlib import Path

path = Path(__file__).with_name('growth_loop_sprint.py')
text = path.read_text(encoding='utf-8')
needle = '`${text}\\n${url}`'
replacement = '`${text}\\\\n${url}`'
count = text.count(needle)
if count < 2:
    raise SystemExit(f'expected at least two JS newline templates, found {count}')
text = text.replace(needle, replacement)
old_import = 'from scripts.build_replays import write_sharded_dataset  # noqa: E402'
if old_import not in text:
    raise SystemExit('expected replay builder import not found')
text = text.replace(old_import, 'from build_replays import write_sharded_dataset  # noqa: E402', 1)
path.write_text(text, encoding='utf-8')
print(f'escaped {count} JS newline templates and fixed replay builder import')
