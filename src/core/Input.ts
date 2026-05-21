/**
 * 输入管理器：聚合键盘 + 触屏滑动
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

type Listener = {
  onDirection?: (dir: Direction) => void;
  onPause?: () => void;
};

export class InputManager {
  private listeners: Listener[] = [];
  private keys = new Set<string>();
  private touchStart: { x: number; y: number; t: number } | null = null;
  private repeatTimer: number | null = null;

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('touchstart', this.onTouchStart, { passive: true });
    window.addEventListener('touchend', this.onTouchEnd, { passive: true });
    window.addEventListener('blur', this.releaseAll);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('touchend', this.onTouchEnd);
    window.removeEventListener('blur', this.releaseAll);
    if (this.repeatTimer) clearInterval(this.repeatTimer);
  }

  subscribe(l: Listener): () => void {
    this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }

  /** 获取当前持续按下的方向（用于按住连续移动） */
  currentDirection(): Direction | null {
    if (this.keys.has('arrowup') || this.keys.has('w')) return 'up';
    if (this.keys.has('arrowdown') || this.keys.has('s')) return 'down';
    if (this.keys.has('arrowleft') || this.keys.has('a')) return 'left';
    if (this.keys.has('arrowright') || this.keys.has('d')) return 'right';
    return null;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (
      [
        'arrowup',
        'arrowdown',
        'arrowleft',
        'arrowright',
        'w',
        'a',
        's',
        'd',
        ' ',
      ].includes(k)
    ) {
      e.preventDefault();
    }
    if (this.keys.has(k)) return;
    this.keys.add(k);

    let dir: Direction | null = null;
    if (k === 'arrowup' || k === 'w') dir = 'up';
    else if (k === 'arrowdown' || k === 's') dir = 'down';
    else if (k === 'arrowleft' || k === 'a') dir = 'left';
    else if (k === 'arrowright' || k === 'd') dir = 'right';

    if (dir) {
      this.emitDirection(dir);
    } else if (k === 'escape' || k === 'p') {
      this.listeners.forEach((l) => l.onPause?.());
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 0) return;
    const t = e.touches[0];
    // 起点落在 HUD/Overlay 等可交互元素上时，不当作滑动手势
    // （避免点暂停按钮 / 滑动音量条 / 拖动滑块时误触发玩家移动）
    const target = e.target as HTMLElement | null;
    if (target && target.closest('button, input, .scene, .hud-btn, .hud-corner')) {
      this.touchStart = null;
      return;
    }
    this.touchStart = { x: t.clientX, y: t.clientY, t: Date.now() };
  };

  private onTouchEnd = (e: TouchEvent) => {
    if (!this.touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - this.touchStart.x;
    const dy = t.clientY - this.touchStart.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    // 滑动阈值：根据屏幕短边自适应，移动端更敏感
    const minSide = Math.min(window.innerWidth, window.innerHeight);
    const minSwipe = Math.max(14, minSide * 0.04);
    if (adx < minSwipe && ady < minSwipe) {
      this.touchStart = null;
      return;
    }
    let dir: Direction;
    if (adx > ady) dir = dx > 0 ? 'right' : 'left';
    else dir = dy > 0 ? 'down' : 'up';
    this.emitDirection(dir);
    this.touchStart = null;
  };

  private releaseAll = () => {
    this.keys.clear();
  };

  private emitDirection(d: Direction): void {
    this.listeners.forEach((l) => l.onDirection?.(d));
  }
}

export const input = new InputManager();
