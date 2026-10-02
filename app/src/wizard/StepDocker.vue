<script setup lang="ts">
/**
 * Docker 引导步（二期定稿：Docker 路径 = 远程连接特例，官方镜像 dotnetage/mindx）：
 * 容器运行中 → 直接连接（地址来自宿主端口映射，落 mode=remote）；
 * Docker 可用无容器 → 展示 docker run 命令模板，用户运行后「重新检测」（重跑探测，不自动执行 docker 命令）。
 * 本组件只做视图与步进：探测数据经 props 响应式更新（WizardApp 重跑 probe.run），执行动作全在父级。
 */
import { computed, ref } from 'vue'
import type { ProbeReport } from './types'

const props = defineProps<{ probe: ProbeReport | null }>()
const emit = defineEmits<{ done: [url: string]; retry: []; back: []; skip: [] }>()

/** 官方镜像名（与主进程 probe.ts MINDX_IMAGE_PREFIX 同值） */
const OFFICIAL_IMAGE = 'dotnetage/mindx'

/** docker run 命令模板（容器内 1314 → 宿主 1314；用户可自改端口映射后走远程步） */
const runCommand = `docker run -d --name mindx -p 1314:1314 ${OFFICIAL_IMAGE}`

/** 探活命中的容器（可直连；未映射端口/未探活的容器不列为连接候选） */
const connectable = computed(() => (props.probe?.dockerContainers ?? []).filter((c) => c.alive && c.hostPort !== null))

const copied = ref(false)

async function copyCommand(): Promise<void> {
  try {
    await navigator.clipboard.writeText(runCommand)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // 剪贴板不可用时静默（用户可手动选中文本复制）
  }
}
</script>

<template>
  <div :class="$style.body">
    <h2 :class="$style.title">Docker 中的智能主机</h2>
    <p :class="$style.desc">连接以官方镜像 {{ OFFICIAL_IMAGE }} 运行的容器；连接方式与远程主机相同。</p>

    <!-- 容器运行中：直连候选列表 -->
    <div v-if="connectable.length > 0" :class="$style.list">
      <div v-for="c in connectable" :key="c.name" :class="$style.row">
        <span :class="$style.rowName">{{ c.name }}</span>
        <span :class="$style.rowMeta">端口 {{ c.hostPort }}</span>
        <button type="button" :class="$style.primary" @click="emit('done', `ws://localhost:${c.hostPort}/ws`)">
          连接它
        </button>
      </div>
    </div>

    <!-- Docker 可用但无容器：命令模板引导（不自动执行 docker 命令——App 不接管容器生命周期） -->
    <div v-else :class="$style.guide">
      <p :class="$style.guideText">
        {{ probe?.dockerAvailable ? 'Docker 可用，但未检测到正在运行的智能主机容器。' : '未检测到 Docker（请先安装并启动 Docker）。' }}
      </p>
      <p :class="$style.guideText">在终端运行以下命令启动：</p>
      <div :class="$style.cmdRow">
        <code :class="$style.cmd">{{ runCommand }}</code>
        <button type="button" :class="$style.copy" @click="copyCommand">
          {{ copied ? '已复制' : '复制' }}
        </button>
      </div>
      <p :class="$style.guideHint">
        如端口 1314 已被占用，可改为其它宿主端口（如 -p 2314:1314），完成后在「远程智能主机」中填入对应地址。
      </p>
      <div :class="$style.guideActions">
        <button type="button" :class="$style.ghost" @click="emit('retry')">我已运行容器，重新检测</button>
      </div>
    </div>

    <div :class="$style.actions">
      <button type="button" :class="$style.ghost" @click="emit('back')">返回</button>
      <button type="button" :class="$style.ghost" @click="emit('skip')">稍后再说</button>
    </div>
  </div>
</template>

<style module>
.body {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
  width: 100%;
  max-width: 560px;
}

.title {
  margin: 0;
  font: var(--mx-font-title);
  color: var(--mx-text);
}

.desc {
  margin: 0;
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-2) var(--mx-space-3);
  border: 0.5px solid var(--mx-border-strong);
  border-radius: var(--mx-radius-card);
  background: var(--mx-bg-elevated);
}

.rowName {
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.rowMeta {
  flex: 1;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.primary {
  padding: 6px 16px;
  border: none;
  border-radius: var(--mx-radius-control);
  background: var(--mx-accent);
  font: var(--mx-font-body);
  font-weight: 500;
  color: var(--mx-text-on-accent);
  cursor: pointer;
  transition: opacity var(--mx-duration-fast) var(--mx-ease-standard);
}

.guide {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
  padding: var(--mx-space-3);
  border: 0.5px dashed var(--mx-border-strong);
  border-radius: var(--mx-radius-card);
}

.guideText {
  margin: 0;
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.guideHint {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.cmdRow {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-2) var(--mx-space-3);
  border-radius: var(--mx-radius-control);
  background: var(--mx-hover);
}

.cmd {
  flex: 1;
  font-family: var(--mx-font-mono, monospace);
  font-size: 12px;
  color: var(--mx-text);
  user-select: text;
}

.copy {
  padding: 4px 12px;
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  font: var(--mx-font-caption);
  color: var(--mx-accent);
  cursor: pointer;
}

.copy:hover {
  background: color-mix(in srgb, var(--mx-accent) 10%, transparent);
}

.guideActions {
  display: flex;
  justify-content: flex-start;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
  margin-top: var(--mx-space-2);
}

.ghost {
  padding: 8px 16px;
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
  cursor: pointer;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.ghost:hover {
  background: var(--mx-hover);
  color: var(--mx-text);
}
</style>
