# 挂载初始化与命令竞态：乐观写 + 请求序号

日期：2026-09-27｜来源：explorer 插件施工实证（plugins/src/explorer/store.ts 与 DetailPanel.vue）

## 问题

Detail 面板有两条互不相让的入口：

1. **挂载初始化**：DetailPanel onMounted 想喂工作区目录（chatflow 的 currentProjectDir）；
2. **外部命令**：chatflow 文件引用点击可能先于组件挂载到达 `store.open(path)`（乐观写 currentDir 完成定位）。

竞态后果：挂载初始化若无条件覆盖，会冲掉 open 命令已完成的定位；目录列表是异步 RPC（fs.list），快速连点或命令连发时，先发请求的响应可能后到，用旧目录内容覆盖新目录。

## 范式

1. **乐观写 + 后调用者意图优先**：enter(dir) 先同步写 currentDir 再发 RPC——谁后调用谁赢，意图即时可见。
2. **请求序号丢弃过期响应**：模块级 `let seq = 0`；每次调用 `const my = ++seq`；await 返回后 `if (my !== seq) return`——过期响应（含错误分支）全部丢弃，loading 归位也只归最新请求。
3. **挂载初始化只补空**：onMounted `if (!store.currentDir)` 才喂工作区；watch 不带 immediate——open 命令已定位时不覆盖。
4. **失败不清旧内容**：catch 写 error，entries 保留上一目录内容（避免闪空）。

```ts
let enterSeq = 0
async function enter(dir: string): Promise<void> {
  if (!dir) return
  const seq = ++enterSeq
  loading.value = true
  currentDir.value = dir            // 乐观写：后调用者意图优先
  try {
    const list = await daemon.call<FsEntry[]>('fs.list', { path: dir })
    if (seq !== enterSeq) return    // 过期响应丢弃
    entries.value = list
  } catch (e) {
    if (seq !== enterSeq) return
    error.value = ...               // 失败不清旧内容
  } finally {
    if (seq === enterSeq) loading.value = false
  }
}
```

## 证据

- plugins/src/explorer/store.ts L62-81（enter 序号范式）、L126-135（setWorkspace 同值不重列）
- plugins/src/explorer/DetailPanel.vue L23-42（watch 不带 immediate + onMounted 只补空）

## 适用边界

- 一切"异步数据加载 + 多入口触发"的 store action：目录树、文件读取、URL 加载均适用。
- 序号 guard 只表达"最后一次调用赢"；需要合并或取消语义（如搜索防抖取消）要另行设计。
