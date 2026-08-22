# DigitalOcean Spaces — CORS

Apply this once after switching `STORAGE_TYPE=s3` (DO Spaces). It lets the
mobile app's pdf.js viewer (served from the backend at `/pdf-view`) **fetch**
PDF objects from the bucket cross-origin. Without it, PDFs render blank on
Android (and any browser-based fetch is blocked).

- **Why these origins:** the pdf.js viewer page is served by the backend
  (`https://api.kiruko.mu/pdf-view`), so a PDF fetch carries
  `Origin: https://api.kiruko.mu`. The web origins are included for any
  JS-based reads from the dashboard. Plain `<img>` / download links don't need
  CORS — only the pdf.js `fetch()` does.
- **Methods:** GET/HEAD only — objects are read-only from the client; uploads
  go through the backend, not the browser.
- If your backend domain differs from `api.kiruko.mu`, edit `spaces-cors.json`
  to match before applying.

## Apply with the AWS CLI (Spaces is S3-compatible)
```bash
aws s3api put-bucket-cors \
  --bucket <your-space-name> \
  --endpoint-url https://<region>.digitaloceanspaces.com \
  --cors-configuration file://backend/spaces-cors.json
```
(`<region>` e.g. `fra1`, `ams3`. Credentials = the same `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` you set for `STORAGE_TYPE=s3`.)

Verify:
```bash
aws s3api get-bucket-cors --bucket <your-space-name> \
  --endpoint-url https://<region>.digitaloceanspaces.com
```

## Or via the DO control panel
Spaces → your bucket → **Settings → CORS Configurations → Add**:
- Origin: `https://api.kiruko.mu` (repeat for `app.kiruko.mu`, `kiruko.mu`)
- Allowed Methods: **GET**, **HEAD**
- Allowed Headers: `*`
- Access Control Max Age: `3000`

## Note
The pdf.js **library** itself loads from cdnjs (with `Access-Control-Allow-Origin: *`)
and needs no configuration — this CORS rule is only for the **file** objects in
your Space.
