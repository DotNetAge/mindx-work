# 本机验收闭环

上架前的安装链路验证：静态市场源 + env 双变量起 electron + 断言脚本全绿。四步全部基于真机实证（2026-09 P1 验收 + 审计回归）。

## 四步循环

### 第一步：生成市场数据

按 publish.md 范式在本地目录生成 `index.json` + 全部版本 zip。

### 第二步：起静态市场服务器

```bash
cd <发布目录> && python3 -m http.server <端口，如 8899>
```

- 判据：`lsof -i :<端口> -sTCP:LISTEN` 有监听。
- 坑：后台任务 failed 退出不报错到前台，起完必须查监听。

### 第三步：env 双变量起 electron

```bash
cd <仓库>/mindx-work/app && pnpm build          # 先重建渲染侧产物
pkill -f "remote-debugging-port=<CDP端口>"       # 清旧实例（见坑 4）
cd <仓库>/mindx-work/electron && \
  MX_MARKET_INDEX_URL="http://127.0.0.1:<端口>/index.json" \
  MX_PROD_DIST="<仓库>/mindx-work/app/dist" \
  npx electron . --remote-debugging-port=<CDP端口，如 9223>
```

- `MX_MARKET_INDEX_URL`：市场索引指向本机静态源（env 显式 = dev 手势，允许内网；生产缺省强制公网）。
- `MX_PROD_DIST`：渲染侧产物目录（dev 加载覆盖）。
- 判据：`ps aux | grep "[9]223"`（换成实际端口）有主进程。

### 第四步：断言脚本全绿

Python Playwright 走 CDP 断言（清单按发布内容裁剪）：

1. 市场 Tab 打开 → 索引条目渲染（名称/作者/描述）
2. 安装确认 modal 元数据（**显式点选目标版本行**，见坑 1）
3. sha256 安装成功 → 已安装列表出现
4. Sidebar 分节注册 → Content 页面呈现
5. 停用 → 页面移除（**用 rowLabel 类名判据**，见坑 3）→ 重新启用恢复
6. 多代际："安装此版本"落新代际 → 切版 pill → 卸载 → 目录清净
7. 全程页面错误 0

## 坑清单（实证）

1. **modal 默认选 versions[0]**：确认 modal 打开时版本行缺省选中数组首项，断言目标版本必须显式点选版本行。
2. **ES module 缓存**：同 specifier 只求值一次——停用再启用不重新执行入口。loader 已用 `?activate=<递增序号>` query 穿透（协议 handler 按 pathname 解析不受影响），验收时断言"重新启用后页面恢复"即可，无需脚本处理。
3. **断言判据防同名干扰**：设置面板内已安装列表与市场卡存在同名文本，停用断言用 `span[class*="rowLabel"]` 类名判据，禁止全页文本计数。
4. **electron 进程清理**：`pkill -f "remote-debugging-port=<端口>"` 不清 Helper 进程树；需 `ps aux | grep "[<端口>]" | awk '{print $2}' | xargs kill -9` 兜底。
5. **内网源只能走 env**：`http://127.0.0.1` 在生产缺省被 SSRF 防线拒绝（127/8 在 DefaultDeniedSubnets）——这是防线正确行为，不是 bug；验收必须 env 注入，禁止改代码放行。
6. **验收残留幂等**：userData `plugins/` 目录会保留已装插件与 installed.json；重复验收脚本需先幂等清理目标插件（或依赖其自身的卸载收尾）。

## 上架后冒烟

生产源上架后：直接 fetch `<生产 index.json>` 确认新条目，下载 zip 校验 sha256 与登记一致即可（完整安装链路已由本机验收覆盖）。
