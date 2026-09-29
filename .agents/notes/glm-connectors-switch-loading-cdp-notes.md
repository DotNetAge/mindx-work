# 连接器开关并入测连的 CDP 验证要点

日期：2026-09-29
涉及：mindx-work/plugins/src/connectors（ConnectorsManagerRow.vue、store.ts）

## 事实

- toggle 是长时操作：博查（stdio）启用全程 28s（set_enabled + 自动测连），Switch loading 转圈在此期间是唯一状态指示——这是"测连并入开关"的实证依据。
- mx-switch 全局控件自带 `position: relative`（controls.css L268），组件内 loader 直接 `position:absolute; inset:0; margin:auto` 居中即可，无需包装层。
- 禁用态 `opacity: 0.5` 作用于整钮含子元素，子元素无法超越父级 opacity；loading 时需组件内 `.switchLoading { opacity: 1 !important }` 覆盖（CSS module hash 类 + important 安全，不会外溢）。

## CDP 坑与技巧

- vite dev 监听 localhost（IPv6 ::1），`curl http://127.0.0.1:5273` 返回 000 是探测姿势错误，不代表服务挂了；Electron 日志（job 输出）里 `[vite] hot updated` 才是链路通的证据。
- 连接器卡片定位：用 `[aria-label="编辑连接器"]` 锚点 + `closest('[data-enabled]')` 向上找卡；`querySelectorAll('.mx-switch')` 会命中页面栈里所有 pane 的开关（130+），必须先锁定卡片再查内部。
- 瞬态 loading 抓取：click 后 20ms 间隔轮询 `.mx-switch[aria-busy="true"]`，可在 RPC 期间抓到 loader/thumbHidden 状态。
- @iconify/vue 的 Icon 渲染 svg 无名字属性（无 data-icon/use href），图标身份验证只能靠截图目视。

## 改动定稿（供后续同类改造参考）

- store：删独立 test/testing（手动测连），toggle 内自动测连保留，switching 覆盖全程。
- 组件：cardActions 只剩 编辑（lucide:settings 齿轮）+ 删除（lucide:trash-2）；Switch 加 aria-busy + switchLoader（12px 圆环，半透明白环 + 实白 top，spin 0.8s）+ thumbHidden。
