/**
 * 同步进度面板（嵌入同步数据页的 section 内）。
 *
 * 极简版：只有一个 code（首次访问就生成、存 localStorage），
 * UI 永远是单一状态——展示编号 + 复制 / 二维码 / 输入新编号绑定。
 *
 * 布局调整说明：
 *   原版自带 title + border-top 分隔，现已交由外层 .sync-section 统一管理标题，
 *   面板内仅保留：编号卡片（含复制按钮） + 提示文字 + 操作按钮组。
 */

import { storage } from '../../../core/Storage';
import { showToast } from '../../Toast';
import { attachClickSfx } from '../shared';
import { promptAdoptCode } from './CodeInput';
import { showQrDialog } from './QrDialog';

export function buildSyncPanel(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'sync-panel';

  const render = (): void => {
    wrap.innerHTML = '';
    const code = storage.getCode();

    // 编号展示卡片（含复制按钮）
    const codeRow = document.createElement('div');
    codeRow.className = 'sync-code-row';
    codeRow.innerHTML = `
      <div class="sync-code-info">
        <div class="sync-code-label">我的同步编号</div>
        <div class="sync-code-value">${code}</div>
      </div>
    `;
    const copyBtn = document.createElement('button');
    copyBtn.className = 'sync-copy-btn';
    copyBtn.type = 'button';
    copyBtn.setAttribute('aria-label', '复制编号');
    copyBtn.innerHTML =
      '<span class="sync-copy-icon" aria-hidden="true">⎘</span><span class="sync-copy-text">复 制</span>';
    attachClickSfx(copyBtn);
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(code);
        copyBtn.classList.add('copied');
        copyBtn.querySelector<HTMLElement>('.sync-copy-text')!.textContent = '已 复 制';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.querySelector<HTMLElement>('.sync-copy-text')!.textContent = '复 制';
        }, 1500);
      } catch {
        showToast(`你的同步编号：${code}\n请手动长按复制`, 'info', 4000);
      }
    };
    codeRow.appendChild(copyBtn);
    wrap.appendChild(codeRow);

    // 操作按钮组：主操作（QR）置顶视觉权重高，次操作（输入编号）跟随
    const actions = document.createElement('div');
    actions.className = 'sync-actions';

    const qrBtn = document.createElement('button');
    qrBtn.className = 'btn primary sync-qr';
    qrBtn.textContent = '我 的 进 度 码 / 同 步 链 接';
    attachClickSfx(qrBtn);
    qrBtn.onclick = () => showQrDialog(code);
    actions.appendChild(qrBtn);

    const inputBtn = document.createElement('button');
    inputBtn.className = 'btn sync-secondary';
    inputBtn.textContent = '输 入 其 他 编 号';
    attachClickSfx(inputBtn);
    inputBtn.onclick = () => promptAdoptCode(render);
    actions.appendChild(inputBtn);

    wrap.appendChild(actions);
  };

  render();
  // storage 变更（启动 bootstrap 拉到云端 / 切换 code 后）自动刷新面板
  const unsub = storage.onChange(render);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(wrap)) {
      unsub();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return wrap;
}
