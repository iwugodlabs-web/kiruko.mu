#!/usr/bin/env python3
"""Map ad-hoc numeric fontSize -> centralized Type tokens (theme.ts).

fontSize={14} / fontSize="14" -> fontSize={Type.body}, etc. Snaps the 17
scattered raw sizes onto an 11-step ramp (negligible visual change) so the whole
app shares one type scale that can be tuned in one place.
"""
import re, glob

def tok(n: int) -> str:
    if n >= 38: return 'hero'
    if n >= 28: return 'display'
    if n >= 24: return 'h1'
    if n >= 20: return 'h2'
    if n >= 18: return 'h3'
    if n >= 16: return 'title'
    if n >= 14: return 'body'
    if n == 13: return 'label'
    if n == 12: return 'small'
    if n == 11: return 'caption'
    return 'tiny'

NUM = re.compile(r'fontSize=\{(\d+)\}')
STR = re.compile(r'fontSize="(\d+)"')

def ensure_type_import(s: str) -> str:
    if re.search(r'\bType\b', s) and 'constants/theme' in s:
        # already references Type somewhere with theme imported — ensure named import
        pass
    # add Type to the existing theme import braces if present
    m = re.search(r"import \{([^}]*)\} from '@/app/constants/theme';", s)
    if m:
        names = [x.strip() for x in m.group(1).split(',') if x.strip()]
        if 'Type' not in names:
            names.append('Type')
            return s[:m.start()] + "import { " + ', '.join(names) + " } from '@/app/constants/theme';" + s[m.end():]
        return s
    # no theme import — add a fresh one after first import
    return re.sub(r'(^import .*$)', r"\1\nimport { Type } from '@/app/constants/theme';", s, count=1, flags=re.M)

files = glob.glob('mobile/app/company_dashboard/**/*.tsx', recursive=True)
total = 0; changed = 0
for f in files:
    src = open(f, encoding='utf-8').read()
    n = [0]
    def num(m):
        n[0] += 1; return f'fontSize={{Type.{tok(int(m.group(1)))}}}'
    def strr(m):
        n[0] += 1; return f'fontSize={{Type.{tok(int(m.group(1)))}}}'
    s = NUM.sub(num, src)
    s = STR.sub(strr, s)
    if n[0] == 0: continue
    s = ensure_type_import(s)
    open(f, 'w', encoding='utf-8').write(s)
    changed += 1; total += n[0]
    print(f"  {f}: {n[0]}")
print(f"files changed: {changed}, fontSize -> Type token: {total}")
