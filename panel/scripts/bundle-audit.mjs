import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

function fmtBytes(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const dp = i === 0 ? 0 : i === 1 ? 1 : 2;
  return `${v.toFixed(dp)} ${units[i]}`;
}

async function walk(dir) {
  const out = [];
  const items = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of items) {
    const fp = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(fp)));
    else out.push(fp);
  }
  return out;
}

async function main() {
  const root = process.cwd();
  const nextDir = path.join(root, ".next");
  const chunksDir = path.join(nextDir, "static", "chunks");
  const devDir = path.join(nextDir, "static", "development");

  try {
    await fs.access(nextDir);
  } catch {
    throw new Error(`Missing .next output. Run: npm run build`);
  }

  let hasDev = false;
  try {
    await fs.access(devDir);
    hasDev = true;
  } catch {
    // ignore
  }
  if (hasDev) {
    // eslint-disable-next-line no-console
    console.warn("[bundle-audit] Detected dev build artifacts. For real numbers, run: npm run build");
  }

  try {
    await fs.access(chunksDir);
  } catch {
    throw new Error(`Missing ${chunksDir}. Run: npm run build`);
  }

  const files = (await walk(chunksDir)).filter((fp) => fp.endsWith(".js"));
  const rows = [];
  for (const fp of files) {
    const rel = path.relative(nextDir, fp).replaceAll(path.sep, "/");
    const buf = await fs.readFile(fp);
    const gz = zlib.gzipSync(buf, { level: 9 });
    rows.push({ rel, raw: buf.length, gzip: gz.length });
  }

  rows.sort((a, b) => b.gzip - a.gzip);

  const top = Number(process.env.BUNDLE_AUDIT_TOP || "20");
  const max = Number.isFinite(top) ? Math.max(5, Math.min(100, Math.floor(top))) : 20;

  const totalRaw = rows.reduce((sum, r) => sum + r.raw, 0);
  const totalGzip = rows.reduce((sum, r) => sum + r.gzip, 0);

  // eslint-disable-next-line no-console
  console.log(`[bundle-audit] chunks: ${rows.length}`);
  // eslint-disable-next-line no-console
  console.log(`[bundle-audit] total (raw):  ${fmtBytes(totalRaw)}`);
  // eslint-disable-next-line no-console
  console.log(`[bundle-audit] total (gzip): ${fmtBytes(totalGzip)}`);
  // eslint-disable-next-line no-console
  console.log("");

  // eslint-disable-next-line no-console
  console.log("Top chunks (gzip):");
  for (const r of rows.slice(0, max)) {
    // eslint-disable-next-line no-console
    console.log(`- ${fmtBytes(r.gzip).padStart(10)} gzip  | ${fmtBytes(r.raw).padStart(10)} raw  | ${r.rel}`);
  }
}

await main();

