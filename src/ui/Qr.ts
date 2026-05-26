/**
 * 二维码生成模块（基于 qrcode-generator，纯 JS 算法，无网络依赖）
 *
 * 用于「同步进度」面板：
 *   - PC 浏览器看到自己的编号 → 点「显示二维码」→ 弹出二维码
 *   - 手机微信扫码 / Safari 扫码 → 跳到 https://maze.lz5z.com/?recover=xxxxxxxx
 *   - 前端 main.ts 检测到 ?recover= 参数后自动调 sync 恢复进度
 */

import qrcode from 'qrcode-generator';

/**
 * 生成 SVG 二维码字符串。
 * 使用 SVG 而非 Canvas 的原因：
 *   - 矢量、任意缩放清晰
 *   - 无需 DPR 处理，体积更小
 *   - 可直接 innerHTML 嵌入 DOM
 *
 * @param text       要编码的文本（URL）
 * @param sizePx     输出尺寸（CSS 像素），默认 220
 * @returns SVG 字符串
 */
export function generateQrSvg(text: string, sizePx = 220): string {
  // typeNumber = 0 表示\"自动\"——根据内容长度选最小够用的版本
  // errorCorrectionLevel:
  //   L = 7%（可容忍 7% 像素被遮挡仍能解码）
  //   M = 15%（默认推荐）
  //   Q = 25%
  //   H = 30%（图标 / Logo 嵌中心常用）
  // 我们的内容是短 URL（~40 字符），用 'M' 性价比最好
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const moduleCount = qr.getModuleCount();
  // 每个模块的像素大小（向下取整，避免 CSS 模糊）
  const cell = Math.floor(sizePx / moduleCount);
  // 边距（quiet zone）：QR 规范要求至少 4 个模块
  const margin = cell * 4;
  const total = moduleCount * cell + margin * 2;

  // 拼接 SVG path：所有黑色模块拼成一个 path，体积最小
  let path = '';
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (qr.isDark(r, c)) {
        const x = margin + c * cell;
        const y = margin + r * cell;
        path += `M${x} ${y}h${cell}v${cell}h-${cell}z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${sizePx}" height="${sizePx}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path fill="#1a1a1a" d="${path}"/></svg>`;
}
