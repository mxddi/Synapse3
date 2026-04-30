import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function renderSvgToPng({ inputSvgPath, outputPngPath, size }) {
  const svg = await fs.readFile(inputSvgPath);
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: "cover" })
    .png()
    .toFile(outputPngPath);
}

async function main() {
  const assetsDir = path.join(root, "assets");
  const webIconsDir = path.join(root, "web", "icons");

  const paddedSvg = path.join(assetsDir, "app-icon-padded.svg");
  const foregroundSvg = path.join(assetsDir, "app-icon-foreground.svg");

  await ensureDir(webIconsDir);

  // Expo native app icons
  await renderSvgToPng({ inputSvgPath: paddedSvg, outputPngPath: path.join(assetsDir, "app-icon.png"), size: 1024 });
  await renderSvgToPng({ inputSvgPath: foregroundSvg, outputPngPath: path.join(assetsDir, "app-icon-foreground.png"), size: 1024 });

  // PWA / iOS A2HS
  await renderSvgToPng({ inputSvgPath: paddedSvg, outputPngPath: path.join(webIconsDir, "apple-touch-icon.png"), size: 180 });
  await renderSvgToPng({ inputSvgPath: paddedSvg, outputPngPath: path.join(webIconsDir, "icon-192.png"), size: 192 });
  await renderSvgToPng({ inputSvgPath: paddedSvg, outputPngPath: path.join(webIconsDir, "icon-512.png"), size: 512 });

  // Simple favicon (PNG). Some hosts will convert to ICO; Expo export also emits favicon.ico.
  await renderSvgToPng({ inputSvgPath: paddedSvg, outputPngPath: path.join(root, "web", "favicon.png"), size: 48 });

  // eslint-disable-next-line no-console
  console.log("Generated icons:", {
    appIcon: "assets/app-icon.png",
    adaptiveForeground: "assets/app-icon-foreground.png",
    pwa: ["web/icons/apple-touch-icon.png", "web/icons/icon-192.png", "web/icons/icon-512.png", "web/favicon.png"],
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

