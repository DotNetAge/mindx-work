<script setup lang="ts">
/**
 * AskUserView：AskUser 阻塞交互表单（吸底 Drawer 内渲染，desktop AskUserView.vue 平移）。
 *
 * 提交通路（desktop 同构）：
 * - 子代理提问冒泡（targetSessionId 非空）→ store.answerSubagentAsk：回答作为 user
 *   消息落入子会话流 + user.message 携带子会话 ID 发送，daemon 精确注入挂起子 exec；
 * - 主会话阻塞（targetSessionId 为空）→ store.sendMessage：回答落本地消息流，
 *   宿主阻塞扫描碰到 user 消息即判定已响应、Drawer 收起（直连发送不落库会卡死）。
 * 提交后 emit('submitted') 由宿主标记该阻塞请求已响应（立即收起不等回扫）。
 */
import { ref, computed, reactive } from 'vue'
import { useChatflowStore } from '../../store'
import { useMarkdown } from '../../markdown'

const store = useChatflowStore()
const { md } = useMarkdown()

function renderMd(text: string): string {
  if (!text) return ''
  return md.render(text)
}

/** 去除 Markdown 标记，保留纯文本用于预览 */
function stripMd(text: string): string {
  if (!text) return ''
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/>\s+/g, '')
    .replace(/[-*+]\s+/g, '')
    .replace(/\n{2,}/g, ' ')
}

const props = defineProps({
  formData: {
    type: Object as () => Record<string, any>,
    default: () => ({})
  },
  // 子代理提问冒泡：携带发起提问的子会话 ID 时，作答路由到该子会话
  // （answerSubagentAsk：user 消息落子会话流 + sendMessage 到子会话）；
  // 为空时走主会话通路（store.sendMessage）
  targetSessionId: {
    type: String,
    default: ''
  }
})

const emit = defineEmits<{ (e: 'submitted'): void }>()

const isExpanded = ref(true)

// 已提交状态：提交后立即禁用组件内全部输入控件并锁存，
// 给用户明确的「已发送」反馈，避免误以为点击无响应
const submitted = ref(false)

interface QuestionItem {
  index: number
  question: string
  options: string[]
  multiSelect: boolean
}

const questions = computed<QuestionItem[]>(() => {
  const raw = props.formData
  if (raw.questions && Array.isArray(raw.questions) && raw.questions.length > 0) {
    return raw.questions.map((q: any, i: number) => ({
      index: i,
      question: q.question || '',
      options: Array.isArray(q.options) ? q.options.filter((o: any) => typeof o === 'string') : [],
      multiSelect: !!q.multi_select
    }))
  }
  if (raw.question) {
    return [{
      index: 0,
      question: raw.question,
      options: Array.isArray(raw.options) ? raw.options.filter((o: any) => typeof o === 'string') : [],
      multiSelect: !!raw.multi_select
    }]
  }
  return []
})

const hasQuestions = computed(() => questions.value.length > 0)

const singleAnswers = reactive<Record<number, string>>({})
const multiAnswers = reactive<Record<number, Set<string>>>({})
const freeformInputs = reactive<Record<number, string>>({})

// "其它"选项状态
const otherSelected = reactive<Record<number, boolean>>({})
const otherInputs = reactive<Record<number, string>>({})

function isSingleSelected(qIdx: number, option: string): boolean {
  return singleAnswers[qIdx] === option
}

function selectSingle(qIdx: number, option: string) {
  if (submitted.value) return
  singleAnswers[qIdx] = option
  otherSelected[qIdx] = false
}

function selectOtherSingle(qIdx: number) {
  if (submitted.value) return
  singleAnswers[qIdx] = ''
  otherSelected[qIdx] = true
}

function toggleMulti(qIdx: number, option: string) {
  if (submitted.value) return
  if (!multiAnswers[qIdx]) {
    multiAnswers[qIdx] = new Set()
  }
  const s = multiAnswers[qIdx]
  if (s.has(option)) {
    s.delete(option)
  } else {
    s.add(option)
  }
  multiAnswers[qIdx] = new Set(s)
}

function toggleOtherMulti(qIdx: number) {
  if (submitted.value) return
  otherSelected[qIdx] = !otherSelected[qIdx]
}

function isMultiSelected(qIdx: number, option: string): boolean {
  return multiAnswers[qIdx]?.has(option) ?? false
}

function hasAnyAnswer(): boolean {
  for (const q of questions.value) {
    if (q.options.length > 0) {
      if (q.multiSelect) {
        if ((multiAnswers[q.index]?.size ?? 0) > 0) return true
        if (otherSelected[q.index] && otherInputs[q.index]?.trim()) return true
      } else {
        if (singleAnswers[q.index]) return true
        if (otherSelected[q.index] && otherInputs[q.index]?.trim()) return true
      }
    } else {
      if (freeformInputs[q.index]?.trim()) return true
    }
  }
  return false
}

