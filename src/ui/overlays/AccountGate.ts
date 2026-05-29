/**
 * 启动账号门槛。
 *
 * 玩家首次访问 / 未设置昵称时，必须二选一才能继续：
 *   1. 设置昵称（创建新身份）
 *   2. 输入恢复编号（迁移已有进度）
 *
 * 设计：
 *   - 独立挂载到 #account-gate 容器，不走 overlay 体系（不被路由切换干扰）
 *   - 不可关闭：没有"以后再说" / "跳过"按钮；点击蒙层无效
 *   - bootstrap 完成后才决定是否弹（避免本地无 nick 但云端有的误弹）
 *   - 弹出后订阅 storage.onChange：万一云端 nick 晚到，自动 dismiss
 *   - 失败用 nickErrorMessage 给精准文案（含限频剩余时间）
 *
 * 与 BasicSettings 重设昵称的区别：
 *   - 此页只允许"创建身份"或"恢复身份"，不能取消，不能改音量
 *   - 视觉上更接近欢迎引导，文案更长
 */

import { audio } from '../../core/Audio';
import { storage } from '../../core/Storage';
import {
  isValidCode,
  isValidNick,
  NICK_MAX_LENGTH,
} from '../../../shared/types';
import { nickErrorMessage } from '../../core/NickErrorMessage';
import { showToast } from '../Toast';
import { attachClickSfx } from './shared';

const GATE_ID = 'account-gate';

let mounted = false;
let unsubChange: (() => void) | null = null;

/**
 * 启动时调用：等 bootstrap 完成 → 若仍无昵称则弹门槛。
 *
 * 不返回 Promise：内部异步处理，调用方继续执行。
 */
export function maybeShowAccountGate(): void {
  void storage.bootstrapPromise.then(() => {
    if (storage.hasNick()) return;
    show();
  });
}

function show(): void {
  if (mounted) return;
  mounted = true;

  // 订阅 storage 变更：极端情况下云端 nick 在弹出后才到达 → 自动 dismiss
  // 例如：玩家在另一设备刚刚改了昵称，本设备启动时本地缓存空但 bootstrap 后云端有
  unsubChange = storage.onChange(() => {
    if (storage.hasNick()) dismiss();
  });

  renderHome();
}

function dismiss(): void {
  if (!mounted) return;
  mounted = false;
  unsubChange?.();
  unsubChange = null;
  const root = document.getElementById(GATE_ID);
  if (root) {
    root.classList.remove('show');
    // 给淡出动画 280ms 时间再清空
    setTimeout(() => {
      // 用户可能在动画期内又触发了 show（极小概率）；防御性检查
      if (!mounted) root.innerHTML = '';
    }, 300);
  }
}

/** 取出根容器（需保证 index.html 中有 #account-gate） */
function getRoot(): HTMLElement {
  const root = document.getElementById(GATE_ID);
  if (!root) throw new Error('#account-gate container missing');
  return root;
}

/**
 * 主页：欢迎语 + 二选一按钮。
 */
function renderHome(): void {
  const root = getRoot();
  root.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'gate-card';
  card.innerHTML = `
    <div class="gate-title">欢 迎 来 到 晨 雾 迷 径</div>
    <div class="gate-subtitle">WELCOME · MISTY PATH DAWN</div>
    <div class="gate-tip">
      为方便记录进度与查看排行榜，请<br />
      <strong>设置一个昵称</strong> 或 <strong>输入已有编号恢复进度</strong>
    </div>
  `;

  const btnGroup = document.createElement('div');
  btnGroup.className = 'gate-btn-group';

  const setNickBtn = document.createElement('button');
  setNickBtn.className = 'btn primary gate-btn';
  setNickBtn.type = 'button';
  setNickBtn.textContent = '设 置 昵 称';
  attachClickSfx(setNickBtn);
  setNickBtn.onclick = () => renderSetNick();

  const recoverBtn = document.createElement('button');
  recoverBtn.className = 'btn gate-btn';
  recoverBtn.type = 'button';
  recoverBtn.textContent = '输 入 编 号 恢 复';
  attachClickSfx(recoverBtn);
  recoverBtn.onclick = () => renderRecover();

  btnGroup.appendChild(setNickBtn);
  btnGroup.appendChild(recoverBtn);
  card.appendChild(btnGroup);

  root.appendChild(card);
  // rAF 触发淡入
  requestAnimationFrame(() => root.classList.add('show'));
  audio.playSfx('ui_open');
}

/**
 * 设置昵称表单。
 */
