import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { resolve, dirname } from 'node:path'
import { readFileSync } from 'node:fs'
import vue from '@vitejs/plugin-vue'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 应用版本构建时注入（渲染侧 __APP_VERSION__）：内置插件随应用整体发版，卡片版本号同源不漂移
const appVersion = (JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8')) as { version: string }).version

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  // Electron 产物经 loadFile 加载（file:// 协议），资源必须相对路径，否则白屏；dev 不受影响
  base: './',
  // 多页入口：主界面 index.html + 首启向导 wizard.html（独立窗口壳，见 electron/src/wizard.ts）
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        wizard: resolve(__dirname, 'wizard.html'),
      },
    },
  },
  server: {
    // 5173 的 origin 在本机浏览器残留了其他项目的 SW 缓存，改用独立端口
    port: 5273,
    strictPort: true,
  },
})
