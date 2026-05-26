/**
 * 生成 PWA 图标。
 *
 * 输入：public/favicon.svg
 * 输出：
 *   public/icons/icon-192.png      192×192    标准图标
 *   public/icons/icon-512.png      512×512    标准图标（高分辨率）
 *   public/icons/icon-maskable.png 512×512    maskable 图标（带安全边距，让 Android 能裁切成圆/方/其他形状）
 *   public/icons/apple-touch-icon.png 180×180 iOS 主屏图标（不能透明，必须实色背景）
 *
 * 用法：
 *   node scripts/gen-pwa-icons.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../public/favicon.svg');
const OUT_DIR = resolve(__dirname, '../public/icons');

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const svgBuf = readFileSync(SRC);

/**
 * 标准图标：直接渲染 svg → PNG，背景沿用 SVG 中的 #F5EFE6
 * 用于 manifest icons 数组中 `purpose: 'any'`
 */
async function renderStandard(size, outName) {
  const png = await sharp(svgBuf, { density: 600 })
    .resize(size, size, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const outPath = resolve(OUT_DIR, outName);
  writeFileSync(outPath, png);
  console.log(`✓ ${outName}  ${png.length} bytes`);
}

/**
 * Maskable 图标：Android 把图标裁切成圆/方/水滴等形状时，
 * 内容必须保留在中央 80% 圆形 "safe zone" 内，否则会被切掉。
 * 我们的做法：把 svg 缩到 60% 居中，外圈保留实色背景。
 */
async function renderMaskable(size, outName) {
  const inner = Math.round(size * 0.6); // 内容只占 60%，留 20% 安全边距
  const innerPng = await sharp(svgBuf, { density: 600 })
    .resize(inner, inner, { fit: 'fill' })
    .png()
    .toBuffer();
  const png = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 245, g: 239, b: 230, alpha: 1 }, // 与 svg 背景一致
    },
  })
    .composite([{ input: innerPng, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  const outPath = resolve(OUT_DIR, outName);
  writeFileSync(outPath, png);
  console.log(`✓ ${outName}  ${png.length} bytes`);
}

await Promise.all([
  renderStandard(192, 'icon-192.png'),
  renderStandard(512, 'icon-512.png'),
  renderStandard(180, 'apple-touch-icon.png'),
  renderMaskable(512, 'icon-maskable.png'),
]);

console.log('\nAll icons generated.');
