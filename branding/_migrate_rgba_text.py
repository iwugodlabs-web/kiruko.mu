#!/usr/bin/env python3
"""Convert muddy black `color` props (rgba(0,0,0,x)) -> crisp Palette tokens.

ONLY touches the `color=`/`color:` attribute (text & icon color). Leaves
shadowColor, borderColor, backgroundColor, and rgba(255,255,255,*) alone —
those translucencies are intentional (shadows, hairlines, overlays on gradients).
"""
import re, glob

def token_for(op: float) -> str:
    if op >= 0.85: return 'ink'
    if op >= 0.6:  return 'gray700'   # 0.7, 0.8
    if op >= 0.45: return 'gray500'   # 0.5, 0.55
    if op >= 0.3:  return 'gray400'   # 0.4
    return None  # <0.3 — leave (rare for text)

# color="rgba(0,0,0,O)" | color='...' | color={'...'} | color={"..."}
ATTR = re.compile(r'\bcolor=(?:"|\'|\{"|\{\')rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*(0?\.\d+|1(?:\.0)?)\s*\)(?:"|\'|"\}|\'\})')
# color: 'rgba(0,0,0,O)'  (object style)
PROP = re.compile(r'\bcolor:\s*(?:"|\')rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*(0?\.\d+|1(?:\.0)?)\s*\)(?:"|\')')

files = glob.glob('mobile/app/company_dashboard/**/*.tsx', recursive=True)
total = 0; changed = 0
for f in files:
    src = open(f, encoding='utf-8').read()
    n = [0]
    def attr(m):
        tok = token_for(float(m.group(1)))
        if tok is None: return m.group(0)
        n[0] += 1; return f'color={{Palette.{tok}}}'
    def prop(m):
        tok = token_for(float(m.group(1)))
        if tok is None: return m.group(0)
        n[0] += 1; return f'color: Palette.{tok}'
    s = ATTR.sub(attr, src)
    s = PROP.sub(prop, s)
    if n[0] == 0: continue
    if "constants/theme" not in s:
        s = re.sub(r'(^import .*$)', r"\1\nimport { Palette } from '@/app/constants/theme';", s, count=1, flags=re.M)
    open(f, 'w', encoding='utf-8').write(s)
    changed += 1; total += n[0]
    print(f"  {f}: {n[0]}")
print(f"files changed: {changed}, rgba-text -> token: {total}")
