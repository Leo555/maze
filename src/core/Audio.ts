/**
 * 音频管理器
 *
 * 策略：「代码先行 + 资源后置」
 *   - 所有音效用 Howler.js 加载本地文件
 *   - 缺失文件时静默回退（用 Web Audio 程序化合成简单音效）
 *   - 用户可在 assets/audio/README.md 中查看每个 id 应放什么文件
 */

import { Howl, Howler } from 'howler';

export type SfxId =
  | 'step'
  | 'bump'
  | 'dash'
  | 'dash_ready'
  | 'pickup_key'
  | 'pickup_hourglass'
  | 'pickup_map'
  | 'pickup_dash'
  | 'all_keys_collected'
  | 'door_open'
  | 'door_blocked'
  | 'portal_enter'
  | 'portal_exit'
  | 'chaser_alert'
  | 'level_start'
  | 'level_complete'
  | 'level_fail'
  | 'countdown_warn'
  | 'countdown_critical'
  | 'ui_click'
  | 'ui_hover'
  | 'ui_open'
  | 'ui_close'
  | 'star_rating';

export type BgmId =
  | 'bgm_menu'
  | 'bgm_dawn'
  | 'bgm_mint'
  | 'bgm_dusk'
  | 'bgm_deep'
  | 'bgm_aurora'
  | 'bgm_finale';

const SFX_FILES: Record<SfxId, string> = {
  step: '/audio/sfx/step.mp3',
  bump: '/audio/sfx/bump.mp3',
  dash: '/audio/sfx/dash.mp3',
  dash_ready: '/audio/sfx/dash_ready.mp3',
  pickup_key: '/audio/sfx/pickup_key.mp3',
  pickup_hourglass: '/audio/sfx/pickup_hourglass.mp3',
  pickup_map: '/audio/sfx/pickup_map.mp3',
  pickup_dash: '/audio/sfx/pickup_dash.mp3',
  all_keys_collected: '/audio/sfx/all_keys_collected.mp3',
  door_open: '/audio/sfx/door_open.mp3',
  door_blocked: '/audio/sfx/door_blocked.mp3',
  portal_enter: '/audio/sfx/portal_enter.mp3',
  portal_exit: '/audio/sfx/portal_exit.mp3',
  chaser_alert: '/audio/sfx/chaser_alert.mp3',
  level_start: '/audio/sfx/level_start.mp3',
  level_complete: '/audio/sfx/level_complete.mp3',
  level_fail: '/audio/sfx/level_fail.mp3',
  countdown_warn: '/audio/sfx/countdown_warn.mp3',
  countdown_critical: '/audio/sfx/countdown_critical.mp3',
  ui_click: '/audio/sfx/ui_click.mp3',
  ui_hover: '/audio/sfx/ui_hover.mp3',
  ui_open: '/audio/sfx/ui_open.mp3',
  ui_close: '/audio/sfx/ui_close.mp3',
  star_rating: '/audio/sfx/star_rating.mp3',
};

const BGM_FILES: Record<BgmId, string> = {
  bgm_menu: '/audio/bgm/menu.mp3',
  bgm_dawn: '/audio/bgm/dawn.mp3',
  bgm_mint: '/audio/bgm/mint.mp3',
  bgm_dusk: '/audio/bgm/dusk.mp3',
  bgm_deep: '/audio/bgm/deep.mp3',
  bgm_aurora: '/audio/bgm/aurora.mp3',
  bgm_finale: '/audio/bgm/finale.mp3',
};

// 默认音量（每个音效的相对音量）
const SFX_VOLUMES: Partial<Record<SfxId, number>> = {
  step: 0.3,
  bump: 0.5,
  dash: 0.6,
  dash_ready: 0.4,
  pickup_key: 0.7,
  pickup_hourglass: 0.7,
  pickup_map: 0.7,
  pickup_dash: 0.7,
  all_keys_collected: 0.9,
  door_open: 0.6,
  door_blocked: 0.6,
  portal_enter: 0.8,
  portal_exit: 0.8,
  chaser_alert: 0.9,
  level_start: 0.7,
  level_complete: 0.9,
  level_fail: 0.8,
  countdown_warn: 0.6,
  countdown_critical: 0.8,
  ui_click: 0.5,
  ui_hover: 0.3,
  ui_open: 0.6,
  ui_close: 0.5,
  star_rating: 0.7,
};

