/**
 * 游戏场景控制器
 *
 * 职责：
 *   - 持有当前关卡运行时（迷宫、玩家、实体）
 *   - 主循环：input → 玩家移动 → 触发拾取/出口 → 渲染
 *   - 倒计时 / 钥匙收集判定
 *   - 通关 → 结算 / 超时 → 失败
 */

import { Renderer } from '../core/Renderer';
import { audio } from '../core/Audio';
import { input } from '../core/Input';
import { storage } from '../core/Storage';
import { router } from '../core/Router';
import type { Route } from '../core/Router';
import { themes } from '../config/theme';
import { getLevel, levels } from '../config/levels';
import type { LevelConfig } from '../config/levels';
import { buildLevel } from '../maze/LevelBuilder';
import type { LevelRuntime, Entity } from '../maze/LevelBuilder';
import { shortestPath, shortestPathThroughWaypoints } from '../maze/Generator';
import { Player } from '../entities/Player';
import { ParticleSystem } from '../fx/Particles';
import { Hud } from '../ui/Hud';
import { Minimap } from '../ui/Minimap';
import {
  showResult,
  showFail,
  showPauseMenu,
  showMainMenu,
  showLevelSelect,
  showSettings,
  hideOverlay,
} from '../ui/Overlays';
import { randomSeed } from '../core/utils';

type State = 'menu' | 'playing' | 'paused' | 'transition';

export class Game {
  private renderer: Renderer;
  private hud: Hud;
  private minimap: Minimap;
  private particles = new ParticleSystem();

  private state: State = 'menu';
  private level: LevelRuntime | null = null;
  private player: Player | null = null;
  private currentLevelId = 1;

  // 计时
  private elapsed = 0;
  private remaining = 0; // 倒计时关卡用

  // 收集进度
  private keysCollected = 0;
  private steps = 0;

  // 倒计时音效节流
  private lastCountdownTick = -1;

  // 移动按键节流（在按键持续按下时实现连续移动）
  private moveCooldown = 0;
  // 触屏 D-pad 当前按住的方向（移动端虚拟方向键）
  private touchHeldDir: 'up' | 'down' | 'left' | 'right' | null = null;

  private rafId: number | null = null;
  private lastTime = 0;

  // 彩蛋：右上角连点 10 次显示最佳路径
  // 时间窗：8 秒内连点累计；过半（≥5）时给出进度提示
  private easterEggClicks: number[] = [];
  private static readonly EASTER_EGG_TARGET = 10;
  private static readonly EASTER_EGG_WINDOW_MS = 8000;
  private static readonly EASTER_EGG_HOTSPOT = 100; // 右上角 100×100 触发区

  constructor() {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const hudRoot = document.getElementById('hud') as HTMLElement;
    this.renderer = new Renderer(canvas);
    this.hud = new Hud(hudRoot);
    this.minimap = new Minimap(this.hud.getMinimapContainer());

    this.hud.onMuteToggle = () => {
      audio.toggleMute();
      this.refreshHud();
    };
    this.hud.onPause = () => this.pause();

    // 彩蛋：用户点「关闭最佳路径」按钮
    this.hud.onCloseBestPath = () => this.closeBestPath();

    // 触屏 D-pad：按住 = 进入持续移动方向；松开 = 清除
    this.hud.onTouchDirStart = (dir) => {
      if (this.state !== 'playing') return;
      this.touchHeldDir = dir;
      // 立即触发一次移动（提升按下手感）
      if (this.player && this.level && this.player.isIdle()) {
        this.player.tryMove(this.level.maze, dir);
      }
    };
    this.hud.onTouchDirEnd = (dir) => {
      if (this.touchHeldDir === dir) this.touchHeldDir = null;
    };
    this.hud.onDashTap = () => this.tryDash();

    this.hud.hide();

    input.subscribe({
      onPause: () => {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
      },
      onDash: () => this.tryDash(),
      // 触屏滑动 / 单次方向键按下事件：立即尝试一次移动
      // （键盘按住的连续移动由主循环 currentDirection() 处理，二者互不冲突）
      onDirection: (dir) => {
        if (this.state !== 'playing') return;
        if (!this.player || !this.level) return;
        if (this.player.isIdle()) {
          this.player.tryMove(this.level.maze, dir);
        }
      },
    });

    this.setupEasterEgg();

    this.start();
  }

