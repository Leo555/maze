/**
 * Scene 顶部头部条（通用组件）。
 *
 * 视觉位置：在 .scene 内、scene-card 之上的空白区域。
 *   .scene 现在是 column 布局：header 占据上半页空白，card 居中靠下。
 *
 * 职责：
 *   - 欢迎语 / 称呼语：根据玩家昵称 + 上下文生成（"你好"/"欢迎回来"/"太棒了"等）
 *   - 进度提示：下一关、已通关数 / 总关卡数 + 累计星数
 *
 * 设计说明：
 *   - 各页面可通过 buildSceneHeader 选项自定义欢迎语，进度提示统一从 storage 读
 *   - 没有昵称时欢迎语整行隐藏（保持低打扰），只显示进度
 *   - 没有任何进度数据 / 全新存档时只显示欢迎语
 *   - 为避免与 .scene-card 内部内容重复：原 MainMenu 卡片内的 .scene-greeting 与
 *     .scene-progress 已移除，由本组件统一承担
 *   - 订阅 storage.onChange 自动刷新（昵称、通关数变更场景），由调用方在 scene 移除时取消
 */

import { storage } from '../../core/Storage';
import { levels } from '../../config/levels';

/**
 * 欢迎语生成上下文：
 *   - 'menu'      主菜单首屏
 *   - 'result'    结算页（3 星表扬 / 否则鼓励）
 *   - 'fail'      失败页（轻量安慰）
 *   - 'sub'       次级页面（关卡选择 / 设置 / 同步等）
 */
export type SceneGreetingContext =
  | { kind: 'menu' }
  | { kind: 'result'; stars: number }
  | { kind: 'fail' }
  | { kind: 'sub' };

export interface SceneHeaderOptions {
  /** 欢迎语上下文，决定文案口吻；不传则不显示欢迎语 */
  greeting?: SceneGreetingContext;
  /** 是否显示进度提示行；默认 true */
  showProgress?: boolean;
}

/** 计算进度数据（与 MainMenu 内部 computeProgress 保持一致语义） */
function computeProgress(): {
  cleared: number;
  total: number;
  stars: number;
  starsMax: number;
  fresh: boolean;
  allCleared: boolean;
  nextLevelName: string | null;
} {
  let cleared = 0;
  let stars = 0;
  for (const lv of levels) {
    const r = storage.getRecord(lv.id);
    if (r?.cleared) {
      cleared++;
      stars += r.bestStars;
    }
  }
  const next = levels.find((lv) => {
    const r = storage.getRecord(lv.id);
    return storage.isUnlocked(lv.id) && (!r || !r.cleared);
  });
  return {
    cleared,
    total: levels.length,
    stars,
    starsMax: levels.length * 3,
    fresh: cleared === 0,
    allCleared: cleared >= levels.length,
    nextLevelName: next?.name ?? null,
  };
}

/** 根据上下文与昵称生成欢迎语；昵称为空返回 null */
function buildGreeting(
  ctx: SceneGreetingContext,
  nick: string | null,
  fresh: boolean,
): string | null {
  if (!nick) return null;
  switch (ctx.kind) {
    case 'menu':
      return fresh ? `你 好 · ${nick}` : `欢 迎 回 来 · ${nick}`;
    case 'result':
      return ctx.stars >= 3 ? `太 棒 了 · ${nick}` : `继 续 加 油 · ${nick}`;
    case 'fail':
      return `别 灰 心 · ${nick}`;
    case 'sub':
      return `欢 迎 回 来 · ${nick}`;
  }
}

/**
 * 构建 scene 顶部 header。
 *
 * 返回的 element 应被 append 到 .scene 容器中、card 之前。
 * 调用方负责在 scene 卸载时取消 storage 订阅（refresh 句柄）。
 */
export function buildSceneHeader(
  opts: SceneHeaderOptions = {},
): { element: HTMLElement; refresh: () => void } {
  const { greeting, showProgress = true } = opts;
  const root = document.createElement('div');
  root.className = 'scene-header';

  const render = (): void => {
    root.innerHTML = '';
    const p = computeProgress();
    const nick = storage.getNick();

    // 欢迎语行
    if (greeting) {
      const text = buildGreeting(greeting, nick, p.fresh);
      if (text) {
        const g = document.createElement('div');
        g.className = 'scene-header-greeting';
        g.textContent = text;
        root.appendChild(g);
      }
    }

    // 进度行：fresh 时显示"共 N 关 等你探索"，已开始时显示"下一关 · X / 已通关 a/b · ★ s/m"
    if (showProgress) {
      const prog = document.createElement('div');
      prog.className = 'scene-header-progress';
      if (p.allCleared) {
        prog.innerHTML = `
          <span class="hp-line">已 全 部 通 关</span>
          <span class="hp-dot">·</span>
          <span class="hp-sub">★ ${p.stars} / ${p.starsMax}</span>
        `;
      } else if (p.fresh) {
        prog.innerHTML = `
          <span class="hp-line">共 ${p.total} 关 等 你 探 索</span>
        `;
      } else {
        prog.innerHTML = `
          ${p.nextLevelName ? `<span class="hp-line">下 一 关 · ${p.nextLevelName}</span><span class="hp-dot">·</span>` : ''}
          <span class="hp-sub">已 通 关 ${p.cleared} / ${p.total}</span>
          <span class="hp-dot">·</span>
          <span class="hp-sub">★ ${p.stars} / ${p.starsMax}</span>
        `;
      }
      root.appendChild(prog);
    }

    // 整行都没有内容（无昵称且不显示进度）→ 隐藏占位避免空白条
    if (root.children.length === 0) {
      root.classList.add('empty');
    } else {
      root.classList.remove('empty');
    }
  };

  render();

  // 订阅变更（昵称同步、通关进度回写等）
  const unsub = storage.onChange(render);

  return {
    element: root,
    refresh: () => {
      unsub();
    },
  };
}

/**
 * 通用挂载工具：把 header 挂到 scene 上、并在 scene 从 DOM 卸载时自动解订。
 *
 * 调用方只需：
 *   const scene = document.createElement('div'); scene.className = 'scene';
 *   attachSceneHeader(scene, { greeting: { kind: 'menu' } });
 *   scene.appendChild(card);
 *   showOverlay(scene);
 */
export function attachSceneHeader(
  scene: HTMLElement,
  opts: SceneHeaderOptions = {},
): void {
  const { element, refresh } = buildSceneHeader(opts);
  // 在 .scene 上加标记：CSS 据此为 scene 顶部预留 padding，让卡片往下让位
  scene.classList.add('has-scene-header');
  scene.appendChild(element);

  // scene 节点从 DOM 移除时取消订阅，避免内存泄漏
  const observer = new MutationObserver(() => {
    if (!document.body.contains(scene)) {
      refresh();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
