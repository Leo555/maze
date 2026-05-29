/**
 * Overlays 入口：re-export 各浮层 UI 模块，保持外部 import 路径不变。
 *
 * 实际实现位于 ./overlays/ 子目录，按页面/功能拆分：
 *   - shared.ts            公共：showOverlay / clearOverlay / hideOverlay / attachClickSfx
 *   - MainMenu.ts          showMainMenu
 *   - LevelSelect.ts       showLevelSelect
 *   - Pause.ts             showPauseMenu
 *   - Result.ts            showResult / showFail / ResultData
 *   - OptimalReview.ts     showOptimalReview
 *   - BasicSettings.ts     showBasicSettings        基础设置（昵称 + 音量）
 *   - SyncData.ts          showSyncData            同步数据（同步面板 + 清除存档）
 *   - Leaderboard.ts       showLeaderboard         按需动态分包，不在此 re-export
 *   - ShareDialog.ts       showShareDialog         按需调用，不在此 re-export
 *   - sync/SyncPanel.ts    buildSyncPanel
 *   - sync/CodeInput.ts    promptAdoptCode + 输入弹窗
 *   - sync/QrDialog.ts     showQrDialog / showBackupReminder
 */

export { hideOverlay } from './overlays/shared';
export { showMainMenu } from './overlays/MainMenu';
export { showLevelSelect } from './overlays/LevelSelect';
export { showPauseMenu } from './overlays/Pause';
export { showResult, showFail, type ResultData } from './overlays/Result';
export { showOptimalReview } from './overlays/OptimalReview';
export { showBasicSettings } from './overlays/BasicSettings';
export { showSyncData } from './overlays/SyncData';