function renderSetNick(): void {
  audio.playSfx('ui_click');
  const root = getRoot();
  root.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'gate-card';
  card.innerHTML = `
    <div class="gate-title">设 置 昵 称</div>
    <div class="gate-subtitle">YOUR NAME IN THE MIST</div>
    <div class="gate-tip">1-12 字 · 中英文 / 数字 / emoji 均可<br />昵称将出现在排行榜上</div>
  `;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'gate-input';
  input.maxLength = NICK_MAX_LENGTH * 4; // 防 emoji 高码点截断
  input.placeholder = '迷雾旅人';
  input.autocapitalize = 'off';
  input.autocomplete = 'off';
  input.spellcheck = false;
  card.appendChild(input);

  const btnGroup = document.createElement('div');
  btnGroup.className = 'gate-btn-group';

  const backBtn = document.createElement('button');
  backBtn.className = 'btn gate-btn';
  backBtn.type = 'button';
  backBtn.textContent = '返  回';
  attachClickSfx(backBtn);
  backBtn.onclick = () => renderHome();

  const okBtn = document.createElement('button');
  okBtn.className = 'btn primary gate-btn';
  okBtn.type = 'button';
  okBtn.textContent = '确  定';
  okBtn.disabled = true;
  attachClickSfx(okBtn);

  // 输入校验：合法才允许提交
  const refresh = (): void => {
    okBtn.disabled = !isValidNick(input.value.trim());
  };
  input.addEventListener('input', refresh);

  const submit = async (): Promise<void> => {
    const v = input.value.trim();
    if (!isValidNick(v)) {
      showToast('昵称需 1-12 字、不含控制字符', 'error', 2400);
      return;
    }
    okBtn.disabled = true;
    backBtn.disabled = true;
    const original = okBtn.textContent;
    okBtn.textContent = '提 交 中...';
    try {
      const r = await storage.setNick(v);
      if (r.ok) {
        showToast(`欢迎，${v}`, 'success', 2200);
        // setNick 成功会触发 onChange → dismiss；这里也直接 dismiss 一次防遗漏
        dismiss();
      } else {
        showToast(nickErrorMessage(r.error, r.retryAfterSec), 'error', 3200);
      }
    } finally {
      okBtn.disabled = !isValidNick(input.value.trim());
      backBtn.disabled = false;
      okBtn.textContent = original;
    }
  };
  okBtn.onclick = () => void submit();

  // Enter 提交
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  });

  btnGroup.appendChild(backBtn);
  btnGroup.appendChild(okBtn);
  card.appendChild(btnGroup);

  root.appendChild(card);
  // 等入场过渡完成再聚焦，避免 iOS 因 transform 中拒绝唤起键盘
  setTimeout(() => input.focus(), 150);
}

/**
 * 输入编号恢复表单。
 */
function renderRecover(): void {
  audio.playSfx('ui_click');
  const root = getRoot();
  root.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'gate-card';
  card.innerHTML = `
    <div class="gate-title">恢 复 进 度</div>
    <div class="gate-subtitle">RECOVER PROGRESS</div>
    <div class="gate-tip">输入此前在其他设备使用过的 8 位编号<br />进度与昵称将一并同步</div>
  `;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'gate-input';
  input.maxLength = 16; // 允许多输再校验，给粘贴留余地
  input.placeholder = '例如 A3kPm7B5';
  input.autocapitalize = 'off';
  input.autocomplete = 'off';
  input.spellcheck = false;
  card.appendChild(input);

  const btnGroup = document.createElement('div');
  btnGroup.className = 'gate-btn-group';

  const backBtn = document.createElement('button');
  backBtn.className = 'btn gate-btn';
  backBtn.type = 'button';
  backBtn.textContent = '返  回';
  attachClickSfx(backBtn);
  backBtn.onclick = () => renderHome();

  const okBtn = document.createElement('button');
  okBtn.className = 'btn primary gate-btn';
  okBtn.type = 'button';
  okBtn.textContent = '恢  复';
  okBtn.disabled = true;
  attachClickSfx(okBtn);

  const refresh = (): void => {
    okBtn.disabled = !isValidCode(input.value.trim());
  };
  input.addEventListener('input', refresh);

  const submit = async (): Promise<void> => {
    const v = input.value.trim();
    if (!isValidCode(v)) {
      showToast('编号格式错误，必须是 8 位字母或数字', 'error', 2400);
      return;
    }
    okBtn.disabled = true;
    backBtn.disabled = true;
    const original = okBtn.textContent;
    okBtn.textContent = '恢 复 中...';
    try {
      const ok = await storage.adoptCode(v);
      if (!ok) {
        showToast('编号不存在或操作过于频繁', 'error', 2800);
        return;
      }
      // 注意：adoptCode 拉到的进度可能仍然没有昵称（对方 code 也没设过昵称）
      // 这种情况下不能 dismiss——应回到首页要求再设置昵称
      if (storage.hasNick()) {
        showToast(`已恢复编号 ${v}`, 'success', 2400);
        dismiss();
      } else {
        showToast(
          '该编号未设置昵称，请继续设置昵称完成账号',
          'info',
          3200
        );
        renderSetNick();
      }
    } finally {
      okBtn.disabled = !isValidCode(input.value.trim());
      backBtn.disabled = false;
      okBtn.textContent = original;
    }
  };
  okBtn.onclick = () => void submit();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  });

  btnGroup.appendChild(backBtn);
  btnGroup.appendChild(okBtn);
  card.appendChild(btnGroup);

  root.appendChild(card);
  setTimeout(() => input.focus(), 150);
}
