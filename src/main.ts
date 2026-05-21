/**
 * 应用入口
 */

import './styles.css';
import { inject } from '@vercel/analytics';
import { Game } from './core/Game';

// Vercel Web Analytics
//   - 部署在 Vercel 平台时自动开启统计；本地 dev 不会发送任何请求
//   - 默认会监听 pushState/replaceState 自动上报 SPA 路由（与本项目的 hash 路由兼容）
//   - 不收集 PII，不需要 cookie 同意
inject({ mode: import.meta.env.DEV ? 'development' : 'production' });

new Game();
