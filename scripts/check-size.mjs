// Prüft die Ladegröße des Client-Builds. Bricht ab, wenn sie über 5 MB liegt.
// Aufruf: node scripts/check-size.mjs client/dist
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const LIMIT_BYTES = 5 * 1024 * 1024;
const dir = process.argv[2] ?? 'client/dist';

/** @returns {{ path: string, size: number }[]} */
function walk(d) {
  return readdirSync(d).flatMap((name) => {
    const p = join(d, name);
    const st = statSync(p);
    return st.isDirectory() ? walk(p) : [{ path: relative(dir, p), size: st.size }];
  });
}

let files;
try {
  files = walk(dir);
} catch {
  console.error(`✖ Ordner ${dir} nicht gefunden – erst "pnpm build" ausführen.`);
  process.exit(1);
}

const total = files.reduce((sum, f) => sum + f.size, 0);
const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
for (const f of files.sort((a, b) => b.size - a.size).slice(0, 8)) {
  console.log(`  ${kb(f.size).padStart(10)}  ${f.path}`);
}
const pct = ((total / LIMIT_BYTES) * 100).toFixed(1);
if (total > LIMIT_BYTES) {
  console.error(`✖ Ladegröße ${kb(total)} – über dem Limit von 5 MB!`);
  process.exit(1);
}
console.log(`✔ Ladegröße ${kb(total)} (${pct} % von 5 MB)`);
