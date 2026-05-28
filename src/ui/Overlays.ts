/**
 * Overlays 入口：re-export 各浮层 UI 模块，保持外部 import 路径不变。
 *
 * 实际实现位于 ./overlays/ 子目录，按页面/功能拆分：
 *   - shared.ts          公共：showOverlay / clearOverlay / hideOverlay / attachClickSfx
 *   - MainMenu.ts        showMainMenu
 *   - LevelSelect.ts     showLevelSelect
 *   - Pause.ts           showPauseMenu
 *   - Result.ts          showResult / showFail / ResultData
 *   - OptimalReview.ts   showOptimalReview
 *   - Settings.ts        showSettings
 *   - sync/SyncPanel.ts  buildSyncPanel
 *   - sync/CodeInput.ts  promptAdoptCode + 输入弹窗
 *   - sync/QrDialog.ts   showQrDialog / showBackupReminder
 */

export { hideOverlay } from './overlays/shared';
export { showMainMenu } from './overlays/MainMenu';
export { showLevelSelect } from './overlays/LevelSelect';
export { showPauseMenu } from './overlays/Pause';
export { showResult, showFail, type ResultData } from './overlays/Result';
export { showOptimalReview } from './overlays/OptimalReview';
export { showSettings } from './overlays/Settings';
