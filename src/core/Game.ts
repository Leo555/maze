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
  showOptimalReview,
  hideOverlay,
} from '../ui/Overlays';
import { randomSeed } from '../core/utils';
import { EasterEgg } from './EasterEgg';
import { playGoalCelebration } from '../fx/Celebration';
import { shortestPath, shortestPathThroughWaypoints } from '../maze/Generator';

type State = 'menu' | 'playing' | 'paused' | 'transition' | 'review';

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
  /**
   * 玩家行走轨迹（按到达顺序记录每一格，含起点）。
   * 用于「查看最佳路径」时在迷宫上叠加显示，让玩家直观对比偏差。
   */
  private playerPath: Array<{ x: number; y: number }> = [];

  // 倒计时音效节流
  private lastCountdownTick = -1;

  // 移动按键节流（在按键持续按下时实现连续移动）
  private moveCooldown = 0;
  // 触屏 D-pad 当前按住的方向（移动端虚拟方向键）
  private touchHeldDir: 'up' | 'down' | 'left' | 'right' | null = null;

  private rafId: number | null = null;
  private lastTime = 0;

  // 菜单期 canvas 清屏脏标记：true = 已清过，loop 中可跳过 fillRect
  // 在 cleanupLevel / resize 后重置为 false
  private menuBgCleared = false;

  // 右上角连点彩蛋：显示当前关卡最佳路径
  private easterEgg!: EasterEgg;

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
    this.hud.onCloseBestPath = () => this.easterEgg.close();

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

    this.hud.hide();

    input.subscribe({
      onPause: () => {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
      },
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

    // 窗口尺寸变化时，canvas 内容会被清空 → 菜单期需要重新画背景
    window.addEventListener('resize', () => {
      this.menuBgCleared = false;
    });

    this.start();
  }

  /** 初始化彩蛋：把回调注入到 EasterEgg 中并安装事件监听 */
  private setupEasterEgg(): void {
    this.easterEgg = new EasterEgg({
      isPlaying: () => this.state === 'playing',
      getLevel: () => this.level,
      getPlayer: () => this.player,
      getRenderer: () => this.renderer,
      getHud: () => this.hud,
    });
    this.easterEgg.install();
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
    this.renderer.clearPlayerPath();
    this.playerPath = [];
    this.hud.hideBestPathBtn();
    // 接下来要显示菜单背景，重置脏标让 loop 至少画一次
    this.menuBgCleared = false;
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
    // 重置玩家轨迹，以起点为第一个采样
    this.playerPath = [{ x: this.level.maze.start.x, y: this.level.maze.start.y }];

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
    // 记录轨迹（每次到达新格子追加一次；与 markVisited 同步，无重复采样问题）
    this.playerPath.push({ x, y });

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
      default:
        break;
    }
    this.refreshHud();
  }

  // ============ 通关 / 失败 ============
  private completeLevel(): void {
    if (!this.level || this.state !== 'playing') return;
    // 先切到 transition 状态，停止玩家输入与计时，但暂不触发渐隐
    this.state = 'transition';

    const time = this.elapsed;
    const stars = this.calcStars(time, this.steps);
    const isNewBest = storage.submit(this.currentLevelId, time, stars);
    const hasNext = this.currentLevelId < levels.length;

    // === 终点庆祝特效与音效（停留约 1.8s 再切到结算页） ===
    playGoalCelebration({
      particles: this.particles,
      renderer: this.renderer,
      hud: this.hud,
      theme: themes[this.level.config.theme],
      exitX: this.level.maze.exit.x,
      exitY: this.level.maze.exit.y,
      stars,
      isStillActive: () => this.state === 'transition',
    });

    // 600ms 后再开始渐隐，让玩家充分看到烟花
    setTimeout(() => this.renderer.triggerFadeOut(), 600);
    audio.duckBgm(0.25, 400);

    setTimeout(() => {
      this.hud.hide();
      audio.stopBgm(600);
      this.openResultOverlay({
        time,
        steps: this.steps,
        stars,
        isNewBest,
        hasNext,
      });
    }, 1800);
  }

  /**
   * 渲染通关结算页。抽出来是因为「查看最佳路径」回到结算时需要再次展示同一份数据。
   */
  private openResultOverlay(args: {
    time: number;
    steps: number;
    stars: number;
    isNewBest: boolean;
    hasNext: boolean;
  }): void {
    if (!this.level) return;
    const optimal = this.level.optimalPath;
    const allowReview = args.steps > optimal && optimal > 0; // 路径非最优时才提供查看入口

    showResult(
      {
        levelId: this.currentLevelId,
        time: args.time,
        steps: args.steps,
        optimal,
        stars: args.stars,
        isNewBest: args.isNewBest,
        hasNext: args.hasNext,
      },
      {
        onNext: () => {
          if (args.hasNext) {
            router.navigate({ name: 'play', levelId: this.currentLevelId + 1 });
          }
        },
        onRetry: () => this.startLevel(this.currentLevelId),
        onMenu: () => router.navigate({ name: 'menu' }),
        onShowOptimal: allowReview
          ? () =>
              this.enterReview({
                steps: args.steps,
                passed: true,
                returnToOverlay: () => this.openResultOverlay(args),
              })
          : undefined,
      }
    );
  }

  /**
   * 终点庆祝序列：见 fx/Celebration.ts。
   * Game 仅负责调用并提供「是否仍在 transition 状态」的守卫。
   */
  private failLevel(reason: string): void {
    if (!this.level || this.state !== 'playing') return;
    this.state = 'transition';
    audio.stopBgm(600);
    setTimeout(() => {
      this.hud.hide();
      this.openFailOverlay(reason);
    }, 800);
  }

  /** 渲染失败页（同样支持「查看最佳路径」并循环返回） */
  private openFailOverlay(reason: string): void {
    if (!this.level) return;
    const allowReview = this.level.optimalPath > 0;
    showFail(reason, {
      onRetry: () => this.startLevel(this.currentLevelId),
      onMenu: () => router.navigate({ name: 'menu' }),
      onShowOptimal: allowReview
        ? () =>
            this.enterReview({
              steps: this.steps,
              passed: false,
              returnToOverlay: () => this.openFailOverlay(reason),
            })
        : undefined,
    });
  }

  // ============ 观察模式（查看最佳路径） ============
  /**
   * 进入观察模式：
   *   - 隐藏 overlay 让玩家看到完整迷宫
   *   - 在迷宫上叠加最佳路径线（复用 Renderer.showBestPath）
   *   - 不接受输入；HUD 保持隐藏
   *   - 顶部显示一个轻量浮窗，含「返回结算」按钮
   *
   * 起点用迷宫起点，让玩家看到「从头到尾」的完整最优路径，而不是从当前出口点出发的退化路径。
   */
  private enterReview(args: {
    steps: number;
    passed: boolean;
    returnToOverlay: () => void;
  }): void {
    if (!this.level) return;
    this.state = 'review';
    hideOverlay();

    const maze = this.level.maze;
    const keys = this.level.entities
      .filter((e) => e.kind === 'key') // 复盘最优解时考虑全部钥匙（不论玩家是否已收）
      .map((e) => ({ x: e.x, y: e.y }));
    const path =
      keys.length > 0
        ? shortestPathThroughWaypoints(maze, maze.start, keys, maze.exit)
        : shortestPath(maze, maze.start, maze.exit);
    if (path.length >= 2) {
      this.renderer.showBestPath(path);
    }
    // 同时叠加玩家实际走过的轨迹用于对比（含起点；至少 2 格才有视觉意义）
    if (this.playerPath.length >= 2) {
      this.renderer.showPlayerPath(this.playerPath);
    }

    // 把玩家暂时定格在起点，避免观察期间画面里出现位于出口的玩家把路径起点遮挡
    if (this.player) {
      this.player.state.gx = maze.start.x;
      this.player.state.gy = maze.start.y;
      this.player.state.px = maze.start.x;
      this.player.state.py = maze.start.y;
      this.player.state.moving = false;
    }

    // 渐隐与渐显的视觉过渡复位（之前 completeLevel 触发过 fadeOut，需要在 review 模式下手动复位）
    this.renderer.fadeOut = 0;
    this.renderer.fadeIn = 0;

    // 等过渡帧（350ms）让 overlay 真正消失后，再显示观察浮窗，避免与 overlay hide 动画堆叠
    setTimeout(() => {
      if (this.state !== 'review') return;
      showOptimalReview(
        {
          steps: args.steps,
          optimal: this.level!.optimalPath,
          passed: args.passed,
          hasPlayerPath: this.playerPath.length >= 2,
        },
        () => this.exitReview(args.returnToOverlay)
      );
    }, 360);
  }

  /** 退出观察模式：清除最佳路径 + 玩家轨迹 → 回到结算/失败 overlay */
  private exitReview(returnToOverlay: () => void): void {
    this.renderer.clearBestPath();
    this.renderer.clearPlayerPath();
    // 状态机切回 transition，让 openResultOverlay/openFailOverlay 中的 'transition' 假设保持一致
    this.state = 'transition';
    returnToOverlay();
  }

  /**
   * 星级判定：综合「时间」与「路径效率」，取两者较优结果
   *
   * - 路径维度（更重要）：
   *     · 走出最优解（efficiency ≥ 98%）→ 直接 3 星
   *     · efficiency ≥ 85% → 至少 2 星
   *     · 否则 1 星
   *
   * - 时间维度（保留快速通关奖励）：
   *     · time ≤ star3Time → 至少 3 星
   *     · time ≤ star2Time → 至少 2 星
   *
   * 时间阈值由 LevelBuilder 基于真实 optimalPath 动态计算（见 buildLevel），
   * 不再使用 levels.ts 里按 size×4 估算的静态值——后者无法适配带钥匙的真实最短路径。
   *
   * 两个维度独立计算，取 max。这样玩家「走完美路线」或「快速通关」都能拿 3 星，
   * 而不会出现「100% 路径效率但只 2 星」这种反直觉情况。
   */
  private calcStars(time: number, steps: number): number {
    if (!this.level) return 0;

    // 时间维度（运行时阈值）
    let timeStars = 1;
    if (time <= this.level.star3Time) timeStars = 3;
    else if (time <= this.level.star2Time) timeStars = 2;

    // 路径维度：efficiency = optimalPath / steps（玩家步数越接近最优越高）
    const optimal = this.level.optimalPath;
    let pathStars = 1;
    if (optimal > 0 && steps > 0) {
      const efficiency = optimal / steps; // 0~1
      if (efficiency >= 0.98) pathStars = 3;
      else if (efficiency >= 0.85) pathStars = 2;
    }

    return Math.max(timeStars, pathStars);
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
    } else if (!this.menuBgCleared) {
      // 菜单/选关/设置期：UI 由 DOM overlay 承载，canvas 仅需清屏一次即可。
      // 之前每帧都重画一次整屏 fillRect，纯属浪费——这里改为「dirty」标记。
      const ctx = this.renderer.ctx;
      ctx.save();
      ctx.fillStyle = '#f5efe6';
      ctx.fillRect(0, 0, this.renderer.canvas.width, this.renderer.canvas.height);
      ctx.restore();
      this.menuBgCleared = true;
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
      muted: audio.isMuted(),
    });
  }

  destroy(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.easterEgg.destroy();
    this.renderer.destroy();
    this.hud.destroy();
    router.destroy();
  }
}
