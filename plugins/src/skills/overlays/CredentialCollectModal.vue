<script setup lang="ts">
/**
 * 凭据收集 modal（纯内容组件，卡片壳由 Overlay 容器提供）。
 * requires.envs 对象形态条目缺失时的首用收集框：每个待收集变量一行——
 * 变量名 + prompt 说明 + 申请入口链接（sensitive 掩码输入）。
 * 提交 = skill.credential.set 落库 + skill.prepare 重入推进（store.submitCredentials）；
 * 全部填齐才能提交（daemon 侧空值同样拒绝，双层一致）。
 */
import { computed, reactive, ref } from 'vue'
import { useShell } from '@mindx-work/ui-shell-vue'
import { useSkillsStore } from '../store'
import { pushNotice } from '../notice'
import { credentialCollect, endCollect } from '../collect'
import { MODAL_SKILL_CREDENTIAL_COLLECT } from '../ids'

const store = useSkillsStore()
const shell = useShell()

// setup 期快照：打开前 handleCollectNotification 已写入待收集清单
// （modal 每次打开重新挂载，输入态按条目重建）
const values = reactive<Record<string, string>>({})
for (const item of credentialCollect.envs) values[item.name] = ''

const busy = ref(false)

const allFilled = computed(
  () => credentialCollect.envs.length > 0 && credentialCollect.envs.every((item) => (values[item.name] || '').trim() !== ''),
)

/** 申请入口经系统浏览器打开（Electron 宿主桥优先，纯 Web 降级新窗口） */
function openUrl(url: string): void {
  if (window.mxDesktop?.openExternal) {
    void window.mxDesktop.openExternal(url)
    return
  }
  window.open(url, '_blank', 'noopener')
}

function close(): void {
  shell.Overlay.remove(MODAL_SKILL_CREDENTIAL_COLLECT)
}

function cancel(): void {
  endCollect()
  close()
}

async function submit(): Promise<void> {
  if (!allFilled.value || busy.value) return
  busy.value = true
  try {
    const envs = credentialCollect.envs.map((item) => ({ env: item.name, value: values[item.name] || '' }))
    const skill = credentialCollect.skill
    endCollect()
    close()
    await store.submitCredentials(skill, envs)
    pushNotice(shell, 'success', `技能「${skill}」凭据已保存`)
  } catch (err) {
    close()
    pushNotice(shell, 'error', err instanceof Error ? err.message : '凭据保存失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="credentialCollect.active" :class="$style.body">
    <span :class="$style.title">完善技能凭据</span>
    <p :class="$style.message">
      技能「{{ credentialCollect.skill }}」需要以下环境变量才能运行，请填入对应值（保存在本机凭据库）。
    </p>
    <div
      v-for="item in credentialCollect.envs"
      :key="item.name"
      :class="$style.field"
    >
      <div :class="$style.fieldHead">
        <span :class="$style.fieldName">{{ item.name }}</span>
        <button
          v-if="item.url"
          type="button"
          class="mx-btn"
          :class="$style.linkBtn"
          @click="openUrl(item.url)"
        >
          申请入口
        </button>
      </div>
      <p v-if="item.prompt" :class="$style.prompt">{{ item.prompt }}</p>
      <el-input
        v-model="values[item.name]"
        :type="item.sensitive ? 'password' : 'text'"
        :show-password="item.sensitive"
        :placeholder="item.sensitive ? '输入后掩码显示' : `粘贴 ${item.name} 的值`"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
    <div :class="$style.actions">
      <button type="button" class="mx-btn" @click="cancel">取消</button>
      <button
        type="button"
        class="mx-btn mx-btn--primary"
        :disabled="!allFilled || busy"
        @click="submit()"
      >
        <span v-if="busy" class="mx-text-loading">保存中…</span>
        <template v-else>保存</template>
      </button>
    </div>
  </div>
</template>

<style module>
.body {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
  width: 480px;
  max-width: 100%;
}

.title {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.message {
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
  margin: 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-2);
}

.fieldHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-2);
}

.fieldName {
  font: var(--mx-font-body);
  font-family: var(--mx-font-mono);
  color: var(--mx-text);
}

.linkBtn {
  padding: 0 var(--mx-space-2);
}

.prompt {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  margin: 0;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
  margin-top: var(--mx-space-2);
}
</style>
