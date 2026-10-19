<script setup lang="ts">
/**
 * 经验页（整页主体）：Agent 经验库阅读视图（会员全量库视角，与官网只看精选分流）。
 * 数据源走 daemon 服务 market.experience.*（daemon 携带登录态代理，前端不持 token）。
 * 未登录时显示引导文案（指向「资源社区」页登录），不复制登录流程。
 * 样式纪律（uikit）：控件走壳原语（mx-btn/mx-input），取色/字阶/间距全部语义 token。
 */
import { onMounted, ref } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useService } from '@mindx-work/ui-shell-vue'

// 服务以纯字符串名消费（插件间禁止 import；契约 §10.2）
const DAEMON_CONNECTION = 'daemon.connection'

/** daemon 连接服务结构契约（消费侧仅声明所需形状） */
interface DaemonConnection {
  call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
}

/** 经验条目（服务端清单字段；详情另行拉全文） */
interface ExperienceItem {
  id: number
  title: string
  summary?: string
  skill_name: string
  author_name?: string
  author_avatar?: string
  created_at?: string
}

const daemon = useService<DaemonConnection>(DAEMON_CONNECTION)

const items = ref<ExperienceItem[] | null>(null)
const loading = ref(false)
const notLoggedIn = ref(false)
const errMsg = ref('')
const keyword = ref('')
/** 当前打开的详情（null = 列表视图） */
const detail = ref<{ item: ExperienceItem; html: string } | null>(null)
const detailLoading = ref(false)

// ── 回路切换（M8 内容自由原则：经验阅读也是回路选项）──
/** 我所在组织（与货架同源 daemon RPC market.org.list；插件间禁 import，自取一份） */
interface OrgItem {
  slug: string
  name: string
  status: 'active' | 'frozen'
}
const myOrgs = ref<OrgItem[]>([])
/** 空串 = 公共经验库；非空 = 该组织的经验（仅组织成员可见） */
const activeOrgSlug = ref('')

/** 拉取所在组织清单（未登录/服务不可用静默为空——下拉不出现，不打扰公共阅读） */
async function loadMyOrgs() {
  try {
    const res = await daemon.call<{ orgs?: OrgItem[] }>('market.org.list', {})
    myOrgs.value = (res.orgs ?? []).filter((o) => o.status !== 'frozen')
  } catch {
    myOrgs.value = []
  }
}

/** 切换经验回路：清空详情回到列表，重拉当前回路 */
function switchOrg(event: Event) {
  activeOrgSlug.value = (event.target as HTMLSelectElement).value
  detail.value = null
  void load(keyword.value)
}

/** 未登录的引导文案（daemon 返回的错误原文即人话，直接透传） */
async function load(q = '') {
  loading.value = true
  errMsg.value = ''
  try {
    const res = await daemon.call<{ experiences: ExperienceItem[] }>(
      'market.experience.list',
      { q, ...(activeOrgSlug.value ? { org_slug: activeOrgSlug.value } : {}) },
    )
    items.value = res.experiences ?? []
    notLoggedIn.value = false
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('尚未登录')) {
      notLoggedIn.value = true
    } else {
      errMsg.value = msg || '经验列表暂时打不开，请稍后重试。'
    }
  } finally {
    loading.value = false
  }
}

/** 搜索（回车触发，不做输入防抖：列表查询走服务端 LIKE，量级可控） */
function onSearch() {
  void load(keyword.value)
}

/** 打开详情：拉全文，marked 转 HTML 后过 DOMPurify 消毒 */
async function openDetail(item: ExperienceItem) {
  detailLoading.value = true
  errMsg.value = ''
  try {
    const res = await daemon.call<{ experience: ExperienceItem & { markdown?: string } }>(
      'market.experience.get',
      { id: item.id, ...(activeOrgSlug.value ? { org_slug: activeOrgSlug.value } : {}) },
    )
    const raw = marked.parse(res.experience.markdown ?? '', { async: false }) as string
    detail.value = { item: res.experience, html: DOMPurify.sanitize(raw) }
  } catch (e) {
    errMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    detailLoading.value = false
  }
}

function backToList() {
  detail.value = null
}

onMounted(() => {
  void loadMyOrgs()
  void load()
})
</script>

