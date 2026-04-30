import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

async function copyDir(srcDir, destDir) {
  await ensureDir(destDir);
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  await Promise.all(entries.map(async (e) => {
    const src = path.join(srcDir, e.name);
    const dest = path.join(destDir, e.name);
    if (e.isDirectory()) return copyDir(src, dest);
    if (e.isFile()) return copyFile(src, dest);
  }));
}

function injectIntoHead(html, injection) {
  if (html.includes(injection.trim())) return html;
  const idx = html.indexOf("</head>");
  if (idx === -1) throw new Error("index.html is missing </head>");
  return `${html.slice(0, idx)}\n${injection}\n${html.slice(idx)}`;
}

async function main() {
  const distDir = path.join(root, "dist");

  // Copy PWA static assets into dist
  await copyFile(path.join(root, "web", "manifest.json"), path.join(distDir, "web", "manifest.json"));
  await copyDir(path.join(root, "web", "icons"), path.join(distDir, "web", "icons"));

  // (Optional) also provide a PNG favicon alongside expo's favicon.ico
  const webFaviconPng = path.join(root, "web", "favicon.png");
  try {
    await copyFile(webFaviconPng, path.join(distDir, "web", "favicon.png"));
  } catch {
    // ignore if missing
  }

  // Patch dist/index.html with iOS + manifest links
  const indexPath = path.join(distDir, "index.html");
  const html = await fs.readFile(indexPath, "utf8");

  const injection = [
    '  <meta name="apple-mobile-web-app-capable" content="yes" />',
    '  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
    '  <meta name="apple-mobile-web-app-title" content="Synapse" />',
    '  <link rel="apple-touch-icon" href="/web/icons/apple-touch-icon.png" />',
    '  <link rel="manifest" href="/web/manifest.json" />',
  ].join("\n");

  let patched = injectIntoHead(html, injection);
  // Respect display cutouts on notched devices (safe-area + avoids odd fixed overlays at edges)
  patched = patched.replace(
    /<meta\s+name="viewport"\s+content="([^"]*)"\s*\/?>/i,
    (match, content) => {
      if (/viewport-fit\s*=\s*cover/i.test(content)) return match;
      const next = content.includes("viewport-fit") ? content : `${content},viewport-fit=cover`;
      return `<meta name="viewport" content="${next}" />`;
    }
  );
  await fs.writeFile(indexPath, patched, "utf8");

  // eslint-disable-next-line no-console
  console.log("Post-export PWA patch complete.");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

