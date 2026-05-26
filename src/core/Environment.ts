/**
 * 运行环境检测：用于判断当前应用运行在哪种宿主中，
 * 让 UI/逻辑可以做差异化处理。
 *
 * 三个常用判定：
 *   - inWeChat:    是否运行在微信内置浏览器中
 *   - standalone:  是否以"独立应用"模式运行（即用户已添加到主屏并从主屏启动）
 *   - iOS:         是否为 iOS / iPadOS（用于"添加到主屏"提示文案）
 */

/** 是否运行在微信内置浏览器中 */
export function isInWeChat(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /MicroMessenger/i.test(navigator.userAgent);
}

/** 是否运行在 iOS / iPadOS Safari */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  // iPadOS 13+ 默认 UA 与 macOS 一致，必须再用触屏特征区分
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPad 桌面模式：UA 中带 Mac，但有触屏
  return ua.includes('Mac') && 'ontouchend' in document;
}

/**
 * 是否以"独立应用"模式运行（已添加到主屏并从主屏启动）。
 * iOS 用 navigator.standalone，其它平台用 display-mode media query。
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS 主屏启动
  if (
    typeof (navigator as Navigator & { standalone?: boolean }).standalone ===
      'boolean' &&
    (navigator as Navigator & { standalone?: boolean }).standalone
  ) {
    return true;
  }
  // Android / 桌面 PWA
  if (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches
  ) {
    return true;
  }
  return false;
}

/** 是否 Android（X5 / Chromium 内核兼容） */
export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}
