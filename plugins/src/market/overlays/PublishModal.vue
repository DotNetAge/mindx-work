<script setup lang="ts">
/**
 * 发布 modal（§3/§4，纯内容组件：卡片壳由 Overlay 容器提供）。
 * 两步流程：选本地包（agent/skill/team 胶囊 + 本地清单）→ market.pack 预填表单
 * （名称/描述/分类/体积/sha256 只读）→ 填版本（必填，默认 0.1.0）与许可（可选）+
 * 谱系声明（原创/衍生切换；衍生必填上游 kind+name，可选版本）→ market.publish。
 * 403「该包名已被他人注册」→ 自动切衍生模式并预填原包为上游（§4.2 包名冲突
 * 改名发布），发布名可改（daemon 以覆盖清单 name 发布到新名）。
 * 回执展示 sha256（内容寻址指纹），告警逐条透出（引用缺失等不阻断语义）。
 */
import { computed, ref, watch } from 'vue'
import { useShell } from '@mindx-work/ui-shell-vue'
import { useMarketStore, type MarketPackPreview } from '../store'
import { pushNotice } from '../notice'

const store = useMarketStore()
const shell = useShell()

/** 包体积人性化展示（KB/MB 一位小数，Bytes 原样） */
function formatSizeLocal(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 步骤：select = 选本地包；form = 发布表单 */
const step = ref<'select' | 'form'>('select')
const activeKind = ref<'agent' | 'skill' | 'team'>('agent')
const selectedName = ref('')
const packing = ref(false)
const packError = ref('')
const preview = ref<MarketPackPreview | null>(null)

// 表单状态
const version = ref('0.1.0')
const license = ref('')
// 发布位置（M7 组织源）：空 = 公共资源社区；非空 = 该组织专属空间（仅组织成员可见）
const publishOrgSlug = ref('')
const derived = ref(false)
const derivedKind = ref('')
const derivedName = ref('')
const derivedVersion = ref('')
const publishName = ref('')
/** 发布名可编辑开关：仅 403 冲突切衍生后开放（常规发布名 = 本地包名，不暴露覆盖） */
const publishNameEditable = ref(false)
const publishing = ref(false)
const submitError = ref('')

const visible = computed(() => store.publishTarget !== null)

const localItems = computed(() => store.localPackages.filter((p) => p.kind === activeKind.value))

const kindLabels: Record<string, string> = { agent: '成员', skill: '技能', team: '团队' }

const derivedInvalid = computed(() => derived.value && (!derivedKind.value.trim() || !derivedName.value.trim()))

/** 可选发布位置的组织（冻结组织不可选） */
const publishableOrgs = computed(() => store.myOrgs.filter((o) => o.status !== 'frozen'))

/** 打开时重置到选择步骤（kind 按入口预选） */
watch(visible, (v) => {
  if (!v) return
  step.value = 'select'
  activeKind.value = (store.publishTarget?.kind as 'agent' | 'skill' | 'team') || 'agent'
  selectedName.value = ''
  preview.value = null
  packError.value = ''
  submitError.value = ''
  publishOrgSlug.value = '' // 每次打开默认公共资源社区
  void store.fetchMyOrgs()
  void store.fetchLocalPackages()
})

/** 选中本地包：market.pack 预填表单（打包不入库） */
function choose(name: string): void {
  if (packing.value) return
  selectedName.value = name
  packing.value = true
  packError.value = ''
  void store
    .packPreview(activeKind.value, name)
    .then((res) => {
      preview.value = res
      version.value = res.version || '0.1.0'
      license.value = ''
      derived.value = false
      derivedKind.value = ''
      derivedName.value = ''
      derivedVersion.value = ''
      publishName.value = res.name
      publishNameEditable.value = false
      submitError.value = ''
      step.value = 'form'
    })
    .catch((err: unknown) => {
      packError.value = err instanceof Error ? err.message : '打包预览失败'
    })
    .finally(() => {
      packing.value = false
    })
}

/** 403 包名冲突：自动切衍生模式并预填原包为上游（§4.2 改名发布引导） */
function enterDerivedFromConflict(conflictName: string): void {
  derived.value = true
  derivedKind.value = activeKind.value
  derivedName.value = conflictName
  publishName.value = ''
  publishNameEditable.value = true
  submitError.value = `包名「${conflictName}」已被他人注册。已切换为衍生发布：填写你的新包名，谱系将指向原包。`
}

/** 提交发布：版本必填；衍生需 kind+name 成对；publish_name 仅在改名模式下携带 */
function publish(): void {
  if (!preview.value || publishing.value || derivedInvalid.value) return
  publishing.value = true
  submitError.value = ''
  const targetName = publishNameEditable.value ? publishName.value.trim() : preview.value.name
  void store
    .publish({
      kind: preview.value.kind,
      name: preview.value.name,
      ...(publishNameEditable.value && targetName ? { publish_name: targetName } : {}),
      version: version.value.trim(),
      ...(license.value.trim() ? { license: license.value.trim() } : {}),
      ...(publishOrgSlug.value ? { org_slug: publishOrgSlug.value } : {}),
      ...(derived.value
        ? {
            derived_kind: derivedKind.value.trim(),
            derived_name: derivedName.value.trim(),
            ...(derivedVersion.value.trim() ? { derived_version: derivedVersion.value.trim() } : {}),
          }
        : {}),
    })
    .then((res) => {
      const where = publishOrgSlug.value ? `至「${publishableOrgs.value.find((o) => o.slug === publishOrgSlug.value)?.name || '组织专属空间'}」` : ''
      const suffix = (res.warnings ?? []).length > 0 ? `（${(res.warnings ?? []).length} 条打包告警）` : ''
      pushNotice(shell, 'success', `已发布「${targetName}」v${res.version}${where}${suffix}`)
      close()
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('该包名已被他人注册')) {
        enterDerivedFromConflict(targetName || preview.value?.name || '')
        return
      }
      submitError.value = msg
    })
    .finally(() => {
      publishing.value = false
    })
}

