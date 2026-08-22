# Kiruko — Marketing Site

Self-contained landing page (`index.html`, no build step). Follows the
`branding/kiruko-unity-brand.html` concept and the `Palette` design schema
(Gold #F2B705 · Green #33CC11 · Teal #14B8A6 · Blue #4F6BE0 · Violet #8B5CF6 ·
Indigo #1E2A52 · Ink #16203B). Uses the real Unity Ring logo (inline SVG).

## Drop in screenshots
Save files into `assets/screenshots/` with these exact names — they appear
automatically (a dashed placeholder shows until the file exists):

| File | Where | Suggested size |
|---|---|---|
| `dashboard.png`      | Hero — browser frame      | wide ≈ 1280×800 (employer dashboard) |
| `employee-home.png`  | Hero — phone frame        | tall 9:19.5 (employee home) |
| `showcase-1.png`     | Showcase — phone 1        | tall 9:19.5 |
| `showcase-2.png`     | Showcase — phone 2        | tall 9:19.5 |
| `showcase-3.png`     | Showcase — phone 3        | tall 9:19.5 |

Optional: `assets/og-image.png` (social card) and `assets/favicon.png`.

## Preview
Open `index.html` in a browser, or serve it: `python3 -m http.server -d marketing 8088`.

## Deploy
Any static host (Netlify, Vercel, GitHub Pages, S3) — just upload the `marketing/`
folder.
