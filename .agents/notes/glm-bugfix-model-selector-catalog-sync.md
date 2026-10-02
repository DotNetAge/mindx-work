# BUG 修复 — ChatInput 模型选择器不随供应商配置刷新（2026-10-02）

分类：bugfix/插件间数据同步 ｜ 状态：已修复（typecheck 通过，待真机回归）

## 现象与根因

用户报：供应商配置中新增模型后，ChatInput 的模型选择器不出现新模型。

根因是**跨插件数据消费失步**：daemon 的 `model.list` / `provider.list` 没有变更推送，models 插件与 chatflow 插件各自缓存一份——

- models store（`plugins/src/models/store.ts`）：保存模型后 `refresh()` 只更新自己的清单（管理 UI 立即正确）
- chatflow store（`plugins/src/chatflow/store.ts`）：`initModels()` 仅在 connected 跃迁时拉一次，之后永不刷新 → ModelSelector 永远看到旧列表

## 修复方案：打开选择器时拉取（惰性刷新）

不走跨插件事件总线（需要新壳层机制，改动大），选「消费时刻拉取」——数据只在打开选择器那一刻被用户消费，此刻发两个轻量 RPC 换取绝对新鲜，改动集中在 chatflow 侧，models 侧零改动。

四处改动（事件链 ModelSelector → ChatInput → ChatFlowPage → store）：

1. `plugins/src/chatflow/store.ts`：新增 `refreshModelCatalog()`（fetchModels → fetchProviders → resolveCurrentModel 同链），`initModels` 委托它；两者均导出
2. `plugins/src/chatflow/input/ModelSelector.vue`：el-popover `@show="emit('open')"`（新增 open 事件）
3. `plugins/src/chatflow/input/index.vue`：emits 新增 `refresh-models`，ModelSelector `@open` 转发
4. `plugins/src/chatflow/pages/ChatFlowPage.vue`：两处 ChatInput（hero + 消息流）`@refresh-models="store.refreshModelCatalog()"`

## 经验

1. **多插件各自缓存 daemon 数据必然失步**：daemon RPC 是拉模型（无推送），凡是「配置管理插件」+「数据消费插件」并存，消费者必须自备刷新时机（打开时拉 / 操作后拉）。未来 connectors 等配置面出现同类消费时，直接套「打开时拉取」模式。
2. **ModelSelector 保持纯展示纪律**（props 注入 + 事件上抛，fixture 回归通道依赖）：刷新入口用事件上抛而非组件内直连 store，维持了该纪律。
3. resolveCurrentModel 必须纳入刷新链：用户可能在设置里切默认模型，只刷列表不重解析会导致触发器显示与服务端权威不一致。
