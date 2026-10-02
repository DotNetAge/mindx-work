import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { resolve, dirname } from 'node:path'
import vue from '@vitejs/plugin-vue'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [vue()],
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
