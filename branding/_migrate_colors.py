#!/usr/bin/env python3
import re, glob, colorsys, os

# token -> value (must match theme.ts)
PAL = {
 'gold':'#F2B705','green':'#33CC11','teal':'#14B8A6','blue':'#4F6BE0','violet':'#8B5CF6',
 'indigo':'#1E2A52','ink':'#16203B','goldTint':'#FFF6DB','greenTint':'#ECFDE7',
 'tealTint':'#DEFAF4','blueTint':'#EAEEFC','violetTint':'#F1ECFE','success':'#16A34A',
 'successTint':'#D1FAE5','warning':'#F59E0B','warningTint':'#FEF3C7','error':'#DC2626',
 'errorAlt':'#EF4444','errorTint':'#FEE2E2','info':'#4F6BE0','infoTint':'#EAEEFC',
 'white':'#FFFFFF','black':'#000000','gray50':'#F9FAFB','gray100':'#F3F4F6','gray200':'#E5E7EB',
 'gray300':'#D1D5DB','gray400':'#9CA3AF','gray500':'#6B7280','gray600':'#4B5563',
 'gray700':'#374151','gray800':'#1F2937','gray900':'#16203B',
}
# exact overrides (brand/semantic/known)
OV = {
 'F2B705':'gold','E0A93B':'gold','F0B82E':'gold','FBD34D':'goldTint','F6E08A':'goldTint',
 '33CC11':'green','7CFF4A':'green','46E020':'green','4FDC2E':'green','2FBF1F':'green',
 '14B8A6':'teal','0E7C6B':'teal','2DD4BF':'tealTint','14A88E':'teal',
 '4F6BE0':'blue','7C8FF0':'blueTint',
 '8B5CF6':'violet','A78BFA':'violetTint',
 '1E2A52':'indigo','2E4374':'indigo','2A3A5C':'indigo','16203B':'ink','201D1E':'ink',
 'DC2626':'error','EF4444':'errorAlt','F59E0B':'warning','F2B705_w':'warning',
 '16A34A':'success','059669':'success',
 'FEE2E2':'errorTint','FEF2F2':'errorTint','FECACA':'errorTint',
 'FEF3C7':'warningTint','FEF9C3':'warningTint','FFFBEB':'warningTint','FDE68A':'warningTint',
 'D1FAE5':'successTint','ECFDF5':'greenTint','ECFDE7':'greenTint','A7F3D0':'greenTint',
 'DBEAFE':'blueTint','EFF6FF':'blueTint','EAEEFC':'blueTint','E0F2FE':'blueTint','EEF2FF':'blueTint',
 'FFF6DB':'goldTint','DEFAF4':'tealTint','F1ECFE':'violetTint','F0F9FF':'blueTint',
 'FFFFFF':'white','FFF':'white','000000':'black','000':'black',
 'F9FAFB':'gray50','F3F4F6':'gray100','E5E7EB':'gray200','D1D5DB':'gray300','CBD5E1':'gray300',
 '9CA3AF':'gray400','6B7280':'gray500','4B5563':'gray600','374151':'gray700','1F2937':'gray800',
}
GRAYS=[('gray50',.98),('gray100',.95),('gray200',.90),('gray300',.82),('gray400',.66),
       ('gray500',.46),('gray600',.34),('gray700',.28),('gray800',.19),('gray900',.10)]
def classify(hx):
    H=hx.upper().lstrip('#')
    if len(H)==3: H=''.join(c*2 for c in H)
    if H in OV: return OV[H]
    r,g,b=[int(H[i:i+2],16)/255 for i in (0,2,4)]
    mx,mn=max(r,g,b),min(r,g,b); L=(mx+mn)/2
    if mx-mn<=0.06:
        if L>=.97: return 'white'
        if L<=.04: return 'black'
        return min(GRAYS,key=lambda t:abs(t[1]-L))[0]
    deg=colorsys.rgb_to_hsv(r,g,b)[0]*360
    light = L>0.85
    if deg<15 or deg>=345: return 'errorTint' if light else 'error'
    if deg<45:  return 'warningTint' if light else ('ink' if L<0.22 else 'gold')
    if deg<70:  return 'warningTint' if light else 'gold'
    if deg<160: return 'greenTint' if light else 'green'
    if deg<200: return 'tealTint' if light else 'teal'
    if deg<255: return 'blueTint' if light else 'blue'
    if deg<290: return 'violetTint' if light else 'violet'
    return 'violetTint' if light else 'violet'

HEX = re.compile(r'#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b')
files = [f for f in glob.glob('mobile/app/**/*.tsx',recursive=True)+glob.glob('mobile/components/**/*.tsx',recursive=True)
         if 'constants/theme.ts' not in f]
changed=0; total=0
for f in files:
    src=open(f,encoding='utf-8').read()
    n=[0]
    # 1) JSX attribute:  attr="#hex"  ->  attr={Palette.token}
    def attr(m):
        n[0]+=1; return f'{m.group(1)}={{Palette.{classify(m.group(2))}}}'
    s=re.sub(r'(\b[A-Za-z]+)="(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3})"', attr, src)
    # 2) quoted in objects/arrays/ternaries:  '#hex' or "#hex"  ->  Palette.token
    def quoted(m):
        n[0]+=1; return f'Palette.{classify(m.group(1))}'
    s=re.sub(r"'(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3})'", quoted, s)
    s=re.sub(r'"(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3})"', quoted, s)
    if n[0]==0: continue
    # inject import after first import line (if not present)
    if 'constants/theme' not in s:
        s=re.sub(r'(^import .*$)', r"\1\nimport { Palette } from '@/app/constants/theme';", s, count=1, flags=re.M)
    open(f,'w',encoding='utf-8').write(s)
    changed+=1; total+=n[0]
print(f"files changed: {changed}, hex->token replacements: {total}")