function close(): void {
  store.cancelPublishDialog()
}
</script>

<template>
  <div v-if="visible" :class="$style.body">
    <!-- ── 步骤 1：选择本地包 ── -->
    <template v-if="step === 'select'">
      <span :class="$style.title">发布到社区</span>
      <p :class="$style.desc">选择要发布的本地包。发布需要先绑定MindX 账号，包名遵循先到先得。</p>

      <div class="mx-tabs" :class="$style.kindTabs">
        <span data-indicator aria-hidden="true" :class="$style.tabsIndicator" />
        <button
          v-for="k in ['agent', 'skill', 'team']"
          :key="k"
          type="button"
          class="mx-tab"
          role="tab"
          :aria-selected="activeKind === k ? 'true' : 'false'"
          @click="activeKind = k as 'agent' | 'skill' | 'team'"
        >{{ kindLabels[k] }}</button>
      </div>

      <div :class="$style.localList">
        <button
          v-for="item in localItems"
          :key="`${item.kind}/${item.name}`"
          type="button"
          :class="$style.localItem"
          :disabled="packing"
          @click="choose(item.name)"
        >
          <span :class="$style.localName">{{ item.name }}</span>
          <span :class="$style.localKind">{{ kindLabels[item.kind] }}</span>
        </button>
        <p v-if="localItems.length === 0" :class="$style.hint">本地暂无可发布的{{ kindLabels[activeKind] }}包。</p>
      </div>

      <p v-if="packing" class="mx-text-loading">正在打包预览…</p>
      <p v-if="packError" :class="$style.error">{{ packError }}</p>

      <div :class="$style.actions">
        <button type="button" class="mx-btn" @click="close">取消</button>
      </div>
    </template>

    <!-- ── 步骤 2：发布表单 ── -->
    <template v-else-if="preview">
      <span :class="$style.title">发布「{{ preview.name }}」</span>

      <!-- 打包预览（只读：清单内容即发布内容） -->
      <div :class="$style.previewBox">
        <div :class="$style.previewRow">
          <span :class="$style.previewKey">描述</span>
          <span :class="$style.previewVal">{{ preview.description || '（清单未提供）' }}</span>
        </div>
        <div :class="$style.previewRow">
          <span :class="$style.previewKey">分类</span>
          <span :class="$style.previewVal">{{ preview.category || '未分类' }}</span>
        </div>
        <div v-if="(preview.skills ?? []).length" :class="$style.previewRow">
          <span :class="$style.previewKey">技能</span>
          <span :class="$style.previewVal">{{ (preview.skills ?? []).join('、') }}</span>
        </div>
        <div v-if="(preview.members ?? []).length" :class="$style.previewRow">
          <span :class="$style.previewKey">成员</span>
          <span :class="$style.previewVal">{{ (preview.members ?? []).join('、') }}</span>
        </div>
        <div :class="$style.previewRow">
          <span :class="$style.previewKey">体积</span>
          <span :class="$style.previewVal">{{ formatSizeLocal(preview.size) }} · sha256 {{ preview.sha256.slice(0, 12) }}…</span>
        </div>
      </div>

      <label :class="$style.field">
        <span :class="$style.fieldLabel">版本号</span>
        <input v-model="version" class="mx-input" placeholder="0.1.0" spellcheck="false" />
      </label>

      <!-- 发布位置（M7 组织源）：默认公共资源社区，全员可见；组织专属空间仅组织成员可见 -->
      <label v-if="publishableOrgs.length > 0" :class="$style.field">
        <span :class="$style.fieldLabel">发布位置</span>
        <select v-model="publishOrgSlug" class="mx-input">
          <option value="">公共资源社区（所有用户可见）</option>
          <option v-for="o in publishableOrgs" :key="o.slug" :value="o.slug">{{ o.name }}（仅组织成员可见）</option>
        </select>
      </label>

      <label :class="$style.field">
        <span :class="$style.fieldLabel">许可证（可选）</span>
        <input v-model="license" class="mx-input" placeholder="MIT、Apache-2.0…" spellcheck="false" />
      </label>

      <!-- 谱系声明（§4：必答；衍生必填上游指向） -->
      <div :class="$style.field">
        <span :class="$style.fieldLabel">是否衍生作品</span>
        <div :class="$style.segRow">
          <button type="button" :class="$style.segBtn" :data-on="!derived ? 'true' : 'false'" @click="derived = false">原创</button>
          <button type="button" :class="$style.segBtn" :data-on="derived ? 'true' : 'false'" @click="derived = true">衍生自已有包</button>
        </div>
      </div>

      <template v-if="derived">
        <div :class="$style.derivedRow">
          <select v-model="derivedKind" class="mx-input" :class="$style.derivedKind">
            <option value="agent">成员</option>
            <option value="skill">技能</option>
            <option value="team">团队</option>
            <option value="plugin">插件</option>
          </select>
          <input v-model="derivedName" class="mx-input" placeholder="上游包名（必填）" spellcheck="false" />
        </div>
        <input v-model="derivedVersion" class="mx-input" placeholder="上游版本（可选，如 1.0.0）" spellcheck="false" />
      </template>

      <!-- 发布名：仅 403 冲突切衍生后开放（改名发布，daemon 覆盖清单 name） -->
      <label v-if="publishNameEditable" :class="$style.field">
        <span :class="$style.fieldLabel">新包名（衍生改名发布）</span>
        <input v-model="publishName" class="mx-input" placeholder="你的新包名" spellcheck="false" />
      </label>

      <p v-if="submitError" :class="$style.error">{{ submitError }}</p>

      <div :class="$style.actions">
        <button type="button" class="mx-btn" :disabled="publishing" @click="step = 'select'; preview = null">上一步</button>
        <button
          type="button"
          class="mx-btn mx-btn--primary"
          :disabled="!version.trim() || derivedInvalid || publishing || (publishNameEditable && !publishName.trim())"
          @click="publish()"
        >
          <span v-if="publishing" class="mx-text-loading">发布中…</span>
          <template v-else>发布</template>
        </button>
      </div>
    </template>
  </div>
