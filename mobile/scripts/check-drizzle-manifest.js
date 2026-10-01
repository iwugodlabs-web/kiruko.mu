/**
 * Drizzle manifest consistency check (no dependencies — plain node).
 *
 * Asserts three sources agree, run in CI on every mobile change:
 *   1. `drizzle/meta/_journal.json` entries (idx 0..n, tags)
 *   2. `drizzle/migrations.js` SQL imports (`./NNNN_tag.sql`)
 *   3. `drizzle/NNNN_tag.sql` files on disk
 *
 * Two production incidents came from skew here (a journal entry with no
 * manifest export → missing table on device; a manifest import with no SQL
 * file → bundler crash). Exit non-zero with a loud message on any mismatch.
 *
 * Usage: node scripts/check-drizzle-manifest.js  (run from mobile/)
 */
const fs = require("fs");
const path = require("path");

const drizzleDir = path.join(__dirname, "..", "drizzle");

function fail(msg) {
  console.error(`\n❌ drizzle manifest check FAILED: ${msg}\n`);
  process.exit(1);
}

// 1. Journal entries, in idx order.
const journal = JSON.parse(
  fs.readFileSync(path.join(drizzleDir, "meta", "_journal.json"), "utf8"),
);
const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
entries.forEach((e, i) => {
  if (e.idx !== i) fail(`journal idx gap: expected ${i}, found ${e.idx}`);
});
const journalFiles = entries.map((e) => `${e.tag}.sql`);

// 2. SQL imports in migrations.js.
const manifest = fs.readFileSync(path.join(drizzleDir, "migrations.js"), "utf8");
const imported = [...manifest.matchAll(/from\s+["']\.\/(\d+_[^"']+\.sql)["']/g)].map(
  (m) => m[1],
);

// 3. SQL files on disk (excluding meta/).
const onDisk = fs
  .readdirSync(drizzleDir)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort();

const asSet = (arr) => new Set(arr);
const journalSet = asSet(journalFiles);
const importedSet = asSet(imported);
const diskSet = asSet(onDisk);

for (const f of journalFiles) {
  if (!importedSet.has(f)) fail(`journal lists ${f} but migrations.js does not import it (table will never be created on device)`);
  if (!diskSet.has(f)) fail(`journal lists ${f} but the SQL file is missing (bundler crash: path could not be found)`);
}
for (const f of imported) {
  if (!journalSet.has(f)) fail(`migrations.js imports ${f} which the journal does not list (migrator will never apply it)`);
}
const extras = onDisk.filter((f) => !journalSet.has(f));
if (extras.length > 0) {
  fail(`SQL files with no journal entry (dead files that confuse the next generate): ${extras.join(", ")}`);
}

console.log(`✅ drizzle manifest check passed (${onDisk.length} migrations: ${onDisk.join(", ")})`);
