import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // Electron 产物经 loadFile 加载（file:// 协议），资源必须相对路径，否则白屏；dev 不受影响
  base: './',
  server: {
    // 5173 的 origin 在本机浏览器残留了其他项目的 SW 缓存，改用独立端口
    port: 5273,
    strictPort: true,
  },
})
