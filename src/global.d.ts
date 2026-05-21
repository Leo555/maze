/**
 * 编译期注入的全局常量声明（vite.config.ts 的 define 字段）
 *
 * - __AUDIO_ENABLED__: 是否启用真实音频资源。
 *   关闭时（默认）整段 howler 加载逻辑会被 DCE 消除，连 chunk 都不生成。
 */
declare const __AUDIO_ENABLED__: boolean;
