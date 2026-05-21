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
  dashCooldownRatio: number; // 0~1
  muted: boolean;
}

/** 是否触屏设备：用于决定是否渲染虚拟方向键 / Dash 按钮 */
function isTouchDevice(): boolean {
  return (
    typeof window !== 'undefined' &&
    (('ontouchstart' in window) ||
      (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
      window.matchMedia?.('(pointer: coarse)').matches)
  );
}

export class Hud {
  root: HTMLElement;
  private topBar!: HTMLElement;
  private timerEl!: HTMLElement;
  private keysEl!: HTMLElement;
  private dashFill!: HTMLElement;
  private muteBtn!: HTMLElement;
  private minimapContainer!: HTMLElement;
  private toastEl!: HTMLElement;
  private dashBtn: HTMLButtonElement | null = null;
  private dashRing: HTMLElement | null = null;

  onMuteToggle: (() => void) | null = null;
  onPause: (() => void) | null = null;
  /** 触屏方向键：按下/松开 */
  onTouchDirStart: ((dir: Direction) => void) | null = null;
  onTouchDirEnd: ((dir: Direction) => void) | null = null;
  onDashTap: (() => void) | null = null;

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
    const dashItem = document.createElement('div');
    dashItem.className = 'item';
    dashItem.innerHTML = `<span class="icon">⚡</span>`;
    const dashBar = document.createElement('div');
    dashBar.className = 'dash-bar';
    this.dashFill = document.createElement('div');
    this.dashFill.className = 'fill';
    this.dashFill.style.width = '100%';
    dashBar.appendChild(this.dashFill);
    dashItem.appendChild(dashBar);

    this.topBar.appendChild(this.timerEl);
    this.topBar.appendChild(this.keysEl);
    this.topBar.appendChild(dashItem);
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

    // 触屏设备：构建虚拟方向键 + 冲刺按钮
    if (this.isTouch) {
      // 加 class，让 CSS 调整 minimap 等元素位置（避免与右下 D-pad 重叠）
      this.root.classList.add('has-touch-pad');
      this.buildTouchControls();
    }
  }

  /**
   * 移动端虚拟控制：
   *   - 左下「十字 D-pad」：上 / 下 / 左 / 右 四个圆角按钮
   *     · pointerdown 触发 onTouchDirStart（开始连续移动）
   *     · pointerup / pointercancel / pointerleave 触发 onTouchDirEnd
   *   - 右下「冲刺按钮」：tap 触发 onDashTap（与键盘 Shift 等价）
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

    // 冲刺按钮
    const dash = document.createElement('button');
    dash.className = 'touch-dash';
    dash.type = 'button';
    dash.setAttribute('aria-label', '冲刺');
    dash.innerHTML = `<span class="ring"></span><span class="icon">⚡</span>`;
    dash.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dash.classList.add('active');
    });
    const release = () => dash.classList.remove('active');
    dash.addEventListener('pointerup', (e) => {
      e.preventDefault();
      release();
      this.onDashTap?.();
    });
    dash.addEventListener('pointercancel', release);
    dash.addEventListener('pointerleave', release);
    dash.addEventListener('click', (e) => e.preventDefault());
    this.root.appendChild(dash);
    this.dashBtn = dash;
    this.dashRing = dash.querySelector('.ring');
  }

  getMinimapContainer(): HTMLElement {
    return this.minimapContainer;
  }

  update(data: HudData): void {
    // 主题色应用到 CSS 变量
    this.root.style.setProperty('--hud-fg', data.theme.hudFg);
    this.root.style.setProperty('--accent', data.theme.exit);

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

    // 冲刺冷却
    const ratio = Math.round(data.dashCooldownRatio * 100);
    this.dashFill.style.width = `${ratio}%`;
    if (this.dashBtn && this.dashRing) {
      // 用 conic-gradient 模拟环形进度
      this.dashRing.style.background = `conic-gradient(var(--accent, #e8a87c) ${ratio * 3.6}deg, rgba(255,255,255,0.12) 0deg)`;
      this.dashBtn.classList.toggle('ready', ratio >= 100);
    }

    // 静音
    this.muteBtn.textContent = data.muted ? '🔇' : '🔊';
  }

  showToast(text: string, duration = 1600): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    setTimeout(() => this.toastEl.classList.remove('show'), duration);
  }

  show(): void {
    this.root.style.display = '';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  destroy(): void {
    this.root.innerHTML = '';
    this.dashBtn = null;
    this.dashRing = null;
  }
}
