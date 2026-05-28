/**
 * 「查看最佳路径」浮窗。
 *
 * 与其它 scene 不同，这个浮窗刻意做得轻量：
 *   - 不遮挡迷宫主视图（只占顶部一小条）
 *   - 不阻断 canvas 渲染（迷宫和最佳路径线都仍可见）
 *   - 仅展示提示 + 关闭按钮
 *
 * 关闭按钮调用 onClose，由 Game 切回 transition 状态并重新展示结算/失败页。
 */

import { audio } from '../../core/Audio';
import { attachClickSfx, showOverlay } from './shared';

export function showOptimalReview(
  data: { steps: number; optimal: number; passed: boolean; hasPlayerPath: boolean },
  onClose: () => void
): void {
  audio.playSfx('ui_open');

  const scene = document.createElement('div');
  scene.className = 'scene scene-review';

  const card = document.createElement('div');
  card.className = 'scene-card review-card';

  const efficiency =
    data.optimal > 0 ? Math.min(100, Math.round((data.optimal / data.steps) * 100)) : 100;
  const tip = data.passed
    ? `你走了 ${data.steps} 步 · 最优 ${data.optimal} 步 · 效率 ${efficiency}%`
    : `本关最优解：${data.optimal} 步`;

  // 图例：仅当玩家轨迹存在时显示蓝色项；最优路径始终显示
  const legendHtml = `
    <div class="review-legend">
      <span class="legend-item">
        <span class="legend-dot legend-dot-best"></span>最 佳 路 径
      </span>
      ${
        data.hasPlayerPath
          ? `<span class="legend-item">
               <span class="legend-dot legend-dot-player"></span>你 的 轨 迹
             </span>`
          : ''
      }
    </div>
  `;

  card.innerHTML = `
    <div class="scene-title">最 佳 路 径</div>
    <div class="scene-subtitle">${tip}</div>
    ${legendHtml}
  `;

  const btnGroup = document.createElement('div');
  btnGroup.className = 'btn-group';
  const back = document.createElement('button');
  back.className = 'btn primary';
  back.textContent = '返 回 结 算';
  attachClickSfx(back);
  back.onclick = () => onClose();
  btnGroup.appendChild(back);
  card.appendChild(btnGroup);

  scene.appendChild(card);
  showOverlay(scene);
}
