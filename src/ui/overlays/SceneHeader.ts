/**
 * Scene 顶部头部条（通用组件）。
 *
 * 视觉位置：在 .scene 内、scene-card 之上的空白区域。
 *   .scene 现在是 column 布局：header 占据上半页空白，card 居中靠下。
 *
 * 职责：
 *   - 欢迎语 / 称呼语：根据玩家昵称 + 上下文生成（"你好"/"欢迎回来"/"太棒了"等）
 *
 * 设计说明：
 *   - 各页面可通过 buildSceneHeader 选项自定义欢迎语口吻
 *   - 没有昵称时欢迎语整行隐藏（保持低打扰）
 *   - 进度提示已下线：相关信息（下一关 / 已通关 / 累计星数）已分散到
 *     主菜单按钮文案 / 选关页 / 排行榜，不在 header 重复
 *   - 订阅 storage.onChange 自动刷新（昵称变更场景），由调用方在 scene 移除时取消
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
}

/** 是否处于"完全没玩过"状态（只用于欢迎语口吻判定） */
function isFresh(): boolean {
  for (const lv of levels) {
    if (storage.getRecord(lv.id)?.cleared) return false;
  }
  return true;
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
  const { greeting } = opts;
  const root = document.createElement('div');
  root.className = 'scene-header';

  const render = (): void => {
    root.innerHTML = '';
    const nick = storage.getNick();

    // 欢迎语行（唯一内容）
    if (greeting) {
      const text = buildGreeting(greeting, nick, isFresh());
      if (text) {
        const g = document.createElement('div');
        g.className = 'scene-header-greeting';
        g.textContent = text;
        root.appendChild(g);
      }
    }

    // 没有任何内容（无昵称 / 未传 greeting）→ 加 empty 标记便于 CSS 折叠占位
    if (root.children.length === 0) {
      root.classList.add('empty');
    } else {
      root.classList.remove('empty');
    }
  };

  render();

  // 订阅变更（昵称同步等）
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