/** 统一发送通路：锁存 + 按主/子会话路由 + 通知宿主收起（提交与跳过共用） */
function submitAnswer(answerText: string) {
  // 重复点击保护：提交后立即锁存状态并禁用全部输入控件
  if (submitted.value) return
  submitted.value = true

  // 子代理提问冒泡：作答写入子会话流（user 消息，宿主阻塞扫描据此判定已响应）
  // 并以 user.message 携带子会话 ID 发送，daemon dispatchAskAnswer 精确注入挂起子会话
  if (props.targetSessionId) {
    store.answerSubagentAsk(props.targetSessionId, answerText)
  } else {
    // 主会话通路：必须走 store.sendMessage（而非直连 websocket 客户端）：
    // 它会把回答作为 user 消息落入本地消息流，宿主阻塞扫描
    // 碰到 user 消息即判定「已响应」，抽屉才能立即收起；
    // 直连发送不落库，抽屉会卡死直到下一轮产出 markdown。
    store.sendMessage(answerText)
  }
  emit('submitted')
}

function handleSubmit() {
  // Build formatted answer text
  const answerParts: string[] = []
  const isMultiSelectAny = questions.value.some(q => q.options.length > 0 && q.multiSelect)

  if (isMultiSelectAny) {
    const selections: string[] = []
    for (const q of questions.value) {
      if (q.options.length > 0 && q.multiSelect) {
        const selected = multiAnswers[q.index]
        if (selected && selected.size > 0) {
          selections.push(...Array.from(selected))
        }
        // 多选"其它"：追加 "其它：<输入内容>"
        if (otherSelected[q.index] && otherInputs[q.index]?.trim()) {
          selections.push('其它：' + (otherInputs[q.index]?.trim() ?? ''))
        }
      } else if (q.options.length > 0) {
        const selected = singleAnswers[q.index]
        if (selected) selections.push(selected)
      }
    }
    if (selections.length > 0) {
      answerParts.push('以下是我的选择：' + selections.join('、'))
    }
  } else {
    for (const q of questions.value) {
      if (q.options.length > 0) {
        // 单选"其它"：直接使用输入内容作为答案
        if (otherSelected[q.index] && otherInputs[q.index]?.trim()) {
          answerParts.push(otherInputs[q.index]?.trim() ?? '')
        } else {
          const selected = singleAnswers[q.index]
          if (selected) answerParts.push(selected)
        }
      } else {
        const input = freeformInputs[q.index]?.trim()
        if (input) answerParts.push(input)
      }
    }
  }

  const answerText = answerParts.length > 0 ? answerParts.join('\n') : ''
  submitAnswer(answerText)
}

/**
 * 跳过提问：AskUser 协议没有「拒绝回答」动作——pending 状态下任何 user 消息
 * 都会结束提问并把内容作为回答交给 LLM。因此跳过 = 发送一条明确的放弃说明，
 * agent 收到后基于已有信息继续。整组提问一次跳过（协议按提问块生效，无法逐题）。
 */
const SKIP_ANSWER_TEXT = '（用户跳过了这组提问。请基于已有信息自行判断并继续；除非确有必要，请勿重复追问。）'

function skipQuestions() {
  submitAnswer(SKIP_ANSWER_TEXT)
}

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}
</script>

