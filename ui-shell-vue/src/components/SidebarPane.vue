<script setup lang="ts">
/**
 * SidebarPane：分节导航。行是数据模型由壳统一渲染，
 * 行点击切换 Content 活动条目（导航联动归框架，插件零连线）。
 * 三段布局：Header 固定区（Logo / 折叠按钮）→ 滚动区（节 + 行）→ Footer 固定区（固定操作）。
 * 全部几何对齐 DSH SidebarRoot.module.css 真实值（逐项注明行号）：
 * 根 padding 6/12（L14）、行 min-height 36 / padding 7 8 / margin 0 2 / radius 12（L468-484）、
 * 选中 = interactive-bg-hover（L490-493）、折叠 rail 80px / 36 盒 / 12px 节奏（L31-35,514-526 宽度本地化）。
 * 宽度可拖拽调节（契约"几何由壳计算"——拖拽属壳的几何职责，
 * 宽度为适配器本地状态，双击手柄重置；折叠态禁用拖拽）。
 */
import { ref } from 'vue'
import { useShell, useShellData } from '../reactivity'
import MxIcon from '../MxIcon.vue'

/** 宽度边界与缺省值（DSH 观感：缺省 248，可收窄到图标密度） */
const WIDTH_MIN = 200
const WIDTH_MAX = 360
const WIDTH_DEFAULT = 248

const shell = useShell()
const data = useShellData(() => ({
  sections: shell.Sidebar.entries,
  headers: shell.Sidebar.headers,
  footers: shell.Sidebar.footers,
  activeId: shell.Content.activeId,
  collapsed: shell.sidebarCollapsed,
}))

const width = ref(WIDTH_DEFAULT)
const dragging = ref(false)

/** 指针拖拽调宽：捕获指针后全程跟随，clamp 到边界（折叠态禁用） */
function onResizeStart(event: PointerEvent) {
  if (data.value.collapsed) return
  dragging.value = true
  const startX = event.clientX
  const startWidth = width.value
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  const onMove = (e: PointerEvent) => {
    width.value = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, startWidth + e.clientX - startX))
  }
  const onUp = () => {
    dragging.value = false
    target.removeEventListener('pointermove', onMove)
    target.removeEventListener('pointerup', onUp)
    target.removeEventListener('pointercancel', onUp)
  }
  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerup', onUp)
  // pointercancel（手势被系统接管/打断）同样终止拖拽，避免 dragging 卡死与监听泄漏
  target.addEventListener('pointercancel', onUp)
}
</script>

<template>
  <!-- 外层承载宽度与拖拽手柄（不受内层滚动裁剪），nav 只负责滚动 -->
  <section
    :class="[$style.sidebar, { [$style.collapsed]: data.collapsed, [$style.dragging]: dragging }]"
    :style="{ '--sidebar-width': `${width}px` }"
  >
    <!-- macOS 壳：侧栏顶部拖动带（红绿灯排，48px clearance）——
         logoRow 从其下开始，避免与系统红绿灯同排叠压（对齐 DSH 顶部条带结构） -->
    <div :class="$style.topBand" data-mx-drag-band aria-hidden="true" />
    <!-- Header 固定区：不随内容滚动，折叠成 rail 时仍渲染（组件经 compact 自适配几何） -->
    <div v-if="data.headers.length" :class="$style.header">
      <component
        :is="header.component"
        v-for="header in data.headers"
        :key="header.id"
        :compact="data.collapsed"
      />
    </div>
    <nav :class="$style.scroll">
      <template v-for="section in data.sections" :key="section.id">
        <div v-if="section.title && !data.collapsed" :class="$style.sectionTitle">
          {{ section.title }}
        </div>
        <!-- 分节组件席位：rows 为空且提供 component 时整节由组件渲染（契约：行数据模型优先，
             rows 非空时组件不渲染）。折叠成 rail 时经 compact 传参由组件自适配 -->
        <div v-if="section.component && !section.rows.length" :class="$style.sectionComponent">
          <component :is="section.component" :compact="data.collapsed" />
        </div>
        <button
          v-for="row in section.rows"
          :key="row.id"
          type="button"
          :class="[$style.row, { [$style.rowButton]: row.variant === 'button' }]"
          :data-active="row.id === data.activeId ? 'true' : 'false'"
          :title="data.collapsed ? row.label : undefined"
          @click="shell.Content.activate(row.id)"
        >
          <MxIcon
            v-if="row.icon"
            :name="row.icon"
            :size="data.collapsed ? 20 : 16"
          />
          <span v-if="!data.collapsed" :class="$style.rowLabel">{{ row.label }}</span>
          <component :is="row.badge" v-if="row.badge && !data.collapsed" />
        </button>
      </template>
    </nav>
    <!-- Footer 固定区：固定操作行，不随内容滚动（DSH footArea 模式：占位者自带几何） -->
    <div v-if="data.footers.length" :class="$style.footer">
      <component
        :is="footer.component"
        v-for="footer in data.footers"
        :key="footer.id"
        :compact="data.collapsed"
      />
    </div>
    <!-- 右缘拖拽手柄：悬停时显示分隔高亮，双击重置 -->
    <div
      v-if="!data.collapsed"
      :class="$style.resizer"
      title="拖拽调节宽度，双击重置"
      @pointerdown="onResizeStart"
      @dblclick="width = WIDTH_DEFAULT"
    />
  </section>
