/**
 * 通关庆祝特效编排
 *
 * 抽离动机：
 *   - playGoalCelebration 是一段独立的「定时编排」，与 Game 的状态机本职无关
 *   - 拆出后 Game.ts 收敛到「关卡 / 状态 / 主循环」核心职责
 */

import { audio } from '../core/Audio';
import type { Renderer } from '../core/Renderer';
import type { Hud } from '../ui/Hud';
import type { ParticleSystem } from './Particles';
import type { Theme } from '../config/theme';

export interface CelebrationOptions {
  particles: ParticleSystem;
  renderer: Renderer;
  hud: Hud;
  theme: Theme;
  exitX: number;
  exitY: number;
  stars: number;
  /**
   * 守卫：每个延时回调执行前都会调用一次。返回 false 时跳过这一波。
   * 用于防止「通关后用户立刻退出」时仍然爆发粒子的边界场景。
   */
  isStillActive: () => boolean;
}

/**
 * 终点庆祝序列：
 *   - 立刻播放 level_complete 辉煌音效（合成大三和弦琶音）
 *   - 在出口位置爆发多波粒子（金色 + 主题色），形成「烟花」效果
 *   - 轻微震动 + 高亮提示文案
 *   - 根据星级追加 star_rating 音效点缀
 */
export function playGoalCelebration(opt: CelebrationOptions): void {
  const { particles, renderer, hud, theme, exitX: ex, exitY: ey, stars, isStillActive } = opt;

  // 主胜利音效
  audio.playSfx('level_complete');

  // 轻微震动制造冲击感
  renderer.triggerShake(2.5, 0.35);

  // 第一波：玩家所在格 大爆发（主题色）
  particles.burst(ex, ey, theme.accent, 36);

  // 第二波：金色环（180ms 后）
  setTimeout(() => {
    if (!isStillActive()) return;
    particles.burst(ex, ey, '#ffd76a', 28);
    audio.playSfx('star_rating');
  }, 180);

  // 第三波：玩家高光色（380ms 后）
  setTimeout(() => {
    if (!isStillActive()) return;
    particles.burst(ex, ey, theme.playerGlow, 24);
  }, 380);

  // 第四波：再来一发金色尾焰（620ms 后）
  setTimeout(() => {
    if (!isStillActive()) return;
    particles.burst(ex, ey, '#fff3b0', 20);
  }, 620);

  // 根据星级追加额外烟花
  if (stars >= 3) {
    setTimeout(() => {
      if (!isStillActive()) return;
      particles.burst(ex, ey, '#ffd76a', 30);
      audio.playSfx('star_rating', { rate: 1.25 });
    }, 900);
  }

  // Toast 通关提示
  const tip = stars >= 3 ? '完美通关！' : stars === 2 ? '顺利通关！' : '通关！';
  hud.showToast(tip, 1500);
}
