/**
 * 彩蛋：右上角连点显示最佳路径
 *
 * 玩法：
 *   - 在右上角 100×100 的热区内于 8 秒滑动窗口里连点 10 次
 *   - 触发后基于「玩家当前位置 → 剩余钥匙 → 出口」用 BFS + bitmask DP 求最短路
 *   - 路径常驻显示，由 HUD 上的「✕ 关闭最佳路径」按钮主动关闭
 *
 * 隔离动机：
 *   - 与主玩法完全解耦，单独成模块便于关闭/调参/迭代
 *   - 让 Game.ts 收敛到「状态机 + 主循环」本职，不被周边特性侵入
 */

import { audio } from './Audio';
import type { Renderer } from './Renderer';
import type { Hud } from '../ui/Hud';
import type { Player } from '../entities/Player';
import type { LevelRuntime } from '../maze/LevelBuilder';
import {
  shortestPath,
  shortestPathThroughWaypoints,
} from '../maze/Generator';

/** 彩蛋触发参数 */
const TARGET_CLICKS = 10;
const WINDOW_MS = 8000;
/** 右上角触发热区尺寸（px） */
const HOTSPOT = 100;

/**
 * 宿主接口：彩蛋仅在「正在游玩」时才有效。
 * 由 Game 注入访问当前关卡 / 玩家以及 toast。
 */
export interface EasterEggHost {
  isPlaying(): boolean;
  getLevel(): LevelRuntime | null;
  getPlayer(): Player | null;
  getRenderer(): Renderer;
  getHud(): Hud;
}

export class EasterEgg {
  private clicks: number[] = [];
  private host: EasterEggHost;
  private removeListener: (() => void) | null = null;

  constructor(host: EasterEggHost) {
    this.host = host;
  }

  /**
   * 监听 window pointerdown（capture）：
   *   - 命中右上角热区 → 滑动窗口计数
   *   - 达到目标 → 触发显示最佳路径
   *   - 过半 → 给进度提示让玩家知道彩蛋存在
   */
  install(): void {
    const handler = (e: PointerEvent): void => {
      if (!this.host.isPlaying()) return;
      const w = window.innerWidth;
      const inHotspot = e.clientX >= w - HOTSPOT && e.clientY <= HOTSPOT;
      if (!inHotspot) return;

      const now = performance.now();
      // 滑动窗口：剔除超时的点击（保持数组短小，无需复杂结构）
      this.clicks = this.clicks.filter((t) => now - t < WINDOW_MS);
      this.clicks.push(now);

      const count = this.clicks.length;
      if (count >= TARGET_CLICKS) {
        this.clicks.length = 0;
        this.trigger();
        return;
      }
      if (count >= Math.floor(TARGET_CLICKS / 2)) {
        const remain = TARGET_CLICKS - count;
        this.host.getHud().showToast(`再点 ${remain} 次解锁彩蛋`, 800);
      }
    };
    window.addEventListener('pointerdown', handler, { capture: true });
    this.removeListener = () =>
      window.removeEventListener('pointerdown', handler, { capture: true });
  }

  destroy(): void {
    this.removeListener?.();
    this.removeListener = null;
    this.clicks.length = 0;
  }

  /** 计算并显示当前关卡的最优路径（途经所有未拾取钥匙）；由用户主动关闭 */
  private trigger(): void {
    const level = this.host.getLevel();
    const player = this.host.getPlayer();
    if (!level || !player) return;

    // 起点：玩家当前格（更直观地告诉玩家「下一步往哪走」）
    const from = { x: player.state.gx, y: player.state.gy };
    const exit = level.maze.exit;

    // 关键：本关需要钥匙时，路径必须先依次经过所有「尚未拾取」的钥匙再到出口
    // 否则路径会指向出口但其实门没开，玩家照走会走冤枉路
    const remainingKeys = level.entities
      .filter((e) => e.active && e.kind === 'key')
      .map((e) => ({ x: e.x, y: e.y }));

    const path =
      remainingKeys.length > 0
        ? shortestPathThroughWaypoints(level.maze, from, remainingKeys, exit)
        : shortestPath(level.maze, from, exit);
    if (path.length < 2) return;

    this.host.getRenderer().showBestPath(path);
    this.host.getHud().showBestPathBtn();
    audio.playSfx('pickup_map'); // 借用「地图碎片」音效，氛围契合
    const tip =
      remainingKeys.length > 0
        ? `✨ 最佳路径已显示 · 途经 ${remainingKeys.length} 把钥匙`
        : '✨ 最佳路径已显示';
    this.host.getHud().showToast(tip, 2000);
  }

  /** 由用户点击「关闭最佳路径」按钮触发 */
  close(): void {
    this.host.getRenderer().clearBestPath();
    this.host.getHud().hideBestPathBtn();
    audio.playSfx('ui_close');
  }
}
