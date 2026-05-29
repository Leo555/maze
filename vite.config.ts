import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // 编译期注入：默认 false。开启时（VITE_AUDIO_ENABLED=true）才会把 howler 打入 chunk
  const audioEnabled = env.VITE_AUDIO_ENABLED === 'true' || env.VITE_AUDIO_ENABLED === '1';
  const isProd = mode === 'production';

  return {
    server: {
      port: 5273,
      strictPort: true,
      open: true,
    },
    define: {
      // 这里的常量会在 esbuild 阶段被静态替换 → if (false) 分支整段被 DCE 掉，
      // 连 dynamic import('howler') 也不会被静态分析为 chunk。
      __AUDIO_ENABLED__: JSON.stringify(audioEnabled),
    },
    build: {
      target: 'es2020',
      // 生产环境不输出 sourcemap：
      //   - 节省 CDN 流量（之前 239KB 的 .map 会被部署到 Vercel）
      //   - 防止源码可被反向工程
      //   - dev 模式 Vite 仍会自动开启 sourcemap，调试不受影响
      sourcemap: !isProd,
      // 禁用模块预加载 polyfill：现代浏览器（Chrome 66+/Safari 15+/Firefox 78+）
      // 都支持原生 modulepreload，省掉 ~1KB 兜底代码
      modulePreload: { polyfill: false },
      // 提升构建产物的报告阈值，避免 chunk 警告噪声
      chunkSizeWarningLimit: 800,
      // CSS 代码分割（默认开启，显式声明便于阅读）：
      // 项目只有一个 styles.css 入口，不会真的拆，但配置上保留以便将来按 route 拆 CSS
      cssCodeSplit: true,
      rollupOptions: {
        // 多入口：游戏主页 + 独立后台管理页
        // /admin.html 完全独立 chunk，不进游戏 main bundle，
        // 游戏玩家访问主页时不会下载任何 admin 代码
        input: {
          main: resolve(__dirname, 'index.html'),
          admin: resolve(__dirname, 'admin.html'),
        },
        output: {
          // 文件名稳定的命名规则，便于 vercel.json 中的 /assets/* 缓存匹配
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
    esbuild: {
      // 生产环境去掉所有 console.* 调试日志（保留 console.error 用于线上排错）
      drop: isProd ? ['debugger'] : [],
      pure: isProd ? ['console.log', 'console.debug', 'console.info'] : [],
      // 不输出版权注释（howler 的 LICENSE 注释等），节省字节
      legalComments: 'none',
    },
  };
});

