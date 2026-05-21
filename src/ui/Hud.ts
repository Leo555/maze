/**
 * 游戏内 HUD：顶部信息条 + 右上按钮 + 右下小地图 + 移动端虚拟控制
 *
 * 与游戏场景双向绑定：场景调用 update() 推送数据，HUD 内部维护 DOM
 */

import type { LevelConfig } from '../config/levels';
import type { Theme } from '../config/theme';
import type { Direction } from '../core/Input';
import { formatTime } from '../core/utils';

export interface HudData {
  config: LevelConfig;
  theme: Theme;
  time: number; // 已用时（秒，正向）或剩余时间（倒计时）
  isCountdown: boolean;
  keysCollected: number;
  keysTotal: number;
  muted: boolean;
}

/** 是否触屏设备：用于决定是否渲染虚拟方向键 */
function isTouchDevice(): boolean {
  return (
    typeof window !== 'undefined' &&
    (('ontouchstart' in window) ||
      (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
      window.matchMedia?.('(pointer: coarse)').matches)
  );
}

/**
 * 简易明亮判定：返回 true 表示颜色偏「亮」（适合放在深色背景上）。
 * 用相对亮度公式 (0.299R + 0.587G + 0.114B) 判定，阈值 160。
 * 仅支持 #rgb / #rrggbb 颜色字符串。
 */
function isLightColor(color: string): boolean {
  let hex = color.trim().replace('#', '');
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (hex.length !== 6) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 160;
}

export class Hud {
  root: HTMLElement;
  private topBar!: HTMLElement;
  private timerEl!: HTMLElement;
  private keysEl!: HTMLElement;
  private muteBtn!: HTMLElement;
  private minimapContainer!: HTMLElement;
  private toastEl!: HTMLElement;
  private bestPathBtn: HTMLButtonElement | null = null;

  onMuteToggle: (() => void) | null = null;
  onPause: (() => void) | null = null;
  /** 触屏方向键：按下/松开 */
  onTouchDirStart: ((dir: Direction) => void) | null = null;
  onTouchDirEnd: ((dir: Direction) => void) | null = null;
  /** 彩蛋：用户点击「关闭最佳路径」按钮 */
  onCloseBestPath: (() => void) | null = null;

  readonly isTouch: boolean;

  constructor(root: HTMLElement) {
    this.root = root;
    this.isTouch = isTouchDevice();
    this.build();
  }

  private build(): void {
    this.root.innerHTML = '';

    // 顶部信息条
    this.topBar = document.createElement('div');
    this.topBar.className = 'hud-top';
    this.timerEl = document.createElement('div');
    this.timerEl.className = 'item timer';
    this.timerEl.innerHTML = `<span class="icon">⏱</span><span class="value">00:00</span>`;
    this.keysEl = document.createElement('div');
    this.keysEl.className = 'item keys';
    this.keysEl.innerHTML = `<span class="icon">🔑</span><span class="value">0/0</span>`;

    this.topBar.appendChild(this.timerEl);
    this.topBar.appendChild(this.keysEl);
    this.root.appendChild(this.topBar);

    // 右上按钮组
    const corner = document.createElement('div');
    corner.className = 'hud-corner';
    this.muteBtn = document.createElement('button');
    this.muteBtn.className = 'hud-btn';
    this.muteBtn.title = '静音 (M)';
    this.muteBtn.textContent = '🔊';
    this.muteBtn.onclick = () => this.onMuteToggle?.();
    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'hud-btn';
    pauseBtn.title = '菜单 (Esc)';
    pauseBtn.textContent = '☰';
    pauseBtn.onclick = () => this.onPause?.();
    corner.appendChild(this.muteBtn);
    corner.appendChild(pauseBtn);
    this.root.appendChild(corner);

    // 小地图容器
    this.minimapContainer = document.createElement('div');
    this.minimapContainer.className = 'minimap';
    this.root.appendChild(this.minimapContainer);

    // Toast 容器
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    this.root.appendChild(this.toastEl);

    // 彩蛋：关闭最佳路径按钮（默认隐藏）
    this.bestPathBtn = document.createElement('button');
    this.bestPathBtn.className = 'best-path-btn';
    this.bestPathBtn.type = 'button';
    this.bestPathBtn.innerHTML =
      `<span class="x">✕</span><span class="lbl">关 闭 最 佳 路 径</span>`;
    this.bestPathBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.onCloseBestPath?.();
    });
    this.root.appendChild(this.bestPathBtn);

    // 触屏设备：构建虚拟方向键
    if (this.isTouch) {
      // 加 class，让 CSS 调整 minimap 等元素位置（避免与右下 D-pad 重叠）
      this.root.classList.add('has-touch-pad');
      this.buildTouchControls();
    }
  }

  /**
   * 移动端虚拟控制：
   *   - 右下「十字 D-pad」：上 / 下 / 左 / 右 四个圆角按钮
   *     · pointerdown 触发 onTouchDirStart（开始连续移动）
   *     · pointerup / pointercancel / pointerleave 触发 onTouchDirEnd
   */
  private buildTouchControls(): void {
    const pad = document.createElement('div');
    pad.className = 'touch-pad';
    pad.setAttribute('aria-label', '方向控制');

    const mkBtn = (dir: Direction, label: string, cls: string) => {
      const btn = document.createElement('button');
      btn.className = `touch-dir touch-dir-${cls}`;
      btn.type = 'button';
      btn.setAttribute('aria-label', label);
      btn.textContent = label;
      // 用 pointer 事件统一覆盖鼠标 / 触屏 / 触控笔
      const start = (e: Event) => {
        e.preventDefault();
        btn.classList.add('active');
        this.onTouchDirStart?.(dir);
      };
      const end = (e: Event) => {
        e.preventDefault();
        btn.classList.remove('active');
        this.onTouchDirEnd?.(dir);
      };
      btn.addEventListener('pointerdown', start);
      btn.addEventListener('pointerup', end);
      btn.addEventListener('pointercancel', end);
      btn.addEventListener('pointerleave', end);
      // 阻止 button 的隐式 click 触发额外效果
      btn.addEventListener('click', (e) => e.preventDefault());
      return btn;
    };

    pad.appendChild(mkBtn('up', '↑', 'up'));
    pad.appendChild(mkBtn('left', '←', 'left'));
    pad.appendChild(mkBtn('right', '→', 'right'));
    pad.appendChild(mkBtn('down', '↓', 'down'));
    this.root.appendChild(pad);
  }

  getMinimapContainer(): HTMLElement {
    return this.minimapContainer;
  }

  update(data: HudData): void {
    // 主题色应用到 CSS 变量
    this.root.style.setProperty('--hud-fg', data.theme.hudFg);
    this.root.style.setProperty('--accent', data.theme.exit);

    // 根据主题文字色推断主题明暗，给 HUD 元素自动选择合适的背景：
    //   - 浅色主题（hudFg 偏深，relativeLuminance < 0.5）：用半透明白底
    //   - 深色主题（hudFg 偏浅）：用半透明黑底
    // 这样在所有关卡下 HUD 文字都能保持高对比度
    const isDarkTheme = isLightColor(data.theme.hudFg);
    this.root.classList.toggle('hud-dark-theme', isDarkTheme);
    // 计时器
    const t = Math.max(0, data.time);
    const valueEl = this.timerEl.querySelector('.value') as HTMLElement;
    valueEl.textContent = formatTime(t);
    this.timerEl.classList.remove('warn', 'critical');
    if (data.isCountdown) {
      if (t <= 3) this.timerEl.classList.add('critical');
      else if (t <= 10) this.timerEl.classList.add('warn');
    }

    // 钥匙
    if (data.keysTotal > 0) {
      this.keysEl.style.display = '';
      const v = this.keysEl.querySelector('.value') as HTMLElement;
      v.textContent = `${data.keysCollected}/${data.keysTotal}`;
    } else {
      this.keysEl.style.display = 'none';
    }

    // 静音
    this.muteBtn.textContent = data.muted ? '🔇' : '🔊';
  }

  showToast(text: string, duration = 1600): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    setTimeout(() => this.toastEl.classList.remove('show'), duration);
  }

  /** 显示「关闭最佳路径」按钮（彩蛋触发后由 Game 调用） */
  showBestPathBtn(): void {
    this.bestPathBtn?.classList.add('show');
  }

  /** 隐藏「关闭最佳路径」按钮（用户主动关 / 关卡切换时调用） */
  hideBestPathBtn(): void {
    this.bestPathBtn?.classList.remove('show');
  }

  show(): void {
    this.root.style.display = '';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  destroy(): void {
    this.root.innerHTML = '';
    this.bestPathBtn = null;
  }
}
