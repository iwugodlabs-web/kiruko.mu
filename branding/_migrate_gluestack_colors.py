#!/usr/bin/env python3
"""Map gluestack $-color tokens -> centralized Palette tokens.

color="$textDark900" -> color={Palette.ink}, borderColor="$borderLight100" ->
borderColor={Palette.gray100}, etc. Finishes the "one color system" goal so no
page silently uses gluestack's separate gray ramp.
"""
import re, glob

MAP = {
    'textDark900': 'ink', 'textDark800': 'gray800', 'textDark700': 'gray700',
    'textDark600': 'gray600', 'textDark500': 'gray500', 'textDark400': 'gray400',
    'textLight500': 'gray500', 'textLight400': 'gray400', 'textLight300': 'gray300',
    'borderLight100': 'gray100', 'borderLight200': 'gray200', 'borderLight300': 'gray300',
    'backgroundLight50': 'gray50', 'backgroundLight100': 'gray100', 'backgroundLight200': 'gray200',
    'error600': 'error', 'error500': 'error', 'primary600': 'blue', 'primary500': 'blue',
    'white': 'white', 'black': 'black',
    'green100': 'greenTint', 'blue100': 'blueTint', 'red100': 'errorTint', 'amber100': 'warningTint',
}
ATTR = re.compile(r'\b(color|bg|backgroundColor|borderColor)="\$([A-Za-z0-9]+)"')

files = glob.glob('mobile/app/company_dashboard/**/*.tsx', recursive=True)
total = 0; changed = 0
for f in files:
    src = open(f, encoding='utf-8').read()
    n = [0]
    def rep(m):
        attr, tok = m.group(1), m.group(2)
        if tok not in MAP: return m.group(0)
        n[0] += 1; return f'{attr}={{Palette.{MAP[tok]}}}'
    s = ATTR.sub(rep, src)
    if n[0] == 0: continue
    if "constants/theme" not in s:
        s = re.sub(r'(^import .*$)', r"\1\nimport { Palette } from '@/app/constants/theme';", s, count=1, flags=re.M)
    open(f, 'w', encoding='utf-8').write(s)
    changed += 1; total += n[0]
    print(f"  {f}: {n[0]}")
print(f"files changed: {changed}, $-token -> Palette: {total}")