</template>

<style module>
/* 根：填充 + 1px 右边框（SidebarRoot L1-2 注释：边框由布局列绘制，此处等效承载）；
   padding 6px 12px（L14），折叠 18px 22px 6px（L35，宽度 80 对齐 DSH 官方桌面端折叠栏） */
.sidebar {
  position: relative;
  display: flex;
  flex-direction: column;
  width: var(--sidebar-width);
  padding: var(--mx-space-1) var(--mx-space-3);
  box-sizing: border-box;
  background: var(--mx-bg-surface);
  border-right: 1px solid var(--mx-separator-soft);
  transition: width var(--mx-duration-motion) var(--mx-ease-standard);
  flex-shrink: 0;
}

/* 滚动区：行距 2px（WorkspaceBrowser flatList `> * + *` margin-top 2）；
   根 padding 统一承载，区内不再留白 */
.scroll {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  overflow-x: hidden;
}

/* Header / Footer 固定区：无自带几何（对齐 DSH footArea——占位组件自带样式） */
.header,
.footer {
  flex-shrink: 0;
}

/* 拖拽期间关闭宽度过渡，保证跟手 */
.dragging {
  transition: none;
}

/* 折叠 rail：80px 宽（DSH 官方桌面端折叠栏实测 ≈78px，对齐其观感——
 * 恰好容纳 macOS 红绿灯三按钮：trafficLightPosition x=16 + 直径12×3 + 间距8×2 = 68，
 * 右侧再留 12px 与左 inset 平衡；56px 时第三颗按钮溢出到内容区）。
 * 36 盒居中 → 22px 侧 padding；12px 垂直节奏不变 */
.collapsed {
  width: 80px;
  padding: 18px 22px 6px;
}

.collapsed .scroll {
  gap: var(--mx-space-3);
  align-items: center;
}

/* 分节组件席位：组件填满滚动区剩余高度，内部滚动与布局由组件自管
   （Tasks 会话列表等富分节）；折叠 rail 时收窄为 36px 盒对齐折叠行节奏 */
