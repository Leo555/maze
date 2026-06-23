/**
 * 生成社交分享图。
 *
 * 输入：
 *   - public/og-cover.svg     横版 1200×630（Twitter / Facebook / Google 搜索卡）
 *   - public/og-square.svg    方版 1024×1024（微信 URL 卡 / itemprop=image / 朋友圈缩略图）
 *
 * 输出：
 *   - public/og-cover.png
 *   - public/og-square.png
 *
 * 为什么要两张：
 *   微信内嵌浏览器的 URL 链接卡片右侧缩略图槽是「方形中央裁切」，
 *   1200×630 横版会被裁掉左半的标题与迷宫缩影。方版把所有关键元素居中塞进
 *   1:1 画面，方形裁切完整可见。
 *
 *   index.html 里：
 *     - <meta itemprop="image">         → 方版（微信主要识别这条）
 *     - <meta property="og:image">      → 横版（Twitter/FB/Google 用横版完整展示）
 *     - <meta name="twitter:image">     → 横版（summary_large_image 1.91:1）
 *
 * 用法：
 *   node scripts/gen-og-images.mjs
 *   或：npm run gen:og
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 待生成图列表：每项是 [输入 SVG, 输出 PNG, 宽, 高] */
const TARGETS = [
  ['../public/og-cover.svg', '../public/og-cover.png', 1200, 630],
  ['../public/og-square.svg', '../public/og-square.png', 1024, 1024],
];

for (const [src, out, w, h] of TARGETS) {
  const srcPath = resolve(__dirname, src);
  const outPath = resolve(__dirname, out);
  const svgBuf = readFileSync(srcPath);
  // density=200：sharp 把 SVG 当作矢量在 200 DPI 下栅格化，再 resize 到目标尺寸；
  // 比默认 72 DPI 更清晰，文字/细线不糊。
  const png = await sharp(svgBuf, { density: 200 })
    .resize(w, h, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(outPath, png);
  console.log(`✓ ${outPath}  (${png.length} bytes)`);
}
