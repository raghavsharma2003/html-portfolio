// Emits -400 and -128 width JPEG variants for the small set of hero/avatar
// photos that get painted far smaller than their 900x900 source (audit
// docs/audit/2026-08-22-ui-perf.md, finding #6). Originals are kept: nothing
// downstream is repointed by this script, callers reference the variants
// explicitly via srcset/size selection.
//
// Run: node scripts/make-image-variants.mjs

import sharp from "sharp";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SOURCES = [
  "src/assets/meera.jpg",
  "src/assets/moments/meera-walk.jpg",
  "src/assets/moments/meera-reading.jpg",
  "src/assets/moments/meera-beach.jpg",
];

const VARIANTS = [
  { suffix: "-400", width: 400 },
  { suffix: "-128", width: 128 },
];

function fmtKB(bytes) {
  return `${(bytes / 1024).toFixed(1)}kB`;
}

const rows = [];

for (const rel of SOURCES) {
  const srcPath = path.join(ROOT, rel);
  if (!existsSync(srcPath)) {
    console.error(`missing source: ${rel}`);
    process.exitCode = 1;
    continue;
  }
  const srcBytes = statSync(srcPath).size;
  const ext = path.extname(srcPath);
  const base = srcPath.slice(0, -ext.length);

  for (const v of VARIANTS) {
    const outPath = `${base}${v.suffix}${ext}`;
    await sharp(srcPath)
      .resize({ width: v.width })
      .jpeg({ quality: 80, mozjpeg: true })
      .toFile(outPath);
    const outBytes = statSync(outPath).size;
    rows.push({
      file: path.relative(ROOT, outPath),
      srcBytes,
      outBytes,
    });
  }
}

console.log("source -> variant sizes:");
for (const r of rows) {
  console.log(
    `  ${r.file.padEnd(48)} ${fmtKB(r.srcBytes).padStart(10)} -> ${fmtKB(r.outBytes).padStart(10)}`,
  );
}