  /**
   * 彩蛋：右上角连点 10 次（8s 窗口内）→ 显示当前关卡最佳路径 8 秒
   * - 监听 window pointerdown（capture 阶段）；不阻止默认事件
   * - 坐标判定：x 在右侧 100px 且 y 在顶部 100px 即视作命中
   * - 仅在 playing 状态下生效，避免菜单/选关页误触
   * - 计数过半时给出进度 toast 让玩家知道彩蛋存在
   */
  private setupEasterEgg(): void {
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (this.state !== 'playing') return;
        const w = window.innerWidth;
        const inHotspot =
          e.clientX >= w - Game.EASTER_EGG_HOTSPOT &&
          e.clientY <= Game.EASTER_EGG_HOTSPOT;
        if (!inHotspot) return;

        const now = performance.now();
        // 滑动窗口：剔除超时的点击
        this.easterEggClicks = this.easterEggClicks.filter(
          (t) => now - t < Game.EASTER_EGG_WINDOW_MS
        );
        this.easterEggClicks.push(now);

        const count = this.easterEggClicks.length;
        if (count >= Game.EASTER_EGG_TARGET) {
          this.easterEggClicks = [];
          this.triggerBestPathEgg();
          return;
        }
        // 过半（5 次）开始给进度提示，让玩家知道触发条件
        if (count >= Math.floor(Game.EASTER_EGG_TARGET / 2)) {
          const remain = Game.EASTER_EGG_TARGET - count;
          this.hud.showToast(`再点 ${remain} 次解锁彩蛋`, 800);
        }
      },
      { capture: true }
    );
  }

  /** 触发：计算当前关卡最优路径并常驻显示，由用户主动关闭 */
  private triggerBestPathEgg(): void {
    if (!this.level || !this.player) return;
    // 起点：玩家当前格（更直观地告诉玩家「下一步该往哪走」）
    const from = { x: this.player.state.gx, y: this.player.state.gy };
    const exit = this.level.maze.exit;

    // 关键：本关需要钥匙时，路径必须先依次经过所有「尚未拾取」的钥匙再到出口
    // 否则路径会指向出口但其实门没开，玩家照走会走冤枉路
    const remainingKeys = this.level.entities
      .filter((e) => e.active && e.kind === 'key')
      .map((e) => ({ x: e.x, y: e.y }));

    const path =
      remainingKeys.length > 0
        ? shortestPathThroughWaypoints(this.level.maze, from, remainingKeys, exit)
        : shortestPath(this.level.maze, from, exit);
    if (path.length < 2) return;

    this.renderer.showBestPath(path);
    this.hud.showBestPathBtn();
    audio.playSfx('pickup_map'); // 借用「地图碎片」音效，氛围契合
    const tip =
      remainingKeys.length > 0
        ? `✨ 最佳路径已显示 · 途经 ${remainingKeys.length} 把钥匙`
        : '✨ 最佳路径已显示';
    this.hud.showToast(tip, 2000);
  }

  /** 用户点击「关闭最佳路径」按钮 */
  private closeBestPath(): void {
    this.renderer.clearBestPath();
    this.hud.hideBestPathBtn();
    audio.playSfx('ui_close');
  }

  // ============ 状态切换 ============
  start(): void {
    // 启动路由：根据当前 hash 决定首屏（默认主菜单）
    router.start((route) => this.applyRoute(route));
    this.lastTime = performance.now();
    this.loop();
  }

  /**
   * 路由回调：根据 route 渲染对应页面。
   * 这是页面切换的「单一入口」——任何想跳转的地方都调 router.navigate(...)，
   * 而不直接调用 showXxx / startLevel，从而避免「同步显示 + 异步隐藏」竞态。
   */
  private applyRoute(route: Route): void {
    switch (route.name) {
      case 'menu':
        this.renderMenu();
        break;
      case 'levels':
        this.renderLevelSelect();
        break;
      case 'settings':
        this.renderSettings();
        break;
      case 'play': {
        // 校验关卡是否存在 / 已解锁，否则回到主菜单
        if (!this.canPlay(route.levelId)) {
          router.navigate({ name: 'menu' }, { replace: true });
          return;
        }
        // 当前已经持有同一关卡且没有结束（未进入 transition）→ 仅恢复 UI 即可，
        // 避免「从暂停页/选关页返回」时重启关卡导致的进度丢失
        const isResume =
          this.level !== null &&
          this.currentLevelId === route.levelId &&
          this.state !== 'transition';
        if (isResume) {
          this.resume();
          return;
        }
        this.startLevel(route.levelId);
        break;
      }
    }
  }

  private canPlay(levelId: number): boolean {
    if (!levels.find((l) => l.id === levelId)) return false;
    return storage.isUnlocked(levelId);
  }

  private renderMenu(): void {
    this.state = 'menu';
    this.cleanupLevel();
    this.hud.hide();
    showMainMenu({
      onPlay: (levelId) => {
        router.navigate({ name: 'play', levelId });
      },
      onSelectLevel: () => router.navigate({ name: 'levels' }),
      onSettings: () => router.navigate({ name: 'settings' }),
    });
  }

  private renderLevelSelect(): void {
    // 关键：不能 cleanupLevel！如果用户从游戏内进入选关页，关卡数据需要保留，
    // 这样「返回游戏」才能继续玩；「选其它关」时由 startLevel 自然替换。
    // 仅切到 'menu' / 'settings' 时才需要清理。
    const inGame = this.level !== null && this.state !== 'transition';
    if (inGame) {
      // 游戏中暂时进入选关页：状态视作 paused，玩家不会继续移动
      this.state = 'paused';
    } else {
      this.state = 'menu';
    }
    this.hud.hide();
    showLevelSelect({
      inGame,
      onSelect: (id) => router.navigate({ name: 'play', levelId: id }),
      onBack: () => {
        if (inGame) {
          // 返回到当前正在玩的关卡（路由保持不变，仅恢复 UI）
          audio.unduckBgm(300);
          router.navigate({ name: 'play', levelId: this.currentLevelId });
        } else {
          router.navigate({ name: 'menu' });
        }
      },
    });
  }

  private renderSettings(): void {
    this.state = 'menu';
    this.cleanupLevel();
    this.hud.hide();
    showSettings(() => router.navigate({ name: 'menu' }));
  }

  /** 清理当前关卡上下文，回菜单/换关时调用 */
  private cleanupLevel(): void {
    this.level = null;
    this.player = null;
    this.particles.clear();
    this.touchHeldDir = null;
    this.renderer.clearBestPath();
    this.hud.hideBestPathBtn();
  }

  startLevel(levelId: number): void {
    hideOverlay();
    const config = getLevel(levelId);
    this.currentLevelId = levelId;
    const seed = randomSeed();
    this.level = buildLevel(config, seed);
    this.player = new Player(this.level.maze.start.x, this.level.maze.start.y);

    // 玩家事件挂钩
    this.player.onArrive = (x, y) => this.onPlayerArrive(x, y);
    this.player.onBump = () => this.onPlayerBump();
    this.player.onStep = () => this.onPlayerStep();

    this.elapsed = 0;
    this.remaining = config.timeLimit;
    this.keysCollected = 0;
    this.steps = 0;
    this.lastCountdownTick = -1;

    this.particles.clear();
    this.renderer.resetVisited(this.level.maze);
    this.hud.hideBestPathBtn();

    audio.playBgm(config.bgm as 'bgm_dawn', 800);
    audio.playSfx('level_start');

    this.state = 'playing';
    this.hud.show();
    this.refreshHud();

    // 提示新机制
    this.showLevelIntro(config);
  }

  private showLevelIntro(config: LevelConfig): void {
    const tips: string[] = [];
    if (config.id === 1) {
      tips.push(
        this.hud.isTouch
          ? '滑动屏幕或点击下方方向键移动'
          : '使用 WASD 或方向键移动'
      );
    }
    if (config.keys > 0) tips.push(`收集 ${config.keys} 把钥匙后到达出口`);
    if (config.timeLimit > 0) tips.push(`倒计时 ${config.timeLimit} 秒，沙漏 +10s`);
    if (config.vision !== 'full') tips.push('视野受限，注意探索');
    if (tips.length > 0) {
      this.hud.showToast(tips.join(' · '), 2800);
    }
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.touchHeldDir = null;
    showPauseMenu({
      onResume: () => this.resume(),
      onRestart: () => {
        // 同关卡重开：路由不变，直接重建关卡数据
        hideOverlay();
        this.startLevel(this.currentLevelId);
      },
      onSelectLevel: () => router.navigate({ name: 'levels' }),
      onMenu: () => router.navigate({ name: 'menu' }),
    });
  }

  resume(): void {
    hideOverlay();
    // 恢复 BGM（pause/选关期可能 duck 过；幂等调用）
    audio.unduckBgm(300);
    this.state = 'playing';
    this.hud.show();
  }

  // ============ 玩家事件 ============
  private onPlayerStep(): void {
    audio.playSfx('step', { rate: 0.95 + Math.random() * 0.1 });
    this.steps++;
  }

  private onPlayerBump(): void {
    audio.playSfx('bump');
    this.renderer.triggerShake(3, 0.15);
  }

  private onPlayerArrive(x: number, y: number): void {
    if (!this.level) return;
    this.renderer.markVisited(x, y);

    // 玩家在冲刺中，扣掉一步配额
    this.player?.consumeDashStep();

    // 检查是否拾取到道具
    for (const e of this.level.entities) {
      if (e.active && e.x === x && e.y === y) {
        this.collectEntity(e);
      }
    }

    // 检查是否到达出口
    if (x === this.level.maze.exit.x && y === this.level.maze.exit.y) {
      // 必须收集完所有钥匙
      if (this.keysCollected >= this.level.config.keys) {
        this.completeLevel();
      } else {
        this.hud.showToast(
          `还需收集 ${this.level.config.keys - this.keysCollected} 把钥匙`,
          1400
        );
        audio.playSfx('door_blocked');
      }
    }
  }

  private collectEntity(e: Entity): void {
    if (!this.level) return;
    e.active = false;
    const theme = themes[this.level.config.theme];
    this.particles.burst(e.x, e.y, theme.accent, 18);

    switch (e.kind) {
      case 'key':
        this.keysCollected++;
        audio.playSfx('pickup_key');
        if (this.keysCollected === this.level.config.keys) {
          audio.playSfx('all_keys_collected');
          this.hud.showToast('钥匙已集齐 · 出口已开启', 1800);
        } else {
          this.hud.showToast(
            `🔑 ${this.keysCollected}/${this.level.config.keys}`,
            900
          );
        }
        break;
      case 'hourglass':
        this.remaining = Math.min(this.remaining + 10, this.level.config.timeLimit + 30);
        audio.playSfx('pickup_hourglass');
        this.hud.showToast('+10s', 900);
        break;
      case 'map_shard':
        this.renderer.triggerReveal(3);
        audio.playSfx('pickup_map');
        this.hud.showToast('地图揭示 3 秒', 1200);
        break;
      case 'dash_shoes':
        audio.playSfx('pickup_dash');
        break;
      default:
        break;
    }
    this.refreshHud();
  }

  private tryDash(): void {
    if (!this.player) return;
    if (this.player.triggerDash()) {
      audio.playSfx('dash');
    }
  }

  // ============ 通关 / 失败 ============
  private completeLevel(): void {
    if (!this.level || this.state !== 'playing') return;
    // 先切到 transition 状态，停止玩家输入与计时，但暂不触发渐隐
    this.state = 'transition';

    const time = this.elapsed;
    const stars = this.calcStars(time);
    const isNewBest = storage.submit(this.currentLevelId, time, stars);
    const hasNext = this.currentLevelId < levels.length;

    // === 终点庆祝特效与音效（停留约 1.8s 再切到结算页） ===
    this.playGoalCelebration(stars);

    // 600ms 后再开始渐隐，让玩家充分看到烟花
    setTimeout(() => this.renderer.triggerFadeOut(), 600);
    audio.duckBgm(0.25, 400);

    setTimeout(() => {
      this.hud.hide();
      audio.stopBgm(600);
      showResult(
        {
          levelId: this.currentLevelId,
          time,
          steps: this.steps,
          optimal: this.level!.optimalPath,
          stars,
          isNewBest,
          hasNext,
        },
        {
          onNext: () => {
            if (hasNext) {
              router.navigate({ name: 'play', levelId: this.currentLevelId + 1 });
            }
          },
          onRetry: () => this.startLevel(this.currentLevelId),
          onMenu: () => router.navigate({ name: 'menu' }),
        }
      );
    }, 1800);
  }

  /**
   * 终点庆祝序列：
   *   - 立刻播放 level_complete 辉煌音效（合成大三和弦琶音）
   *   - 在出口位置爆发多波粒子（金色 + 主题色），形成「烟花」效果
   *   - 轻微震动 + 高亮提示文案
   *   - 根据星级追加 star_rating 音效点缀
   */
  private playGoalCelebration(stars: number): void {
    if (!this.level) return;
    const theme = themes[this.level.config.theme];
    const ex = this.level.maze.exit.x;
    const ey = this.level.maze.exit.y;

    // 主胜利音效
    audio.playSfx('level_complete');

    // 轻微震动制造冲击感
    this.renderer.triggerShake(2.5, 0.35);

    // 第一波：玩家所在格 大爆发（主题色）
    this.particles.burst(ex, ey, theme.accent, 36);
    // 第二波：金色环（180ms 后）
    setTimeout(() => {
      if (this.state !== 'transition') return;
      this.particles.burst(ex, ey, '#ffd76a', 28);
      audio.playSfx('star_rating');
    }, 180);
    // 第三波：玩家高光色（380ms 后）
    setTimeout(() => {
      if (this.state !== 'transition') return;
      this.particles.burst(ex, ey, theme.playerGlow, 24);
    }, 380);
    // 第四波：再来一发金色尾焰（620ms 后）
    setTimeout(() => {
      if (this.state !== 'transition') return;
      this.particles.burst(ex, ey, '#fff3b0', 20);
    }, 620);

    // 根据星级追加额外烟花
    if (stars >= 3) {
      setTimeout(() => {
        if (this.state !== 'transition') return;
        this.particles.burst(ex, ey, '#ffd76a', 30);
        audio.playSfx('star_rating', { rate: 1.25 });
      }, 900);
    }

    // Toast 通关提示
    const tip =
      stars >= 3 ? '完美通关！' : stars === 2 ? '顺利通关！' : '通关！';
    this.hud.showToast(tip, 1500);
  }

  private failLevel(reason: string): void {
    if (!this.level || this.state !== 'playing') return;
    this.state = 'transition';
    audio.stopBgm(600);
    setTimeout(() => {
      this.hud.hide();
      showFail(reason, {
        onRetry: () => this.startLevel(this.currentLevelId),
        onMenu: () => router.navigate({ name: 'menu' }),
      });
    }, 800);
  }

  private calcStars(time: number): number {
    if (!this.level) return 0;
    const c = this.level.config;
    if (time <= c.star3Time) return 3;
    if (time <= c.star2Time) return 2;
    return 1;
  }

  // ============ 主循环 ============
  private loop = (): void => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    if (this.state === 'playing') {
      this.tickGame(dt);
    }

    this.renderer.update(dt);
    this.particles.update(dt);

    if (this.level && this.player) {
      this.renderer.draw(
        this.level.maze,
        themes[this.level.config.theme],
        this.level.config,
        this.player,
        this.level.entities,
        this.particles
      );

      const reveal = performance.now() / 1000 < this.renderer.revealUntil;
      this.minimap.draw(
        this.level.maze,
        themes[this.level.config.theme],
        this.renderer.visited,
        this.player,
        reveal
      );
    } else {
      // 菜单期间画一个简洁背景（浅色主题主调）
      const ctx = this.renderer.ctx;
      ctx.save();
      ctx.fillStyle = '#f5efe6';
      ctx.fillRect(0, 0, this.renderer.canvas.width, this.renderer.canvas.height);
      ctx.restore();
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  private tickGame(dt: number): void {
    if (!this.player || !this.level) return;

    // 计时
    this.elapsed += dt;

    if (this.level.config.timeLimit > 0) {
      this.remaining -= dt;
      // 倒计时音效
      const sec = Math.ceil(this.remaining);
      if (sec !== this.lastCountdownTick) {
        if (sec <= 3 && sec > 0) {
          audio.playSfx('countdown_critical');
          audio.duckBgm(0.5, 100);
        } else if (sec <= 10 && sec > 0) {
          audio.playSfx('countdown_warn');
        }
        this.lastCountdownTick = sec;
      }

      if (this.remaining <= 0) {
        this.failLevel('时间耗尽');
        return;
      }
    }

    // 玩家更新（缓动）
    this.player.update(dt);

    // 玩家拖尾
    if (this.player.state.moving && Math.random() < 0.5) {
      const theme = themes[this.level.config.theme];
      this.particles.trail(this.player.state.px, this.player.state.py, theme.playerGlow);
    }

    // 处理移动指令（按住方向键 / 按住虚拟 D-pad 时持续移动）
    if (this.moveCooldown > 0) this.moveCooldown -= dt;
    if (this.player.isIdle()) {
      const dir = input.currentDirection() ?? this.touchHeldDir;
      if (dir && this.moveCooldown <= 0) {
        this.player.tryMove(this.level.maze, dir);
        this.moveCooldown = 0; // 缓动期内本身就 isIdle=false，无需冷却
      }
    }

    // 周期性 HUD 刷新
    this.refreshHud();
  }

  private refreshHud(): void {
    if (!this.level || !this.player) return;
    this.hud.update({
      config: this.level.config,
      theme: themes[this.level.config.theme],
      time: this.level.config.timeLimit > 0 ? this.remaining : this.elapsed,
      isCountdown: this.level.config.timeLimit > 0,
      keysCollected: this.keysCollected,
      keysTotal: this.level.config.keys,
      dashCooldownRatio: this.player.getDashCooldownRatio(),
      muted: audio.isMuted(),
    });
  }

  destroy(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.renderer.destroy();
    this.hud.destroy();
    router.destroy();
  }
}