<template>
  <div :class="$style.wrap">
    <!-- 详情视图 -->
    <template v-if="detail">
      <div :class="$style.toolbar">
        <button type="button" class="mx-btn" @click="backToList">← 返回列表</button>
        <span v-if="detailLoading" class="mx-text-loading">正在载入全文…</span>
      </div>
      <header :class="$style.detailHead">
        <h2 :class="$style.detailTitle">{{ detail.item.title }}</h2>
        <p :class="$style.meta">
          <img
            v-if="detail.item.author_avatar"
            :src="detail.item.author_avatar"
            alt=""
            :class="$style.avatar"
          />
          <span>{{ detail.item.author_name }}</span>
          <span v-if="detail.item.created_at"> · {{ detail.item.created_at.slice(0, 10) }}</span>
          <span v-if="detail.item.skill_name"> · 挂靠技能 {{ detail.item.skill_name }}</span>
        </p>
      </header>
      <div :class="$style.body" v-html="detail.html"></div>
    </template>

    <!-- 列表视图 -->
    <template v-else>
      <div :class="$style.searchRow">
        <!-- 经验回路切换（M8）：我所在组织非空才显示；冻结组织不进清单 -->
        <select
          v-if="myOrgs.length > 0"
          class="mx-input"
          :class="$style.orgSelect"
          :value="activeOrgSlug"
          @change="switchOrg"
        >
          <option value="">公共经验库</option>
          <option v-for="o in myOrgs" :key="o.slug" :value="o.slug">{{ o.name }}</option>
        </select>
        <input
          v-model="keyword"
          type="text"
          class="mx-input"
          :class="$style.searchInput"
          placeholder="搜索经验：标题或摘要里的关键词"
          @keydown.enter="onSearch"
        />
        <button type="button" class="mx-btn" :disabled="loading" @click="onSearch">搜索</button>
      </div>

      <p v-if="loading"><span class="mx-text-loading">正在载入经验列表…</span></p>

      <p v-else-if="notLoggedIn" :class="$style.hint">
        经验库只对已登录的用户开放。请先到「资源社区」页登录账号，再回来看大家的经验。
      </p>

      <p v-else-if="errMsg" :class="$style.hint">{{ errMsg }}</p>

      <template v-else-if="items">
        <p v-if="items.length === 0" :class="$style.hint">
          还没有可以阅读的经验。让本机的 MindX 完成技能升华后，它可以代你把经验分享到这里。
        </p>
        <ul v-else :class="$style.list">
          <li v-for="e in items" :key="e.id">
            <button type="button" :class="$style.entry" @click="openDetail(e)">
              <img
                v-if="e.author_avatar"
                :src="e.author_avatar"
                alt=""
                :class="$style.avatar"
              />
              <div :class="$style.entryMain">
                <p :class="$style.entryTitle">{{ e.title }}</p>
                <p v-if="e.summary" :class="$style.entrySummary">{{ e.summary }}</p>
                <p :class="$style.meta">
                  <span>{{ e.author_name }}</span>
                  <span v-if="e.created_at"> · {{ e.created_at.slice(0, 10) }}</span>
                  <span v-if="e.skill_name"> · 挂靠技能 {{ e.skill_name }}</span>
                </p>
              </div>
            </button>
          </li>
        </ul>
      </template>
    </template>
  </div>
</template>

<style module>
.wrap {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-4);
  padding: var(--mx-space-4) 0;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
}

.searchRow {
  display: flex;
  gap: var(--mx-space-2);
  align-items: center;
}

/* 经验回路切换（M8）：宽度自适应，不与搜索框抢空间 */
.orgSelect {
  flex: none;
  max-width: 180px;
}

.searchInput {
  flex: 1;
}

.list {
  display: flex;
  flex-direction: column;
  list-style: none;
  margin: 0;
  padding: 0;
}

.list > li + li {
  border-top: 0.5px solid var(--mx-separator);
}

.entry {
  display: flex;
  gap: var(--mx-space-3);
  width: 100%;
  padding: var(--mx-space-3) var(--mx-space-1);
  text-align: left;
  background: none;
  border: none;
  border-radius: var(--mx-radius-control);
  cursor: pointer;
}

.entry:hover {
  background: var(--mx-hover);
}

.entry:active {
  background: var(--mx-active);
}

.entry:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--mx-accent) 60%, transparent);
  outline-offset: 1px;
}

.entry:disabled {
  opacity: 0.4;
  cursor: default;
}

.entryMain {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.entryTitle {
  font: var(--mx-font-heading);
  color: var(--mx-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entrySummary {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.detailHead {
  margin-top: var(--mx-space-1);
}

.detailTitle {
  font: var(--mx-font-title);
  color: var(--mx-text);
  margin: 0;
}

.body {
  font: var(--mx-font-body);
  color: var(--mx-text);
  overflow-wrap: break-word;
}

.hint {
  font: var(--mx-font-body);
  color: var(--mx-text-tertiary);
}
</style>