.sectionComponent {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.collapsed .sectionComponent {
  flex: none;
  width: 36px;
  align-self: center;
}

/* 节标题（sectionHeader，WorkspaceBrowser L45-58）：高 36 / 14px tertiary 字 /
   padding-left 4 / mb 4 / radius 12 */
.sectionTitle {
  display: flex;
  align-items: center;
  height: 36px;
  flex-shrink: 0;
  font: var(--mx-font-body);
  line-height: 20px;
  color: var(--mx-text-tertiary);
  padding-left: 4px;
  margin-bottom: var(--mx-space-1);
  border-radius: var(--mx-radius-card);
  white-space: nowrap;
}

/* 行（projectRow/sessionRow，Rows.module.css L1-12,94-98）：
   height 34 / padding 0 8 / radius 8 / gap 6 */
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: calc(100% - 4px);
  height: 34px;
  padding: 0 var(--mx-space-2);
  margin: 0 2px;
  box-sizing: border-box;
  flex-shrink: 0;
  font: var(--mx-font-body);
  color: var(--mx-text);
  background: transparent;
  border: none;
  border-radius: var(--mx-radius-control);
  cursor: pointer;
  text-align: left;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

/* 交互态全量显式定义（军规 5/6）；选中态为状态而非交互态，经 data-active 表达 */
.row:hover:not([data-active='true']) {
  background: var(--mx-hover);
}

.row:active:not([data-active='true']) {
  background: var(--mx-active);
}

/* focus-visible：主文字色描边（panelRow:focus-visible L495-498） */
.row:focus-visible {
  outline: 2px solid var(--mx-text);
  outline-offset: -2px;
}

.row:disabled {
  opacity: 0.4;
  cursor: default;
}

/* 选中态（panelActive L490-493）：复用 interactive-bg-hover，非独立实色 */
.row[data-active='true'] {
  color: var(--mx-text);
  background: var(--mx-hover);
}

.rowLabel {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 按钮卡变体（newSession L389-408）：38 高 / 0.5px 边框 / radius 12 / elevated 填充 / 500 字重 */
.rowButton {
  justify-content: center;
  gap: 6px;
  height: 38px;
  min-height: 38px;
  padding: 8px 16px;
  margin: 0 2px 12px;
  font-weight: 500;
  background: var(--mx-btn-elevated);
  border: 0.5px solid var(--mx-border-strong);
}

/* newSession:hover = button-floating-hover（L410-412）= --mx-hover-solid 同值；
   按钮卡为动作行不承载选中底（DSH newSession 无 panelActive 规则），hover 压过选中 */
.rowButton:hover {
  background: var(--mx-hover-solid);
}

.rowButton:active {
  background: var(--mx-hover-solid);
}

.rowButton[data-active='true'] {
  background: var(--mx-btn-elevated);
}

/* 折叠行（collapsed panelRow L519-526）：36x36 盒、radius 12、居中、margin 0、primary 墨色 */
.collapsed .row {
  width: 36px;
  height: 36px;
  min-height: 36px;
  justify-content: center;
  margin: 0;
  padding: 0;
  border-radius: var(--mx-radius-card);
  color: var(--mx-text);
}

/* 折叠按钮卡（collapsed newSession L433-446）：36x36、透明底、无边框 */
.collapsed .rowButton {
  width: 36px;
  height: 36px;
  padding: 0;
  margin: 0 0 12px;
  border-color: transparent;
  background: transparent;
}

.collapsed .rowButton:hover:not([data-active='true']) {
  background: var(--mx-hover);
}

.collapsed .sectionTitle {
  visibility: hidden;
  height: 0;
  padding: 0;
}

.resizer {
  position: absolute;
  top: 0;
  right: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  /* 高于主区 dragBand（z-index 5）：否则顶部 48px 的手柄条被拖动带盖住无法抓取 */
  z-index: 6;
}

.resizer:hover {
  background: color-mix(in srgb, var(--mx-accent) 35%, transparent);
}

/* macOS 壳：侧栏顶部拖动带——红绿灯独占顶部一排（48px，--dsh-frame-top-clearance
 * 同值），logoRow 从其下开始；可拖动窗口；非 darwin 不渲染（无占位） */
.topBand {
  display: none;
}

:global(html[data-platform='darwin']) .topBand {
  display: block;
  flex: none;
  height: 48px;
  -webkit-app-region: drag;
}

/* ===== macOS Electron 壳：窗口 vibrancy 透出 =====
 * 壳（AppFrame）透明后，侧栏只铺半透明染色，禁止实底（实底会挡住 vibrancy）。
 * 三层结构对齐 DSH AppFrame.module.css：顶部 35% 内 10% 蓝色 wash 渐隐、
 * 底部 32% 内 9% 蓝灰紫 wash 浮起、tint 本身 40% 透明度（97% 混入蓝色）。
 * 暗色减淡（fill 50%、wash 8%/7%——亮色 wash 在暗底上发紫）；
 * 系统开启"减弱透明度"时回退 90% 实底保证可读性。
 * 分隔线移交给不透明的主区左缘（ContentPane darwin 分支），此处去掉右边框。 */
:global(html[data-platform='darwin']) .sidebar {
  background:
    linear-gradient(
      to bottom,
      rgb(var(--mx-wash-blue) / 0.1),
      rgb(var(--mx-wash-blue) / 0) 35%,
      rgb(var(--mx-wash-mauve) / 0) 68%,
      rgb(var(--mx-wash-mauve) / 0.09)
    ),
    color-mix(
      in srgb,
      color-mix(in srgb, var(--mx-bg-surface) 97%, rgb(var(--mx-wash-blue))) 40%,
      transparent
    );
  border-right: none;
}

:global(html[data-platform='darwin'][data-mx-theme='dark']) .sidebar {
  background:
    linear-gradient(
      to bottom,
      rgb(var(--mx-wash-blue) / 0.08),
      rgb(var(--mx-wash-blue) / 0) 35%,
      rgb(var(--mx-wash-mauve) / 0) 68%,
      rgb(var(--mx-wash-mauve) / 0.07)
    ),
    color-mix(in srgb, var(--mx-bg-surface) 50%, transparent);
}

@media (prefers-reduced-transparency: reduce) {
  :global(html[data-platform='darwin']) .sidebar,
  :global(html[data-platform='darwin'][data-mx-theme='dark']) .sidebar {
    background: color-mix(in srgb, var(--mx-bg-surface) 90%, transparent);
  }
}
</style>
