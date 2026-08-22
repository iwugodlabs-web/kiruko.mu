/**
 * Import Swahili translations from a CSV back into mobile/app/locales/sw.ts.
 *
 * Usage:
 *   node mobile/scripts/import_swahili.js [path/to/filled.csv]
 *
 * Defaults to ./swahili_translation_export.csv (the file produced by
 * `export` — one row per string with columns: key, english, swahili).
 *
 * The translator fills the `swahili` column (leave blank to keep English).
 * This script then regenerates sw.ts from the English baseline (en.ts) and
 * applies every non-empty swahili value. It is idempotent: run it again
 * whenever the CSV comes back with more rows filled in.
 *
 * It is value-driven and preserves en.ts formatting/comments: for each CSV
 * row it looks up the key's English value in en.ts and swaps that value for
 * the Swahili one. Keys in the CSV that don't exist in en.ts are reported
 * and skipped (a translator typo must not break the build).
 */

const fs = require("fs");
const path = require("path");

const EN_PATH = path.join(__dirname, "..", "app", "locales", "en.ts");
const SW_PATH = path.join(__dirname, "..", "app", "locales", "sw.ts");

function parseLocale(file) {
  let src = fs.readFileSync(file, "utf8");
  src = src.replace('import ITranslationSchema from "@/types/ITranslationSchema";', "");
  src = src.replace(/const translation\w+: ITranslationSchema =/, "const __obj =");
  src = src.replace(/export default translation\w+;/, "");
  return eval(src + "\n; __obj;");
}

// Minimal CSV parser handling BOM, quotes, embedded commas/newlines.
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        rows.push(row); row = [];
      } else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function main() {
  const csvPath = process.argv[2] || "swahili_translation_export.csv";
  const csvText = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(csvText);

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const keyIdx = header.indexOf("key");
  const swIdx = header.indexOf("swahili");
  if (keyIdx === -1 || swIdx === -1) {
    console.error("CSV must have 'key' and 'swahili' columns.");
    process.exit(1);
  }

  const en = parseLocale(EN_PATH);

  // key -> exact english value (to drive value-based replacement)
  const keyToEn = new Map();
  (function walk(o, prefix) {
    for (const k of Object.keys(o)) {
      const v = o[k];
      const key = prefix ? prefix + "." + k : k;
      if (v && typeof v === "object") walk(v, key);
      else if (typeof v === "string") keyToEn.set(key, v);
    }
  })(en, "");

  const reps = new Map(); // JSON.stringify(enValue) -> JSON.stringify(swahili)
  let applied = 0;
  const unknownKeys = [];
  for (let i = 1; i < rows.length; i++) {
    const key = (rows[i][keyIdx] || "").trim();
    const swahili = (rows[i][swIdx] || "").trim();
    if (!key || !swahili) continue;
    const enVal = keyToEn.get(key);
    if (enVal === undefined) { unknownKeys.push(key); continue; }
    reps.set(JSON.stringify(enVal), JSON.stringify(swahili));
    applied++;
  }

  let out = fs.readFileSync(EN_PATH, "utf8");
  out = out.replace("const translationEN", "const translationSW");
  out = out.replace("export default translationEN;", "export default translationSW;");
  const sorted = [...reps.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [k, v] of sorted) out = out.split(k).join(v);
  fs.writeFileSync(SW_PATH, out);

  console.log("Applied Swahili values:", applied);
  console.log("Unknown keys skipped:", unknownKeys.length);
  for (const k of unknownKeys) console.log("  - " + k);
  console.log("Wrote " + SW_PATH);
}

main();
