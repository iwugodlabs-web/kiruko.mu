# Kiruko — Brand Assets

**Logo:** "Unity Ring" — a circle of people around one centre, one highlighted (the individual), **K** at the heart. Tagline: *Together We Can.*

## Colours
Single source of truth: `Palette` in `mobile/app/constants/theme.ts` — this table mirrors it.
| Token | Hex |
|---|---|
| Gold | `#F2B705` (gradient `#FBD34D → #C99405`) |
| Green | `#33CC11` (glow `#7CFF4A`) |
| Teal | `#14B8A6` |
| Blue | `#4F6BE0` |
| Violet | `#8B5CF6` |
| Indigo | `#1E2A52` |
| Ink | `#16203B` |

The mark's **K is drawn as geometry (no font)**, so the icon renders identically on every device. The wordmark in `kiruko-unity-logo.svg` uses live text (Orbitron/Trebuchet); the shipped **PNG** lockups (`dist/logo.png`, `dist/og-image.png`) have the type baked in, so they're font-independent.

## Source SVGs
- `kiruko-unity-icon.svg` — primary mark, full colour
- `kiruko-unity-icon-mono.svg` — one-colour gold
- `kiruko-unity-icon-white.svg` — reversed white
- `kiruko-unity-logo.svg` — horizontal lockup (icon + wordmark + tagline)
- `kiruko-unity-brand.html` — brand sheet
- `_master_*.svg`, `_banner.html` — render masters

## Production exports → `dist/`
App-icon backgrounds (1024, opaque): `app-icon-white-1024.png`, `app-icon-dark-1024.png`, `app-icon-gradient-1024.png`
Transparent mark set: `icon-{512,192,180,96,64,48,32}.png`
Mobile: `kiruko-icon.png`, `kiruko-adaptive-foreground.png`, `kiruko-splash.png`, `kiruko-favicon.png`
Web: `web-icon.png`, `web-favicon.png`, `web-apple-icon.png`, `favicon.ico`, `og-image.png`, `logo.png`

## Wired into the apps
**Mobile** (`mobile/app.json`): `icon`, `android.adaptiveIcon.foregroundImage`, `web.favicon`, splash → `kiruko-*` assets in `mobile/assets/images/`.
**Web** (`web/ivor-web`): `public/favicon.ico` + `favicon.png`, `src/app/icon.png`, `public/apple-icon.png`, `public/og-image.png`, `public/logo.png`; metadata updated in `src/app/layout.tsx`.

> The current app **display name is still "Kontokaz"** (mobile `app.json`, web metadata). Only the visual assets were swapped — say the word to rename to "Kiruko".

## Regenerate
```bash
cd branding
# 1) re-render masters (Chrome headless → transparent PNG)
#    _master_full.svg, _master_white.svg, _master_favicon.svg, kiruko-unity-logo.svg, _banner.html
# 2) derive all sizes + composites + favicon.ico
python3 _generate.py
```
The app icon currently uses the **white** background. To switch to the gradient, copy `dist/app-icon-gradient-1024.png` over `mobile/assets/images/kiruko-icon.png` and set Android `backgroundColor` accordingly.
