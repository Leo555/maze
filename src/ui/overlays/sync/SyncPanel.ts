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
      <div class="sync-code-label">我的同步编号</div>
      <div class="sync-code-value">${code}</div>
    `;
    wrap.appendChild(codeRow);

    const tip = document.createElement('div');
    tip.className = 'sync-tip';
    tip.textContent = '通关进度自动保存到云端；在其他设备输入此编号或扫码即可恢复进度';
    wrap.appendChild(tip);

    const btnRow = document.createElement('div');
    btnRow.className = 'sync-btn-row';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn';
    copyBtn.textContent = '复 制 编 号';
    attachClickSfx(copyBtn);
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(code);
        copyBtn.textContent = '已 复 制 ✓';
        setTimeout(() => (copyBtn.textContent = '复 制 编 号'), 1500);
      } catch {
        showToast(`你的同步编号：${code}\n请手动长按复制`, 'info', 4000);
      }
    };
    btnRow.appendChild(copyBtn);

    const inputBtn = document.createElement('button');
    inputBtn.className = 'btn';
    inputBtn.textContent = '输 入 其 他 编 号';
    attachClickSfx(inputBtn);
    inputBtn.onclick = () => promptAdoptCode(render);
    btnRow.appendChild(inputBtn);

    wrap.appendChild(btnRow);

    const qrBtn = document.createElement('button');
    qrBtn.className = 'btn sync-qr';
    qrBtn.textContent = '生 成 二 维 码 / 同 步 链 接';
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
