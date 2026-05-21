/**
 * 生成社交分享图：把 public/og-cover.svg 渲染为 1200×630 PNG。
 *
 * 用法：
 *   node scripts/gen-og-cover.mjs
 *
 * 产物：
 *   public/og-cover.png
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../public/og-cover.svg');
const OUT = resolve(__dirname, '../public/og-cover.png');

const svgBuf = readFileSync(SRC);

const png = await sharp(svgBuf, { density: 200 }) // 高 density 让 SVG 文字渲染更清晰
  .resize(1200, 630, { fit: 'fill' })
  .png({ compressionLevel: 9 })
  .toBuffer();

writeFileSync(OUT, png);
console.log(`✓ Generated ${OUT} (${png.length} bytes)`);
