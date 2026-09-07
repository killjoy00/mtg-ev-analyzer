from pathlib import Path

path = Path(__file__).with_name('growth_loop_sprint.py')
text = path.read_text(encoding='utf-8')
needle = '`${text}\\n${url}`'
replacement = '`${text}\\\\n${url}`'
count = text.count(needle)
if count < 2:
    raise SystemExit(f'expected at least two JS newline templates, found {count}')
path.write_text(text.replace(needle, replacement), encoding='utf-8')
print(f'escaped {count} JS newline templates in one-shot script')
