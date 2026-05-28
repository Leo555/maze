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
  /** 关卡指示项（仅触屏设备渲染），用于在小屏上随时知道"我现在在第几关" */
  private levelEl: HTMLElement | null = null;
  private levelValueEl: HTMLElement | null = null;
  private timerEl!: HTMLElement;
  /** 缓存 timer / keys 内部 .value 节点，避免每帧 querySelector */
  private timerValueEl!: HTMLElement;
  private keysEl!: HTMLElement;
  private keysValueEl!: HTMLElement;
  private muteBtn!: HTMLElement;
  private minimapContainer!: HTMLElement;
  private toastEl!: HTMLElement;
  private bestPathBtn: HTMLButtonElement | null = null;

  // 上一次写入 HUD 的值，用于 diff，避免无意义的 textContent 赋值
  private lastTimerText = '';
  private lastTimerLevel: '' | 'warn' | 'critical' = '';
  private lastKeysText = '';
  private lastKeysVisible = false;
  private lastLevelId = -1;
  private lastMuted: boolean | null = null;
  private lastHudFg = '';
  private lastAccent = '';
  private lastDarkTheme: boolean | null = null;

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

    // 关卡指示（仅触屏设备渲染）：放最左侧，让玩家随时确认"我在第几关"
    // PC 端不显示：屏幕大、按 Esc 进菜单或看 URL hash 都能看到关卡，避免冗余
    if (this.isTouch) {
      this.levelEl = document.createElement('div');
      this.levelEl.className = 'item level';
      this.levelEl.innerHTML =
        `<span class="icon">🚩</span><span class="value">1</span>`;
      this.levelValueEl = this.levelEl.querySelector('.value') as HTMLElement;
      this.topBar.appendChild(this.levelEl);
    }

    this.timerEl = document.createElement('div');
    this.timerEl.className = 'item timer';
    this.timerEl.innerHTML = `<span class="icon">⏱</span><span class="value">00:00</span>`;
    this.timerValueEl = this.timerEl.querySelector('.value') as HTMLElement;
    this.keysEl = document.createElement('div');
    this.keysEl.className = 'item keys';
    this.keysEl.innerHTML = `<span class="icon">🔑</span><span class="value">0/0</span>`;
    this.keysValueEl = this.keysEl.querySelector('.value') as HTMLElement;

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
   * 移动端虚拟控制（v2 扇形 D-pad）：
   *   - 整个 pad 是一个大触控区（180×180），按下后用「指针位置 → 角度 → 扇区」
   *     判定方向，4 个 90° 扇区无缝邻接，没有死区，中心区域也归属
   *     最近的方向，不再有"按到中间没反应"的尴尬
   *   - pointerdown：根据落点判定方向 → onTouchDirStart
   *   - pointermove：手指滑到其他扇区时，自动切换方向（先 End 旧方向再 Start 新方向）
   *   - pointerup / pointercancel / 离开 window：onTouchDirEnd
   *
   *   设计权衡：
   *     · 不再用 4 个独立 button，而是 1 个 container + 4 个纯视觉箭头
   *     · 视觉箭头 pointer-events:none，不参与事件，只负责显示状态
   *     · 中心圆点是"指针轨迹反馈"，可视化拇指滑动方向
   */
  private buildTouchControls(): void {
    const pad = document.createElement('div');
    pad.className = 'touch-pad';
    pad.setAttribute('aria-label', '方向控制');

    // 4 个纯视觉箭头 + 1 个中心点（都不接收事件）
    const arrows: Record<Direction, HTMLElement> = {
      up: this.mkArrow('up', '↑'),
      left: this.mkArrow('left', '←'),
      right: this.mkArrow('right', '→'),
      down: this.mkArrow('down', '↓'),
    };
    const center = document.createElement('div');
    center.className = 'touch-pad-center';
    pad.appendChild(arrows.up);
    pad.appendChild(arrows.left);
    pad.appendChild(arrows.right);
    pad.appendChild(arrows.down);
    pad.appendChild(center);

    let activeDir: Direction | null = null;
    let activePointer: number | null = null;

    /** 根据指针在 pad 容器内的坐标判定方向（4 扇区，每 90°） */
    const dirFromPoint = (x: number, y: number, rect: DOMRect): Direction => {
      // 以 pad 中心为原点；y 轴向下为正（屏幕坐标系）
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const dx = x - cx;
      const dy = y - cy;
      // 用 |dx| vs |dy| 划分扇区：水平大就左/右；垂直大就上/下
      // 这样划出的 4 个区是 4 个三角形，邻接无死区
      if (Math.abs(dx) > Math.abs(dy)) {
        return dx >= 0 ? 'right' : 'left';
      }
      return dy >= 0 ? 'down' : 'up';
    };

    const setActiveDir = (next: Direction): void => {
      if (next === activeDir) return;
      // 切换方向：先结束旧的，再开始新的
      if (activeDir) {
        arrows[activeDir].classList.remove('active');
        this.onTouchDirEnd?.(activeDir);
      }
      activeDir = next;
      arrows[next].classList.add('active');
      this.onTouchDirStart?.(next);
    };

    const clearActive = (): void => {
      if (activeDir) {
        arrows[activeDir].classList.remove('active');
        this.onTouchDirEnd?.(activeDir);
        activeDir = null;
      }
      pad.classList.remove('pressed');
      activePointer = null;
    };

    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // 多指场景：仅响应第一个落下的指针，避免左手放屏幕上误触
      if (activePointer !== null) return;
      activePointer = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      pad.classList.add('pressed');
      const rect = pad.getBoundingClientRect();
      setActiveDir(dirFromPoint(e.clientX - rect.left, e.clientY - rect.top, rect));
    });

    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activePointer) return;
      const rect = pad.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // 在 pad 容器外较远时仍保持当前方向，避免滑出边缘瞬间误清；
      // 留 25% 容差圈：超过这个圈就判定"手离开了"，结束当前方向
      const EXIT_PAD = 0.25;
      const insideX = x >= -rect.width * EXIT_PAD && x <= rect.width * (1 + EXIT_PAD);
      const insideY = y >= -rect.height * EXIT_PAD && y <= rect.height * (1 + EXIT_PAD);
      if (!insideX || !insideY) {
        clearActive();
        return;
      }
      setActiveDir(dirFromPoint(x, y, rect));
    });

    const onEnd = (e: PointerEvent): void => {
      if (e.pointerId !== activePointer) return;
      clearActive();
    };
    pad.addEventListener('pointerup', onEnd);
    pad.addEventListener('pointercancel', onEnd);
    // 浏览器/系统级中断（如来电）：兜底清理
    window.addEventListener('blur', () => clearActive());

    this.root.appendChild(pad);
  }

  /** 创建 D-pad 内部的纯视觉箭头元素（不接收事件） */
  private mkArrow(dir: Direction, label: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `touch-arrow touch-arrow-${dir}`;
    el.textContent = label;
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  getMinimapContainer(): HTMLElement {
    return this.minimapContainer;
  }

  update(data: HudData): void {
    // 主题色应用到 CSS 变量（diff：仅在变化时写）
    if (data.theme.hudFg !== this.lastHudFg) {
      this.root.style.setProperty('--hud-fg', data.theme.hudFg);
      this.lastHudFg = data.theme.hudFg;
    }
    if (data.theme.exit !== this.lastAccent) {
      this.root.style.setProperty('--accent', data.theme.exit);
      this.lastAccent = data.theme.exit;
    }

    // 根据主题文字色推断主题明暗，给 HUD 元素自动选择合适的背景：
    //   - 浅色主题（hudFg 偏深，relativeLuminance < 0.5）：用半透明白底
    //   - 深色主题（hudFg 偏浅）：用半透明黑底
    // 这样在所有关卡下 HUD 文字都能保持高对比度
    const isDarkTheme = isLightColor(data.theme.hudFg);
    if (isDarkTheme !== this.lastDarkTheme) {
      this.root.classList.toggle('hud-dark-theme', isDarkTheme);
      this.lastDarkTheme = isDarkTheme;
    }

    // 计时器（每秒只可能变 1 次，diff 命中率高）
    const t = Math.max(0, data.time);
    const timerText = formatTime(t);
    if (timerText !== this.lastTimerText) {
      this.timerValueEl.textContent = timerText;
      this.lastTimerText = timerText;
    }
    let level: '' | 'warn' | 'critical' = '';
    if (data.isCountdown) {
      if (t <= 3) level = 'critical';
      else if (t <= 10) level = 'warn';
    }
    if (level !== this.lastTimerLevel) {
      this.timerEl.classList.remove('warn', 'critical');
      if (level) this.timerEl.classList.add(level);
      this.lastTimerLevel = level;
    }

    // 钥匙
    const keysVisible = data.keysTotal > 0;
    if (keysVisible !== this.lastKeysVisible) {
      this.keysEl.style.display = keysVisible ? '' : 'none';
      this.lastKeysVisible = keysVisible;
    }
    if (keysVisible) {
      const keysText = `${data.keysCollected}/${data.keysTotal}`;
      if (keysText !== this.lastKeysText) {
        this.keysValueEl.textContent = keysText;
        this.lastKeysText = keysText;
      }
    }

    // 关卡号（仅触屏设备渲染了 levelEl）
    if (this.levelValueEl) {
      const levelId = data.config.id;
      if (levelId !== this.lastLevelId) {
        this.levelValueEl.textContent = String(levelId);
        this.lastLevelId = levelId;
      }
    }

    // 静音
    if (data.muted !== this.lastMuted) {
      this.muteBtn.textContent = data.muted ? '🔇' : '🔊';
      this.lastMuted = data.muted;
    }
  }

  /** Toast 自动隐藏的 timer 句柄；重复 showToast 会先取消上一次以避免被提前关掉 */
  private toastTimer: number | null = null;

  showToast(text: string, duration = 1600): void {
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove('show');
      this.toastTimer = null;
    }, duration);
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
    // 重新展示时清空 diff 缓存，确保下一次 update 必定写入一次（避免显示陈旧值）
    this.lastTimerText = '';
    this.lastKeysText = '';
    this.lastTimerLevel = '';
    this.lastKeysVisible = false;
    this.lastLevelId = -1;
    this.lastMuted = null;
    this.lastDarkTheme = null;
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  destroy(): void {
    this.root.innerHTML = '';
    this.bestPathBtn = null;
  }
}