<template>
  <div class="ask-user-view" :class="{ submitted }" v-if="hasQuestions">
    <button type="button" class="au-header" @click="toggleExpand">
      <div class="au-header-left">
        <div class="au-icon">
          <MxIcon name="lucide:message-square" :size="16" />
        </div>
        <div class="au-title-section">
          <h4 class="au-title">需要澄清</h4>
          <p class="au-subtitle">
            {{ questions.length > 1
              ? `${questions.length} 个问题待回答`
              : stripMd(questions[0]?.question || '').slice(0, 60)
            }}{{ (questions[0]?.question?.length ?? 0) > 60 ? '...' : '' }}
          </p>
        </div>
      </div>
      <div class="au-header-right">
        <MxIcon
          name="lucide:chevron-down"
          :size="14"
          class="au-chevron"
          :class="{ rotated: isExpanded }"
        />
      </div>
    </button>

    <transition name="expand-au">
      <div class="au-body" v-show="isExpanded">
        <div
          v-for="(q, idx) in questions"
          :key="q.index"
          class="au-question-card"
        >
          <div class="au-question-header">
            <span class="au-q-number" v-if="questions.length > 1">{{ idx + 1 }}.</span>
            <div class="au-q-text markdown-body" v-html="renderMd(q.question)"></div>
            <span
              v-if="q.options.length > 0 && q.multiSelect"
              class="au-badge badge-multi"
            >可多选</span>
            <span
              v-else-if="q.options.length > 0"
              class="au-badge badge-single"
            >单选</span>
          </div>

          <div class="au-options" v-if="q.options.length > 0">
            <label
              v-for="option in q.options"
              :key="option"
              class="au-option"
              :class="{ checked: q.multiSelect ? isMultiSelected(q.index, option) : isSingleSelected(q.index, option) }"
              @click="q.multiSelect ? toggleMulti(q.index, option) : selectSingle(q.index, option)"
            >
              <el-checkbox
                v-if="q.multiSelect"
                :model-value="isMultiSelected(q.index, option)"
                size="small"
                :disabled="submitted"
              />
              <el-radio
                v-else
                :value="option"
                v-model="singleAnswers[q.index]"
                size="small"
                :disabled="submitted"
              />
              <span class="au-opt-label">{{ option }}</span>
            </label>

            <!-- "其它"选项 -->
            <label
              class="au-option"
              :class="{ checked: otherSelected[q.index] }"
              @click="q.multiSelect ? toggleOtherMulti(q.index) : selectOtherSingle(q.index)"
            >
              <span class="au-opt-indicator">
                <el-checkbox
                  v-if="q.multiSelect"
                  :model-value="otherSelected[q.index]"
                  size="small"
                  :disabled="submitted"
                />
                <el-radio
                  v-else
                  :value="'其它'"
                  :model-value="otherSelected[q.index] ? '其它' : singleAnswers[q.index]"
                  size="small"
                  :disabled="submitted"
                  @change="selectOtherSingle(q.index)"
                />
              </span>
              <span class="au-opt-label">其它</span>
            </label>
            <div v-if="otherSelected[q.index]" class="au-other-input-wrap">
              <el-input
                v-model="otherInputs[q.index]"
                placeholder="请输入..."
                size="small"
                :disabled="submitted"
              />
            </div>
          </div>

          <div class="au-input" v-else>
            <el-input
              v-model="freeformInputs[q.index]"
              type="textarea"
              :rows="2"
              placeholder="输入你的回答..."
              :disabled="submitted"
            />
          </div>
        </div>

        <div class="au-actions">
          <!-- 跳过：不回答也能结束提问（发放弃说明，agent 自行继续），
               防止面板锁死输入区导致会话卡死 -->
          <el-button
            class="au-skip-btn"
            :disabled="submitted"
            @click="skipQuestions"
          >
            {{ submitted ? '已处理' : '跳过此提问' }}
          </el-button>
          <el-button
            type="primary"
            :disabled="submitted || !hasAnyAnswer()"
            @click="handleSubmit"
          >
            <MxIcon v-if="!submitted" name="lucide:send" :size="14" />
            {{ submitted ? '已提交' : '提交回复' }}
          </el-button>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
/* token 映射（desktop → work，四期映射表留痕）：--bg-card→--mx-bg-elevated、
   --accent-cyan→--mx-accent、--text-primary→--mx-text、--text-secondary→--mx-text-secondary、
   --text-muted→--mx-text-tertiary、--border-color→--mx-separator、--radius-lg→--mx-radius-card、
   --radius-md→--mx-radius-control、--radius-sm→6px、--radius-xs→4px、--space-0→2px、
   --space-5→--mx-space-6 */
.ask-user-view {
  /* Drawer 激活显示时使用不透明背景，避免半透明导致下层消息文字视觉重叠 */
  background: var(--mx-bg-elevated);
  border: 1px solid color-mix(in srgb, var(--mx-accent) 30%, transparent);
  border-radius: var(--mx-radius-card);
  overflow: hidden;
}

/* 已提交：全部输入区禁止交互并视觉降级，明确反馈「回复已发送」 */
.ask-user-view.submitted .au-options,
.ask-user-view.submitted .au-input,
.ask-user-view.submitted .au-other-input-wrap {
  pointer-events: none;
  opacity: 0.55;
}

.au-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--mx-space-3) var(--mx-space-4);
  cursor: pointer;
  user-select: none;
  gap: var(--mx-space-3);
  background: transparent;
  border: none;
  font: inherit;
  color: inherit;
  text-align: left;
}
.au-header:hover {
  background: color-mix(in srgb, var(--mx-accent) 4%, transparent);
}
.au-header:active {
  background: color-mix(in srgb, var(--mx-accent) 8%, transparent);
}
.au-header:focus-visible {
  outline: 2px solid var(--mx-accent);
  outline-offset: -2px;
}