interface AudioSettings {
  master: number;
  sfx: number;
  bgm: number;
  muted: boolean;
}

const STORAGE_KEY = 'maze_audio_settings';

export class AudioManager {
  private sfxPool: Partial<Record<SfxId, Howl>> = {};
  private currentBgm: Howl | null = null;
  private currentBgmId: BgmId | null = null;
  private synthCtx: AudioContext | null = null;
  private settings: AudioSettings = {
    master: 0.8,
    sfx: 0.8,
    bgm: 0.5,
    muted: false,
  };
  private unlocked = false;

  constructor() {
    this.load();
    this.applyMaster();

    // 首次用户交互解锁 AudioContext（浏览器自动播放策略）
    const unlock = () => {
      this.unlocked = true;
      try {
        if (this.synthCtx?.state === 'suspended') this.synthCtx.resume();
      } catch {
        /* ignore */
      }
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('click', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);
  }

  // ============ 设置 ============
  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) Object.assign(this.settings, JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }

  private applyMaster(): void {
    const m = this.settings.muted ? 0 : this.settings.master;
    Howler.volume(m);
  }

  getSettings(): Readonly<AudioSettings> {
    return { ...this.settings };
  }

  setMaster(v: number): void {
    this.settings.master = Math.max(0, Math.min(1, v));
    this.save();
    this.applyMaster();
  }

  setSfx(v: number): void {
    this.settings.sfx = Math.max(0, Math.min(1, v));
    this.save();
  }

  setBgm(v: number): void {
    this.settings.bgm = Math.max(0, Math.min(1, v));
    this.save();
    if (this.currentBgm) this.currentBgm.volume(this.bgmEffective());
  }

  toggleMute(): boolean {
    this.settings.muted = !this.settings.muted;
    this.save();
    this.applyMaster();
    return this.settings.muted;
  }

  isMuted(): boolean {
    return this.settings.muted;
  }

  private bgmEffective(): number {
    return this.settings.bgm * 0.9;
  }

  // ============ SFX ============
  private getSfx(id: SfxId): Howl | null {
    if (this.sfxPool[id]) return this.sfxPool[id]!;
    try {
      const howl = new Howl({
        src: [SFX_FILES[id]],
        volume: SFX_VOLUMES[id] ?? 0.6,
        preload: true,
        // 资源缺失：onloaderror 时不抛错，由 fallback 处理
        onloaderror: () => {
          // 文件未提供，标记为 null（后续走 synth fallback）
          this.sfxPool[id] = undefined;
        },
      });
      this.sfxPool[id] = howl;
      return howl;
    } catch {
      return null;
    }
  }

  playSfx(id: SfxId, options?: { volume?: number; rate?: number }): void {
    if (this.settings.muted) return;
    const howl = this.getSfx(id);
    const sfxVol = (SFX_VOLUMES[id] ?? 0.6) * this.settings.sfx;
    const finalVol = (options?.volume ?? 1) * sfxVol;

    if (howl && howl.state() === 'loaded') {
      const sid = howl.play();
      howl.volume(finalVol, sid);
      if (options?.rate !== undefined) howl.rate(options.rate, sid);
      return;
    }

    // 文件未加载好/不存在 → 程序化合成
    this.synthFallback(id, finalVol, options?.rate ?? 1);
  }

