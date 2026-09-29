<script setup lang="ts">
/**
 * explorer 详情面板：顶部搜索框 + 懒加载目录树 + 右键上下文菜单（Trae 式对齐）。
 * 跟随当前会话工作区（chatflow.store 的 currentProjectDir，组件 setup 桥接——
 * chatflow store 带 inject 依赖，其首次实例化必须落在组件上下文）。
 * 树交互在 TreeNode（递归）：目录懒加载展开，点击文件按扩展名路由；
 * 右键菜单在此统一渲染（store.ctx：entry=null = 空白右键，目标=根目录）。
 * 菜单动作：新建文件/文件夹（phantom 行内联命名——根层在本面板渲染，目录在
 * TreeNode 子层渲染，未展开先展开）、重命名、删除（ElMessageBox 确认）、
 * 在 Finder 中显示（fs.reveal）、刷新（已展开目录重列）、
 * 添加到对话（chatflow.store 服务追加引用 chip，仅资源条目）。
 * 搜索为前端过滤已加载链（名称包含匹配，命中链绕过展开态呈现）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MxIcon, useService } from '@mindx-work/ui-shell-vue'
import { useExplorerStore } from './store'
import TreeNode from './TreeNode.vue'

const store = useExplorerStore()

// ── 工作区桥接（chatflow 插件停用时静默回退主目录，不炸面板）────────────────
// watch 不带 immediate：open 命令可能先于组件挂载到达（乐观已写树定位）。
// 挂载初始化跟随当前会话工作区——Detail 轨道收起期间组件卸载，切换会话的
// currentProjectDir 变化无人消费，重挂载必须补同步，否则树根残留旧会话目录；
// open 跨树定位钉住（pinnedByOpen）时不覆盖，保护 open 的定位成果。
interface ChatflowServiceLike {
  readonly store: { currentProjectDir: string }
  /** 追加文件引用 chip 进对话输入框（false = 对话页未挂载） */
  appendFileRef(ref: { path: string; isDir?: boolean }): boolean
}
let chatflowDir = ''
/** chatflow 服务引用（插件可停用，null = 不可用，「添加到对话」降级提示） */
let chatflowService: ChatflowServiceLike | null = null
try {
  chatflowService = useService<ChatflowServiceLike>('chatflow.store')
  chatflowDir = chatflowService.store.currentProjectDir
  watch(
    () => chatflowService!.store.currentProjectDir,
    (dir) => store.setWorkspace(dir || '')
  )
} catch {
  chatflowDir = ''
}
onMounted(() => {
  if (!store.rootDir || !store.pinnedByOpen) store.setWorkspace(chatflowDir)
})

// ── 右键菜单（store.ctx：entry=null = 空白右键，目标=根目录）────────────────
/** 菜单位置：视口右/下缘内收（防溢出） */
const ctxPos = computed(() => {
  const c = store.ctx
  if (!c) return { left: '0px', top: '0px', visibility: 'hidden' as const }
  return {
    left: `${Math.max(4, Math.min(c.x, window.innerWidth - 200))}px`,
    top: `${Math.max(4, Math.min(c.y, window.innerHeight - 280))}px`,
  }
})

/** 父目录（绝对路径；根目录返回空串） */
function parentDirOf(p: string): string {
  const segs = p.split('/').filter(Boolean)
  segs.pop()
  return segs.length ? '/' + segs.join('/') : ''
}

/** 新建落点：目录 = 自身；文件 = 其父目录；空白右键 = 根目录 */
function ctxParent(): string {
  const e = store.ctx?.entry
  if (!e) return store.rootDir
  return e.is_dir ? e.path : parentDirOf(e.path)
}

/** 菜单：新建（文件/文件夹）——目标目录未展开先展开（phantom 行渲染依赖子层挂载） */
function startCreate(dir: boolean): void {
  const parent = ctxParent()
  store.closeCtx()
  if (!parent) return
  if (parent !== store.rootDir && !store.expanded[parent]) void store.toggle(parent)
  store.creating = { parent, dir }
}

/** 菜单：重命名（TreeNode 命中 store.renamingPath 渲染内联 input） */
function startRename(): void {
  const e = store.ctx?.entry
  store.closeCtx()
  if (e) store.renamingPath = e.path
}

