#!/usr/bin/env python3
import os
from PIL import Image

B = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(B, "dist")
os.makedirs(DIST, exist_ok=True)

full = Image.open(os.path.join(B, "_master_full.png")).convert("RGBA")      # 1024 transparent, full colour
white = Image.open(os.path.join(B, "_master_white.png")).convert("RGBA")    # 1024 transparent, white
fav  = Image.open(os.path.join(B, "_master_favicon.png")).convert("RGBA")   # 512 transparent

def R(img, n):  # high-quality square resize
    return img.resize((n, n), Image.LANCZOS)

def on_bg(mark, n, rgb):
    bg = Image.new("RGBA", (n, n), rgb + (255,))
    bg.alpha_composite(R(mark, n))
    return bg.convert("RGB")

def vgrad(n, top, bot):
    col = Image.new("RGB", (1, n))
    for y in range(n):
        t = y / (n - 1)
        col.putpixel((0, y), tuple(int(top[i] + (bot[i]-top[i])*t) for i in range(3)))
    return col.resize((n, n))

def centered(mark, n, scale):
    canvas = Image.new("RGBA", (n, n), (0,0,0,0))
    s = int(n*scale)
    canvas.alpha_composite(R(mark, s), ((n-s)//2, (n-s)//2))
    return canvas

INDIGO=(30,42,82); TEAL=(20,184,166); WHITEC=(255,255,255); DARKC=(22,22,22)

out = {}
# ---- transparent full-mark size set ----
for n in (512,192,180,96,64,48,32):
    p=f"icon-{n}.png"; R(full,n).save(os.path.join(DIST,p)); out[p]=1

# ---- app-icon backgrounds (opaque, 1024) ----
on_bg(full,1024,WHITEC).save(os.path.join(DIST,"app-icon-white-1024.png"))
on_bg(full,1024,DARKC ).save(os.path.join(DIST,"app-icon-dark-1024.png"))
grad=vgrad(1024,INDIGO,TEAL).convert("RGBA"); grad.alpha_composite(R(white,1024))
grad.convert("RGB").save(os.path.join(DIST,"app-icon-gradient-1024.png"))

# ---- Expo (mobile) ----
on_bg(full,1024,WHITEC).save(os.path.join(DIST,"kiruko-icon.png"))                 # iOS icon (opaque)
centered(full,1024,0.66).save(os.path.join(DIST,"kiruko-adaptive-foreground.png")) # Android safe zone
centered(full,1024,0.80).save(os.path.join(DIST,"kiruko-splash.png"))              # splash (transparent)
R(fav,96).save(os.path.join(DIST,"kiruko-favicon.png"))                            # expo web favicon

# ---- Web (Next.js) ----
R(full,512).save(os.path.join(DIST,"web-icon.png"))                # src/app/icon.png
R(fav,64 ).save(os.path.join(DIST,"web-favicon.png"))             # public/favicon.png
on_bg(full,180,WHITEC).save(os.path.join(DIST,"web-apple-icon.png"))  # apple touch (opaque)
R(fav,256).save(os.path.join(DIST,"favicon.ico"), sizes=[(16,16),(32,32),(48,48)])

print("DIST files:", len(os.listdir(DIST)))
print("\n".join(sorted(os.listdir(DIST))))