</template>

<style module>
.body {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
}

.title {
  font: var(--mx-font-heading);
  color: var(--mx-text);
}

.desc {
  margin: 0;
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
}

/* kind 胶囊（复用 mx-tabs 分段控件形态，指示器同款） */
.kindTabs {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0;
  padding: 4px;
  border: 1px solid var(--mx-border-l4);
  border-radius: 10px;
}

.tabsIndicator {
  position: absolute;
  inset: 4px auto 4px 4px;
  box-sizing: border-box;
  border-radius: 7px;
  background: var(--mx-bg-elevated);
  transition:
    transform 180ms ease,
    width 180ms ease;
  pointer-events: none;
}

.localList {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  max-height: 280px;
  overflow-y: auto;
}

.localItem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mx-space-2);
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background-color var(--mx-duration-fast) var(--mx-ease-standard);
}

.localItem:hover:not(:disabled) {
  background: var(--mx-hover);
}

.localItem:disabled {
  cursor: default;
  opacity: 0.6;
}

.localName {
  font: var(--mx-font-body);
  color: var(--mx-text);
}

.localKind {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.previewBox {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
  padding: var(--mx-space-2) var(--mx-space-3);
  border: 1px solid var(--mx-border-l4);
  border-radius: 6px;
}

.previewRow {
  display: flex;
  gap: var(--mx-space-2);
}

.previewKey {
  flex: none;
  width: 42px;
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.previewVal {
  flex: 1;
  min-width: 0;
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  word-break: break-all;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.fieldLabel {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
}

.segRow {
  display: inline-flex;
  gap: var(--mx-space-1);
}

.segBtn {
  padding: 3px 12px;
  border: 1px solid var(--mx-border-l4);
  border-radius: 999px;
  background: transparent;
  color: var(--mx-text-secondary);
  font: var(--mx-font-caption);
  cursor: pointer;
}

.segBtn[data-on='true'] {
  border-color: color-mix(in srgb, var(--mx-accent) 35%, transparent);
  background: color-mix(in srgb, var(--mx-accent) 14%, transparent);
  color: var(--mx-accent);
  font-weight: 600;
}

.derivedRow {
  display: flex;
  gap: var(--mx-space-2);
}

.derivedKind {
  flex: none;
  width: 88px;
}

.hint {
  margin: 0;
  font: var(--mx-font-body);
  color: var(--mx-text-secondary);
}

.error {
  margin: 0;
  font: var(--mx-font-caption);
  color: var(--mx-state-error);
  white-space: pre-wrap;
  word-break: break-all;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--mx-space-2);
}
</style>
