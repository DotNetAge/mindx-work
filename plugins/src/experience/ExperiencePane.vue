<script setup lang="ts">
/**
 * 经验页（整页主体）：Agent 经验库阅读视图（会员全量库视角，与官网只看精选分流）。
 * 数据源走 daemon 服务 market.experience.*（daemon 携带登录态代理，前端不持 token）。
 * 未登录时显示引导文案（指向「资源社区」页登录），不复制登录流程。
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

/** 未登录的引导文案（daemon 返回的错误原文即人话，直接透传） */
async function load(q = '') {
  loading.value = true
  errMsg.value = ''
  try {
    const res = await daemon.call<{ experiences: ExperienceItem[] }>(
      'market.experience.list',
      { q },
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
      { id: item.id },
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

onMounted(() => void load())
</script>

<template>
  <div :class="$style.wrap">
    <!-- 详情视图 -->
    <template v-if="detail">
      <button :class="$style.back" class="mx-text-btn" @click="backToList">← 返回列表</button>
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
        <input
          v-model="keyword"
          :class="$style.searchInput"
          placeholder="搜索经验：标题或摘要里的关键词"
          @keydown.enter="onSearch"
        />
        <button class="mx-text-btn" :disabled="loading" @click="onSearch">搜索</button>
      </div>

      <p v-if="loading" class="mx-text-loading">正在载入经验列表…</p>

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
            <button :class="$style.entry" @click="openDetail(e)">
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
  gap: 16px;
  padding: var(--mx-space-4) 0;
}

.searchRow {
  display: flex;
  gap: 8px;
  align-items: center;
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
  border-top: 1px solid var(--mx-color-border, rgba(128, 128, 128, 0.2));
}

.entry {
  display: flex;
  gap: 12px;
  width: 100%;
  padding: 12px 4px;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
}

.entry:hover .entryTitle {
  color: var(--mx-color-accent, var(--mx-color-primary, #4b8bbe));
}

.entryMain {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.entryTitle {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entrySummary {
  font-size: 12px;
  color: var(--mx-color-text-muted, #888);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--mx-color-text-muted, #888);
}

.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.detailHead {
  margin-top: 4px;
}

.detailTitle {
  font-size: 20px;
  margin: 0;
}

.body {
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: break-word;
}

.hint {
  color: var(--mx-color-text-muted, #888);
}
</style>