  // ============ BGM ============
  playBgm(id: BgmId, fadeIn = 800): void {
    if (this.currentBgmId === id && this.currentBgm?.playing()) return;
    this.stopBgm(fadeIn);

    let bgm: Howl;
    try {
      bgm = new Howl({
        src: [BGM_FILES[id]],
        loop: true,
        volume: 0,
        html5: true, // 流式播放，减少内存占用
      });
    } catch {
      return;
    }

    this.currentBgm = bgm;
    this.currentBgmId = id;
    bgm.play();
    bgm.fade(0, this.bgmEffective(), fadeIn);
  }

  stopBgm(fadeOut = 600): void {
    if (!this.currentBgm) return;
    const bgm = this.currentBgm;
    bgm.fade(bgm.volume(), 0, fadeOut);
    setTimeout(() => bgm.stop(), fadeOut + 50);
    this.currentBgm = null;
    this.currentBgmId = null;
  }

  duckBgm(targetRatio = 0.4, duration = 200): void {
    if (!this.currentBgm) return;
    this.currentBgm.fade(
      this.currentBgm.volume(),
      this.bgmEffective() * targetRatio,
      duration
    );
  }

  unduckBgm(duration = 400): void {
    if (!this.currentBgm) return;
    this.currentBgm.fade(this.currentBgm.volume(), this.bgmEffective(), duration);
  }

