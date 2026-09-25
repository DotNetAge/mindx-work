/**
 * Electron 壳验证脚本（临时）：起窗口加载 dev 页面，
 * 断言 data-platform 注入、body 透明、侧栏半透明染色生效，截图后退出。
 * 用法：node_modules/.bin/electron scripts/verify-window.js
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true,
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 16, y: 18 },
          vibrancy: 'sidebar',
          visualEffectState: 'active',
          backgroundColor: '#00000000',
        }
      : {}),
    webPreferences: { preload: path.join(__dirname, '../dist/preload.js') },
  })
  win.webContents.on('preload-error', (_e, p, err) => console.log('preload-error:', p, String(err)))
  await win.loadURL(process.env.MX_DEV_URL || 'http://localhost:5273')
  await new Promise((r) => setTimeout(r, 3000))

  const results = await win.webContents.executeJavaScript(
    `(() => {
      const bands = [...document.querySelectorAll('[data-mx-drag-band]')]
      const header = document.querySelector('section > div:nth-of-type(2) > div')
      const toggle = header ? header.querySelector('button[aria-label]') : null
      const reg = (el) => (el ? getComputedStyle(el).webkitAppRegion : 'missing')
      return {
        platform: document.documentElement.dataset.platform,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        sidebarBg: getComputedStyle(document.querySelector('section')).backgroundImage.slice(0, 60),
        bandCount: bands.length,
        bandHeights: bands.map((el) => getComputedStyle(el).height).join(','),
        bandRegions: bands.map((el) => reg(el)).join(','),
        logoTop: header ? Math.round(header.getBoundingClientRect().top) : -1,
        headerRegion: reg(header),
        toggleRegion: reg(toggle),
      }
    })()`,
  )
  console.log('验证结果:', JSON.stringify(results, null, 2))

  const img = await win.webContents.capturePage()
  fs.mkdirSync('/tmp/mindx-shots', { recursive: true })
  fs.writeFileSync('/tmp/mindx-shots/electron-vibrancy.png', img.toPNG())
  console.log('截图: /tmp/mindx-shots/electron-vibrancy.png')

  const failed = []
  if (results.platform !== 'darwin') failed.push('data-platform 未注入')
  if (results.bodyBg !== 'rgba(0, 0, 0, 0)') failed.push('body 背景未透明: ' + results.bodyBg)
  if (!results.sidebarBg || results.sidebarBg === 'none') failed.push('侧栏染色未生效')
  if (results.bandCount !== 2) failed.push('拖动带数量不对: ' + results.bandCount)
  if (results.bandHeights !== '48px,48px') failed.push('拖动带高度不对: ' + results.bandHeights)
  if (results.bandRegions !== 'drag,drag') failed.push('拖动带未生效: ' + results.bandRegions)
  if (results.logoTop < 48) failed.push('logoRow 未让出红绿灯排: top=' + results.logoTop)
  if (results.headerRegion !== 'drag') failed.push('侧栏 header 拖动带未生效: ' + results.headerRegion)
  if (results.toggleRegion !== 'no-drag') failed.push('折叠钮未豁免拖动: ' + results.toggleRegion)
  console.log(failed.length ? '断言失败: ' + failed.join('; ') : '断言全部通过')
  app.exit(failed.length ? 1 : 0)
})