.au-header-left {
  display: flex;
  align-items: center;
  gap: var(--mx-space-3);
  flex: 1;
  min-width: 0;
}

.au-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: linear-gradient(135deg, var(--mx-accent), color-mix(in srgb, var(--mx-accent) 55%, black));
  color: var(--mx-text-on-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.au-title-section {
  min-width: 0;
}

.au-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--mx-text);
  letter-spacing: -0.2px;
  margin: 0 0 2px;
}

.au-subtitle {
  font-size: 12px;
  color: var(--mx-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
}

.au-header-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.au-chevron {
  color: var(--mx-text-tertiary);
  transition: transform 0.2s ease;
}
.au-chevron.rotated {
  transform: rotate(180deg);
}

.au-body {
  padding: 0 var(--mx-space-4) var(--mx-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
}

.au-question-card {
  padding: var(--mx-space-3);
  background: color-mix(in srgb, var(--mx-accent) 4%, transparent);
  border: 1px solid color-mix(in srgb, var(--mx-accent) 14%, transparent);
  border-radius: var(--mx-radius-control);
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
}

.au-question-header {
  display: flex;
  align-items: flex-start;
  gap: var(--mx-space-2);
  flex-wrap: wrap;
}

.au-q-number {
  font-size: 13px;
  font-weight: 700;
  color: var(--mx-accent);
  flex-shrink: 0;
}

.au-q-text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--mx-text);
  font-weight: 500;
  margin: 0;
  flex: 1;
  min-width: 0;
}
.au-q-text :deep(p) { margin: var(--mx-space-1) 0; }
.au-q-text :deep(strong) { color: var(--mx-text); font-weight: 600; }
.au-q-text :deep(code) {
  font-family: var(--mx-font-mono);
  font-size: 12px;
  background: color-mix(in srgb, var(--mx-accent) 10%, transparent);
  color: var(--mx-accent);
  padding: 2px var(--mx-space-2);
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--mx-accent) 15%, transparent);
}
.au-q-text :deep(a) { color: var(--mx-accent); text-decoration: none; }
.au-q-text :deep(a:hover) { text-decoration: underline; }
.au-q-text :deep(ul), .au-q-text :deep(ol) { padding-left: var(--mx-space-5); margin: var(--mx-space-1) 0; }
.au-q-text :deep(li) { margin: 2px 0; }
.au-q-text :deep(blockquote) {
  border-left: 3px solid var(--mx-accent);
  padding-left: var(--mx-space-3);
  margin: var(--mx-space-2) 0;
  color: var(--mx-text-tertiary);
  font-style: italic;
}

.au-badge {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  padding: 1px var(--mx-space-2);
  border-radius: 4px;
  flex-shrink: 0;
  margin-top: 2px;
}
.badge-multi {
  background: color-mix(in srgb, var(--mx-accent) 15%, transparent);
  color: color-mix(in srgb, var(--mx-accent) 70%, white);
  border: 1px solid color-mix(in srgb, var(--mx-accent) 30%, transparent);
}
.badge-single {
  background: color-mix(in srgb, var(--mx-accent) 12%, transparent);
  color: var(--mx-accent);
  border: 1px solid color-mix(in srgb, var(--mx-accent) 25%, transparent);
}

.au-options {
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-1);
}

.au-option {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: var(--mx-space-2) var(--mx-space-3);
  border-radius: 6px;
  border: 1px solid var(--mx-separator);
  cursor: pointer;
  transition: all 0.2s ease;
  margin: 0;
}
.au-option:hover {
  border-color: var(--mx-accent);
  background: color-mix(in srgb, var(--mx-accent) 6%, transparent);
}
.au-option:active {
  background: color-mix(in srgb, var(--mx-accent) 10%, transparent);
}
.au-option:has(input:focus-visible) {
  outline: 2px solid var(--mx-accent);
  outline-offset: 2px;
}
.au-option.checked {
  border-color: var(--mx-accent);
  background: color-mix(in srgb, var(--mx-accent) 10%, transparent);
}

.au-opt-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--mx-text);
  line-height: 1.4;
  flex: 1;
}

.au-other-input-wrap {
  padding: var(--mx-space-1) var(--mx-space-3) var(--mx-space-2);
}

.au-input {
  padding: 0;
}

.au-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* 跳过按钮：次级弱化（tertiary 文字色），与主提交按钮拉开视觉层级 */
.au-skip-btn {
  color: var(--mx-text-tertiary);
}
.au-skip-btn:hover {
  color: var(--mx-text-secondary);
}

.expand-au-enter-active,
.expand-au-leave-active {
  transition: all 0.25s ease;
  overflow: hidden;
}
.expand-au-enter-from,
.expand-au-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}
</style>
