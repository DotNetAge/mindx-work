<script setup lang="ts">
/** 连接路径步（探测驱动，定稿：向导回答"daemon 在哪"）：
 * 亮出探测事实 → 建议路径 → 用户确认/改选。Docker 路径二期已开放（引导步内分流），
 * 本机安装路径三期已开放（mac/Linux 直装；Windows WSL 分支第四期，仍禁用）。 */
import { computed } from 'vue'
import type { ProbeReport } from './types'

const props = defineProps<{ probe: ProbeReport | null }>()
const emit = defineEmits<{ pick: [path: 'local' | 'remote' | 'docker' | 'install']; skip: [] }>()

const localAvailable = computed(() => !!props.probe?.daemonAlive)
/** Docker 路径可选 = Docker 可用（容器运行中/无容器都可进引导步，引导步内分流） */
const dockerAvailable = computed(() => !!props.probe?.dockerAvailable)
/** 探活命中的容器数（连接步卡片直接显示可直连事实） */
const containerCount = computed(() => (props.probe?.dockerContainers ?? []).filter((c) => c.alive).length)
/** 本机安装可选 = 非 Windows（WSL 分支第四期；win32 保持禁用） */
const installAvailable = computed(() => props.probe?.platform !== 'win32')
</script>

<template>
  <div :class="$style.body">
    <h2 :class="$style.title">连接智能主机</h2>
    <p :class="$style.desc">
      {{
        probe
          ? '已扫描本机环境，选择智能主机连接方式；也可以稍后在设置中随时配置。'
          : '正在扫描本机环境…'
      }}
    </p>

    <div :class="$style.paths">
      <!-- 本机 daemon：探活命中可选 -->
      <button
        type="button"
        :class="$style.pathCard"
        :disabled="!localAvailable"
        data-wizard-path="local"
        @click="emit('pick', 'local')"
      >
        <div :class="$style.pathHead">
          <span>本机已有智能主机</span>
          <span :class="[localAvailable ? $style.tagOk : $style.tagMiss]">
            {{ localAvailable ? '已检测到（端口 1314）' : '未检测到' }}
          </span>
        </div>
        <span :class="$style.pathDesc">检测到本机已有智能主机在运行——选择此项即接入它（升级模式）：沿用其全部模型配置，不做新安装。</span>
      </button>

      <!-- 远程直连：恒可选 -->
      <button type="button" :class="$style.pathCard" data-wizard-path="remote" @click="emit('pick', 'remote')">
        <div :class="$style.pathHead">
          <span>远程智能主机</span>
        </div>
        <span :class="$style.pathDesc">连接另一台机器上的智能主机（地址形如 ws://主机:1314/ws）。</span>
      </button>

      <!-- Docker 路径（二期）：Docker 可用即可进引导步（运行中直连 / 无容器给命令模板） -->
      <button
        type="button"
        :class="$style.pathCard"
        :disabled="!dockerAvailable"
        data-wizard-path="docker"
        @click="emit('pick', 'docker')"
      >
        <div :class="$style.pathHead">
          <span>Docker 容器</span>
          <span :class="[dockerAvailable ? $style.tagOk : $style.tagMiss]">
            {{ !dockerAvailable ? '未检测到 Docker' : containerCount > 0 ? `容器运行中（${containerCount}）` : 'Docker 可用' }}
          </span>
        </div>
        <span :class="$style.pathDesc">连接以官方镜像在本机 Docker 中运行的智能主机；容器未运行时提供启动命令。</span>
      </button>

      <!-- 本机安装（三期）：mac/Linux 直装可点；Windows WSL 分支第四期保持禁用 -->
      <button
        type="button"
        :class="$style.pathCard"
        :disabled="!installAvailable"
        data-wizard-path="install"
        @click="emit('pick', 'install')"
      >
        <div :class="$style.pathHead">
          <span>本机安装</span>
          <span v-if="probe?.platform === 'win32'" :class="[probe?.wslAvailable ? $style.tagOk : $style.tagMiss]">
            {{ probe?.wslAvailable ? `WSL 可用（${probe.wslDistros.length} 个发行版）` : '未检测到 WSL' }}
          </span>
          <span v-if="installAvailable" :class="$style.tagOk">本机未检测到运行中的智能主机</span>
        </div>
        <span :class="$style.pathDesc">随应用内置的智能主机程序安装为本机服务（安装、注册、拉起全程自动）。</span>
      </button>
    </div>

    <div :class="$style.actions">
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

.paths {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
}

/* 路径卡：整卡可点；禁用 = 事实缺失（仍可读状态标签） */
.pathCard {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--mx-space-3);
  box-sizing: border-box;
  text-align: left;
  border: 0.5px solid var(--mx-border-strong);
  border-radius: var(--mx-radius-card);
  background: var(--mx-bg-elevated);
  cursor: pointer;
  transition: border-color var(--mx-duration-fast) var(--mx-ease-standard),
    background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.pathCard:hover:not(:disabled) {
  border-color: var(--mx-accent);
}

.pathCard:disabled {
  opacity: 0.6;
  cursor: default;
}

.pathCard:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: -2px;
}

.pathHead {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  font: var(--mx-font-body);
  font-weight: 500;
  color: var(--mx-text);
}

.pathDesc {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.tagOk,
.tagMiss,
.tagSoon {
  font: var(--mx-font-caption);
  padding: 1px 8px;
  border-radius: 999px;
}

.tagOk {
  color: var(--mx-accent);
  background: color-mix(in srgb, var(--mx-accent) 12%, transparent);
}

.tagMiss {
  color: var(--mx-text-tertiary);
  background: var(--mx-hover);
}

.tagSoon {
  color: var(--mx-text-secondary);
  border: 0.5px solid var(--mx-border-strong);
}

.actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--mx-space-2);
}

/* 跳过按钮：次级幽灵样式（跳过是一等公民） */
.ghost {
  padding: 6px 16px;
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
