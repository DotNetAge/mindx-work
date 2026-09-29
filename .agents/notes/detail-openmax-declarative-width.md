# Detail 轨道 openMax 满宽机制与宽度持久语义

日期：2026-09-29

## 设计决策

- `DetailEntry`（ui-shell/src/views.ts）新增声明式 `openMax?: boolean`：条目被激活拉出轨道时，宽度默认取当前上限（`measureMax()` 实测，非 openMax 不受影响）。壳不认识具体插件 id，插件自声明——保持零文案壳原则。已启用：terminal、web-viewer。
- 响应性要点：`shell.Detail.*` 是内核可变结构 getter，无 Vue 响应性，必须经 `useShellData`（版本订阅）建立依赖后再 watch，不能直接 `watch(() => shell.Detail.shown)`。
- 满宽赋值须 `await nextTick()` 后 `measureMax()`（v-if 挂载后 rootRef 才有值），且 `Number.isFinite` 保护（frame 未就绪时 measureMax 返回 Infinity，直接赋值会产生 `width: Infinitypx`）。

## 宽度持久语义（易误解点）

Detail 轨道宽度是 DetailPane 组件实例的本地状态（非每条目独立）：切层、收起再拉出都继承上次宽度，仅双击手柄重置为 320。因此验证"首次拉出取 320/满宽"必须先 reload 清状态；收起态拉出文件层若读到满宽，通常是上一会话把 width 拉满所致，不是 bug。

## CDP 实证结论

- 终端/网页拉出 = (frame 2560 − sidebar 248) / 2 = 1156，PASS。
- reload 后文件层首次拉出 = 320，无回归。