  // ============ 程序化合成 fallback ============
  private getSynthCtx(): AudioContext | null {
    if (this.synthCtx) return this.synthCtx;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.synthCtx = new Ctx();
      return this.synthCtx;
    } catch {
      return null;
    }
  }

  private synthFallback(id: SfxId, volume: number, rate: number): void {
    if (!this.unlocked) return;
    const ctx = this.getSynthCtx();
    if (!ctx) return;

    const masterGain = volume * this.settings.master;

    // 高质量专用合成（多振荡器 + 噪声 + 滤波）
    switch (id) {
      case 'step':
        this.synthStep(ctx, masterGain, rate);
        return;
      case 'pickup_key':
        this.synthPickupKey(ctx, masterGain);
        return;
      case 'all_keys_collected':
        this.synthAllKeys(ctx, masterGain);
        return;
      case 'level_complete':
        this.synthLevelComplete(ctx, masterGain);
        return;
      default:
        break;
    }

    // 通用简单合成（其他音效）
    const config = this.getSynthConfig(id);
    if (!config) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = config.type;
    osc.frequency.setValueAtTime(config.startFreq * rate, now);
    if (config.endFreq !== config.startFreq) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, config.endFreq * rate),
        now + config.duration
      );
    }

    const peak = volume * config.gain * this.settings.master;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + config.duration);

    osc.start(now);
    osc.stop(now + config.duration + 0.02);
  }

  // ============ 高质量合成实现 ============

  /** 创建一段噪声 buffer（缓存复用） */
  private noiseBuffer: AudioBuffer | null = null;
  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = ctx.sampleRate * 0.5;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }

  /**
   * 脚步声：低频闷响 + 滤波白噪声
   * - 一次低频"咚"（80Hz triangle）模拟踩地面震动
   * - 一段经过 lowpass 的短噪声（500Hz cutoff）模拟摩擦/沙沙
   * - 极快衰减（60ms），避免拖泥带水
   * - 每步音高微随机，避免疲劳
   */
  private synthStep(ctx: AudioContext, master: number, rate: number): void {
    const now = ctx.currentTime;
    const dur = 0.08;

    // 1) 低频咚（thump）
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'triangle';
    const baseFreq = 90 * rate * (0.92 + Math.random() * 0.16);
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.6, now + dur);
    oscGain.gain.setValueAtTime(0, now);
    oscGain.gain.linearRampToValueAtTime(master * 0.45, now + 0.003);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);

    // 2) 滤波噪声（friction）
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600 + Math.random() * 200;
    filter.Q.value = 1;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0, now);
    noiseGain.gain.linearRampToValueAtTime(master * 0.18, now + 0.002);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    noise.connect(filter).connect(noiseGain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.07);
  }

  /**
   * 拾取钥匙：清脆双音 + 高频闪光
   * - 主音：1000Hz → 1500Hz 上滑，三角波（金属质感）
   * - 泛音：2000Hz、3000Hz 同步衰减（增加"叮"的亮度）
   * - 加一点点高频噪声闪光（"sparkle"）
   * - 短混响尾巴（0.35s）
   */
  private synthPickupKey(ctx: AudioContext, master: number): void {
    const now = ctx.currentTime;

    // 主音
    const fundamentals = [
      { freq: 1046, end: 1568, dur: 0.35, vol: 0.5, type: 'triangle' as OscillatorType }, // C6 → G6
      { freq: 2093, end: 3136, dur: 0.32, vol: 0.18, type: 'sine' as OscillatorType }, // 二倍泛音
      { freq: 3140, end: 4700, dur: 0.25, vol: 0.08, type: 'sine' as OscillatorType }, // 三倍泛音
    ];
    for (const f of fundamentals) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = f.type;
      osc.frequency.setValueAtTime(f.freq, now);
      osc.frequency.exponentialRampToValueAtTime(f.end, now + f.dur * 0.4);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(master * f.vol, now + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, now + f.dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + f.dur + 0.02);
    }

    // 高频闪光（sparkle）
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, now);
    ng.gain.linearRampToValueAtTime(master * 0.12, now + 0.005);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    noise.connect(hp).connect(ng).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.16);
  }

  /**
   * 钥匙集齐：上扬大三和弦 琶音 + 闪光
   * C-E-G 三个音依次出现（每隔 60ms），每个音独立 ADSR
   */
  private synthAllKeys(ctx: AudioContext, master: number): void {
    const now = ctx.currentTime;
    // C5 - E5 - G5 - C6（上行琶音）
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const start = now + i * 0.07;
      // 主音
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(master * 0.32, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      osc.connect(g).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.55);
      // 泛音
      const osc2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq * 2, start);
      g2.gain.setValueAtTime(0, start);
      g2.gain.linearRampToValueAtTime(master * 0.12, start + 0.01);
      g2.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
      osc2.connect(g2).connect(ctx.destination);
      osc2.start(start);
      osc2.stop(start + 0.45);
    });
  }

  /**
   * 通关音效：辉煌和弦 + 上行旋律 + 长尾巴
   * - 第 0ms：C 大三和弦（C5+E5+G5）齐奏，正弦+三角叠加
   * - 第 180ms：高八度 C6（亮点）
   * - 第 360ms：G6（高潮）
   * - 整体长 1.4s，逐渐淡出
   */
  private synthLevelComplete(ctx: AudioContext, master: number): void {
    const now = ctx.currentTime;

    // 主增益（整体淡出）
    const mainGain = ctx.createGain();
    mainGain.gain.setValueAtTime(master * 0.9, now);
    mainGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
    mainGain.connect(ctx.destination);

    // 让和弦更"宽"：用 lowpass 加一点温暖
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, now);
    filter.frequency.linearRampToValueAtTime(5000, now + 0.4);
    filter.Q.value = 0.7;
    filter.connect(mainGain);

    const playNote = (
      freq: number,
      start: number,
      dur: number,
      vol: number,
      type: OscillatorType = 'triangle'
    ) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(vol, start + 0.02);
      g.gain.setValueAtTime(vol, start + Math.min(dur * 0.4, 0.15));
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(g).connect(filter);
      osc.start(start);
      osc.stop(start + dur + 0.05);
    };

    // 0ms: C 大三和弦（C5 + E5 + G5）
    playNote(523.25, now, 1.2, 0.22, 'triangle'); // C5
    playNote(659.25, now, 1.2, 0.18, 'triangle'); // E5
    playNote(783.99, now, 1.2, 0.18, 'triangle'); // G5
    // 加一层 sine 泛音让和弦更亮
    playNote(523.25 * 2, now, 1.0, 0.08, 'sine');

    // 200ms: 上行点缀 C6
    playNote(1046.5, now + 0.2, 0.9, 0.22, 'triangle');
    playNote(1046.5 * 2, now + 0.2, 0.7, 0.06, 'sine');

    // 400ms: 高潮 G6
    playNote(1568.0, now + 0.4, 0.8, 0.2, 'triangle');

    // 600ms: C7（最高的亮点）
    playNote(2093.0, now + 0.6, 0.6, 0.12, 'sine');

    // 高频闪光点缀
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, now);
    ng.gain.linearRampToValueAtTime(master * 0.08, now + 0.05);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    noise.connect(hp).connect(ng).connect(mainGain);
    noise.start(now);
    noise.stop(now + 0.55);
  }

  private getSynthConfig(id: SfxId): {
    type: OscillatorType;
    startFreq: number;
    endFreq: number;
    duration: number;
    gain: number;
  } | null {
    switch (id) {
      case 'step':
        return { type: 'triangle', startFreq: 220, endFreq: 180, duration: 0.05, gain: 0.15 };
      case 'bump':
        return { type: 'sine', startFreq: 110, endFreq: 60, duration: 0.18, gain: 0.4 };
      case 'dash':
        return { type: 'sawtooth', startFreq: 400, endFreq: 800, duration: 0.18, gain: 0.25 };
      case 'dash_ready':
      case 'ui_click':
        return { type: 'sine', startFreq: 880, endFreq: 880, duration: 0.06, gain: 0.3 };
      case 'ui_hover':
        return { type: 'sine', startFreq: 1320, endFreq: 1320, duration: 0.03, gain: 0.15 };
      case 'pickup_key':
      case 'pickup_dash':
        return { type: 'sine', startFreq: 880, endFreq: 1320, duration: 0.18, gain: 0.4 };
      case 'pickup_hourglass':
        return { type: 'triangle', startFreq: 660, endFreq: 990, duration: 0.22, gain: 0.4 };
      case 'pickup_map':
        return { type: 'triangle', startFreq: 520, endFreq: 780, duration: 0.18, gain: 0.35 };
      case 'all_keys_collected':
        return { type: 'sine', startFreq: 660, endFreq: 1320, duration: 0.5, gain: 0.5 };
      case 'door_open':
        return { type: 'sawtooth', startFreq: 200, endFreq: 320, duration: 0.3, gain: 0.3 };
      case 'door_blocked':
        return { type: 'square', startFreq: 140, endFreq: 90, duration: 0.18, gain: 0.35 };
      case 'portal_enter':
        return { type: 'sine', startFreq: 440, endFreq: 1760, duration: 0.5, gain: 0.5 };
      case 'portal_exit':
        return { type: 'sine', startFreq: 1760, endFreq: 440, duration: 0.5, gain: 0.5 };
      case 'chaser_alert':
        return { type: 'sawtooth', startFreq: 220, endFreq: 110, duration: 0.4, gain: 0.5 };
      case 'level_start':
        return { type: 'sine', startFreq: 523, endFreq: 784, duration: 0.4, gain: 0.4 };
      case 'level_complete':
        return { type: 'sine', startFreq: 523, endFreq: 1047, duration: 0.8, gain: 0.5 };
      case 'level_fail':
        return { type: 'sawtooth', startFreq: 440, endFreq: 110, duration: 0.6, gain: 0.4 };
      case 'countdown_warn':
        return { type: 'sine', startFreq: 880, endFreq: 880, duration: 0.08, gain: 0.4 };
      case 'countdown_critical':
        return { type: 'square', startFreq: 1320, endFreq: 1320, duration: 0.08, gain: 0.5 };
      case 'ui_open':
        return { type: 'sine', startFreq: 440, endFreq: 660, duration: 0.18, gain: 0.3 };
      case 'ui_close':
        return { type: 'sine', startFreq: 660, endFreq: 440, duration: 0.18, gain: 0.3 };
      case 'star_rating':
        return { type: 'sine', startFreq: 880, endFreq: 1320, duration: 0.25, gain: 0.5 };
      default:
        return null;
    }
  }
}

// 全局单例
export const audio = new AudioManager();
