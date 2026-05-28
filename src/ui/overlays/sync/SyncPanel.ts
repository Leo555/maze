/**
 * 同步进度面板（嵌入设置页）。
 *
 * 极简版：只有一个 code（首次访问就生成、存 localStorage），
 * UI 永远是单一状态——展示编号 + 复制 / 二维码 / 输入新编号绑定。
 */

import { storage } from '../../../core/Storage';
import { showToast } from '../../Toast';
import { attachClickSfx } from '../shared';
import { promptAdoptCode } from './CodeInput';
import { showQrDialog } from './QrDialog';

export function buildSyncPanel(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'settings-sync';

  const render = (): void => {
    wrap.innerHTML = '';
    const code = storage.getCode();

    const title = document.createElement('div');
    title.className = 'sync-title';
    title.textContent = '同步进度';
    wrap.appendChild(title);

    const codeRow = document.createElement('div');
    codeRow.className = 'sync-code-row';
    codeRow.innerHTML = `
      <div class="sync-code-info">
        <div class="sync-code-label">我的同步编号</div>
        <div class="sync-code-value">${code}</div>
      </div>
    `;
    // 复制按钮内嵌到编号行右侧，更紧凑也突出"主要操作"
    const copyBtn = document.createElement('button');
    copyBtn.className = 'sync-copy-btn';
    copyBtn.type = 'button';
    copyBtn.setAttribute('aria-label', '复制编号');
    copyBtn.innerHTML = '<span class="sync-copy-icon" aria-hidden="true">⎘</span><span class="sync-copy-text">复 制</span>';
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

    const tip = document.createElement('div');
    tip.className = 'sync-tip';
    tip.textContent = '通关进度自动保存到云端；在其他设备输入此编号或扫码即可恢复进度';
    wrap.appendChild(tip);

    const inputBtn = document.createElement('button');
    inputBtn.className = 'btn sync-secondary';
    inputBtn.textContent = '输 入 其 他 编 号';
    attachClickSfx(inputBtn);
    inputBtn.onclick = () => promptAdoptCode(render);
    wrap.appendChild(inputBtn);

    const qrBtn = document.createElement('button');
    qrBtn.className = 'btn sync-qr';
    qrBtn.textContent = '我 的 进 度 码 / 同 步 链 接';
    attachClickSfx(qrBtn);
    qrBtn.onclick = () => showQrDialog(code);
    wrap.appendChild(qrBtn);
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