/** 菜单：删除（破坏性操作，ElMessageBox 确认后执行） */
async function ctxRemove(): Promise<void> {
  const e = store.ctx?.entry
  store.closeCtx()
  if (!e) return
  try {
    await ElMessageBox.confirm(`确定删除「${e.name}」吗？此操作不可恢复。`, '删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await store.remove(e.path, e.is_dir)
  } catch (err) {
    ElMessage.error('删除失败：' + (err instanceof Error ? err.message : String(err)))
  }
}

/** 菜单：在 Finder 中显示（daemon fs.reveal） */
async function ctxReveal(): Promise<void> {
  const e = store.ctx?.entry
  store.closeCtx()
  if (!e) return
  try {
    await store.revealInFinder(e.path)
  } catch (err) {
    ElMessage.error('显示失败：' + (err instanceof Error ? err.message : String(err)))
  }
}

/** 菜单：刷新（已展开目录全部重列，保留展开态与高亮） */
function ctxRefresh(): void {
  store.closeCtx()
  void store.refresh()
}

/** 菜单：添加到对话（文件/目录引用 chip 经 chatflow 服务追加进对话输入框；
 * 目录标记直接取 FSEntry.is_dir，无需再 stat 探测） */
function ctxAddToChat(): void {
  const e = store.ctx?.entry
  store.closeCtx()
  if (!e) return
  if (!chatflowService) {
    ElMessage.warning('对话插件未启用，无法添加到对话')
    return
  }
  if (!chatflowService.appendFileRef({ path: e.path, isDir: e.is_dir })) {
    ElMessage.warning('对话页未打开，无法添加到对话')
  }
}

// ── 根层 phantom 新建行（store.creating.parent === rootDir 时根子项首行渲染）─
const rootCreating = computed(() => store.creating?.parent === store.rootDir)
const rootPhantomName = ref('')

/** 函数 ref：挂载即聚焦（根层 phantom 输入） */
function focusInput(el: unknown): void {
  if (el instanceof HTMLInputElement) el.focus()
}

/** 根层 phantom 确认（与 TreeNode 同语义：enter 确认 esc/blur 取消） */
async function confirmRootCreate(): Promise<void> {
  const c = store.creating
  const name = rootPhantomName.value.trim()
  store.creating = null
  rootPhantomName.value = ''
  if (!c || !name) return
  try {
    if (c.dir) await store.makeDir(c.parent, name)
    else await store.makeFile(c.parent, name)
  } catch (e) {
    ElMessage.error('创建失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

function cancelRootCreate(): void {
  store.creating = null
  rootPhantomName.value = ''
}

/** 树区空白右键：目标 = 根目录（新建/刷新） */
function onBlankCtx(event: MouseEvent): void {
  store.openCtx(null, event.clientX, event.clientY)
}
</script>

<template>
  <div :class="$style.panel">
    <!-- 搜索框：前端过滤已加载树（名称包含匹配） -->
    <div :class="$style.searchbar">
      <MxIcon name="lucide:search" :size="16" />
      <input
        v-model="store.filter"
        :class="$style.searchInput"
        type="text"
        spellcheck="false"
        placeholder="搜索"
      />
    </div>

    <!-- 错误态 -->
    <p v-if="store.error" :class="$style.error">{{ store.error }}</p>

    <!-- 目录树：根子项（懒加载递归）；空白右键 = 根目录菜单 -->
    <div v-else :class="$style.tree" @contextmenu.self.prevent="onBlankCtx">
      <p v-if="!store.rootDir" :class="$style.hint">正在定位工作目录…</p>
      <template v-else-if="store.children[store.rootDir]">
        <!-- 根层 phantom 新建行（根层新建时首行渲染 input） -->
        <div
          v-if="rootCreating"
          :class="$style.row"
          :style="{ paddingLeft: '8px' }"
          @click.stop
          @contextmenu.stop.prevent
        >
          <span :class="$style.leafGap" />
          <MxIcon
            :name="store.creating?.dir ? 'lucide:folder' : 'lucide:file'"
            :size="16"
            :class="$style.fileIcon"
          />
          <input
            v-model="rootPhantomName"
            :class="$style.inlineInput"
            type="text"
            spellcheck="false"
            placeholder="输入名称后回车"
            :ref="focusInput"
            @keydown.enter.prevent="confirmRootCreate"
            @keydown.esc.prevent="cancelRootCreate"
            @blur="confirmRootCreate"
            @click.stop
          />
        </div>
        <TreeNode
          v-for="entry in store.children[store.rootDir]"
          :key="entry.path"
          :entry="entry"
          :depth="0"
        />
        <p
          v-if="store.children[store.rootDir]!.length === 0 && !rootCreating"
          :class="$style.hint"
        >
          此目录暂时没有任何内容
        </p>
      </template>
    </div>

    <!-- 右键菜单：遮罩点击关闭 + fixed 浮层（视口边缘内收） -->
    <template v-if="store.ctx">
      <div
        :class="$style.ctxMask"
        @click="store.closeCtx"
        @contextmenu.prevent="store.closeCtx"
      />
      <div :class="$style.ctxMenu" :style="ctxPos" role="menu">
        <button type="button" :class="$style.ctxItem" @click="startCreate(false)">
          <MxIcon name="lucide:file-plus" :size="16" />
          <span>新建文件</span>
        </button>
        <button type="button" :class="$style.ctxItem" @click="startCreate(true)">
          <MxIcon name="lucide:folder-plus" :size="16" />
          <span>新建文件夹</span>
        </button>
        <template v-if="store.ctx.entry">
          <div :class="$style.ctxDivider" />
          <button type="button" :class="$style.ctxItem" @click="startRename">
            <MxIcon name="lucide:text-cursor-input" :size="16" />
            <span>重命名</span>
          </button>
          <button type="button" :class="[$style.ctxItem, $style.ctxDanger]" @click="ctxRemove">
            <MxIcon name="lucide:trash-2" :size="16" />
            <span>删除</span>
          </button>
          <button type="button" :class="$style.ctxItem" @click="ctxReveal">
            <MxIcon name="lucide:external-link" :size="16" />
            <span>在 Finder 中显示</span>
          </button>
        </template>
        <div :class="$style.ctxDivider" />
        <button type="button" :class="$style.ctxItem" @click="ctxRefresh">
          <MxIcon name="lucide:refresh-cw" :size="16" />
          <span>刷新</span>
        </button>
        <template v-if="store.ctx.entry">
          <button type="button" :class="$style.ctxItem" @click="ctxAddToChat">
            <MxIcon name="lucide:message-square-plus" :size="16" />
            <span>添加到对话</span>
          </button>
        </template>
      </div>
    </template>
  </div>
</template>

<style module>
/* Detail 轨道内满高：纵向 flex，树区自滚动 */
.panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  padding: var(--mx-space-3);
  position: relative;
}

/* 搜索框：圆角填充式（Trae 式） */
.searchbar {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  height: 30px;
  padding: 0 var(--mx-space-2);
  border-radius: var(--mx-radius-control);
  background: var(--mx-hover);
  color: var(--mx-text-tertiary);
  flex-shrink: 0;
}

.searchInput {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font: var(--mx-font-caption);
  color: var(--mx-text);
}

.searchInput::placeholder {
  color: var(--mx-text-caption);
}

.tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

/* 根层 phantom 行（与 TreeNode 行同构：26px 高 + 图标 + 内联输入） */
.row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  height: 26px;
  padding-right: var(--mx-space-2);
  border-radius: 6px;
  background: transparent;
  box-sizing: border-box;
}

.leafGap {
  width: 16px;
  flex-shrink: 0;
}

.fileIcon {
  flex-shrink: 0;
  color: var(--mx-text-secondary);
}

.inlineInput {
  flex: 1;
  min-width: 0;
  height: 20px;
  padding: 0 4px;
  border: 1px solid var(--mx-border-strong);
  border-radius: 4px;
  background: var(--mx-bg-surface);
  color: var(--mx-text);
  font: var(--mx-font-caption);
  outline: none;
}

.error {
  font: var(--mx-font-caption);
  color: var(--mx-state-error);
  margin: 0;
}

.hint {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  margin: 0;
  padding: var(--mx-space-2);
}

/* ── 右键菜单：遮罩 + fixed 浮层 ── */
.ctxMask {
  position: fixed;
  inset: 0;
  z-index: 90;
}

.ctxMenu {
  position: fixed;
  z-index: 91;
  min-width: 180px;
  padding: 4px;
  background: var(--mx-bg-surface);
  border: 1px solid var(--mx-separator);
  border-radius: var(--mx-radius-control);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
  display: flex;
  flex-direction: column;
}

.ctxItem {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  height: 28px;
  padding: 0 var(--mx-space-2);
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  color: var(--mx-text);
  font: var(--mx-font-caption);
  text-align: left;
  cursor: pointer;
}

.ctxItem:hover {
  background: var(--mx-hover);
}

.ctxDanger {
  color: var(--mx-state-error);
}

.ctxDivider {
  height: 1px;
  margin: 4px 6px;
  background: var(--mx-separator);
}
</style>
