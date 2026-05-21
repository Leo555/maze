import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // 编译期注入：默认 false。开启时（VITE_AUDIO_ENABLED=true）才会把 howler 打入 chunk
  const audioEnabled = env.VITE_AUDIO_ENABLED === 'true' || env.VITE_AUDIO_ENABLED === '1';

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
      sourcemap: true,
    },
  };
});
