<script setup lang="ts">
/**
 * ChatInput —— 对话输入区（源：mindx-desktop ChatInput/index.vue 全量平移）。
 *
 * Tiptap 富文本输入（文字流内嵌 fileRef 引用 chip）：对外仍以纯字符串读写——
 * messageInput 镜像 editor.getText()（chip 序列化即其完整路径），发送/翻译/优化/
 * 语音等链路全部按纯文本工作，不感知富文本结构。
 *
 * work 适配（props 注入 + store 直连并存）：
 * - desktop 的 connectionStore / sessionStore 展示态依赖改 props 注入
 *   （connected / models / busy / placeholder），宿主层（ChatFlowPage
 *   四期 store 装配）供数——先例同 chatround/index.vue；
 * - ModelSelector（模型快速选择器）全量平移至 ./ModelSelector.vue：desktop 直连
 *   store 改 props 注入 + model-select 上抛（宿主执行 store.switchModel），
 *   fixture 回归通道（?fixture=nomodel / disabled）随 props 驱动保持可用；
 * - 发送上抛宿主（emit send），desktop 的会话懒创建（ensureSessionForSend）与
 *   chatStore.sendMessage 在宿主层——work 会话生命周期由 Tasks 驱动，无懒创建；
 * - 四期接线三处（desktop 直连 store 形状恢复，先例同 AskUserView）：
 *   ①图片落盘 fs.write_base64（addImageAttachment / handlePickImage → store.uploadImageToSessionTmp）；
 *   ②输入优化 optimize.rpc（optimizeInput → store.optimizeText）；
 *   ③停止执行（busy 分支 → store.stopProcessing）；
 * - desktop 的 pendingInputText / pendingAppendRef 外部填入 watch 依赖 chatStore
 *   可写字段，随回退/「添加到对话」入口经 defineExpose 消费（fillText / fillAndSend）。
 *
 * 文案：work 无 vue-i18n，全部中文字面量（desktop zh.json 逐条查证，先例同 UserMessageRow）。
 * 样式：全量 --mx-* 语义 token（军规 3），desktop token 按移植计划附录 A 映射。
 */
import { ref, computed, watchEffect, nextTick, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import NoModel from './NoModel.vue'
import ModelSelector from './ModelSelector.vue'
import ContextUsageGauge from './ContextUsageGauge.vue'
import WorkspacePicker from './WorkspacePicker.vue'
import { FileRef } from './fileRefNode'
import { useChatflowStore } from '../store'
import type { ModelInfo, ProviderInfo } from '../store'
import type { ContextUsageInfo } from '../tree/types/content'
import { isSupportedImageMime } from '../imageUtils'

const props = withDefaults(
  defineProps<{
    /** 连接可用（desktop connectionStore.isConnected；false 时输入框与全部按钮禁用） */
    connected?: boolean
    /** 模型全字段列表（空 = 未配置模型 → NoModel 整块替换；ModelSelector 分组数据源） */
    models?: ModelInfo[]
    /** 供应商原始配置（ModelSelector 已配置判定 api_key===true && base_url 与分组标题） */
    rawProviders?: ProviderInfo[]
    /** provider → title 映射（ModelSelector 分组标题显示名） */
    providerTitles?: Record<string, string>
    /** 当前生效模型裸名（服务端配置权威；ModelSelector 触发器显示态） */
    currentModelName?: string
    /** 当前生效模型 Provider（与裸名共同构成唯一身份，跨供应商同名可消歧） */
    currentModelProvider?: string
    /** 会话上下文用量（session.context RPC 投影；ContextUsageGauge 数据源，null 不渲染） */
    contextUsage?: ContextUsageInfo | null
    /** 忙碌（发送 ⇄ 停止；desktop chatStore.isBusy） */
    busy?: boolean
    /** 输入占位文案（desktop 取当前 Agent description；宿主注入，缺省通用文案） */
    placeholder?: string
    /** 工作区选择器开关（hero 新会话态 true；已进入会话 / NoModel 不渲染） */
    showWorkspace?: boolean
    /** 历史工作区（去重目录，最近使用保序；WorkspacePicker 列表数据源） */
    workspaces?: string[]
    /** 当前落点目录（空 = 未选择，chip 显示「选择工作区」） */
    currentDir?: string
  }>(),
  {
    connected: true,
    models: () => [],
    rawProviders: () => [],
    providerTitles: () => ({}),
    currentModelName: '',
    currentModelProvider: '',
    contextUsage: null,
    busy: false,
    placeholder: '',
    showWorkspace: false,
    workspaces: () => [],
    currentDir: ''
  }
)

const emit = defineEmits<{
  (e: 'send', payload: { text: string; images: Array<{ path: string; media_type: string }> }): void
  (e: 'model-select', model: ModelInfo): void
  (e: 'open-model-settings'): void
  (e: 'select-workspace', dir: string): void
  (e: 'add-workspace'): void
}>()

// 已连接但未配置任何模型 → 输入区整块替换为 NoModel（仅「打开模型设置」按钮）
const showNoModel = computed(() => props.connected && props.models.length === 0)

// ── 输入框 placeholder ──
const inputPlaceholder = computed(() => {
  if (isRecording.value) return '正在聆听，请开始说话'
  if (translateMode.value) return '输入要翻译的文本'
  if (!props.connected) return '请先连接到 MindX 服务'
  return props.placeholder || '发送消息...'
})

// ── 富文本输入（Tiptap）：文字流内嵌文件引用 chip ──
const messageInput = ref('')
const optimizeLoading = ref(false)
// 录音态（声明于下方 watchEffect 之前：该副作用首跑即读此标记）
const isRecording = ref(false)

const editor = useEditor({
  content: '',
  extensions: [
    // 仅保留段落 / Shift+Enter 换行 / 撤销历史，禁用标题、列表、加粗等块级与标记语法，
    // 保持聊天输入的纯文本语义
    StarterKit.configure({
      heading: false,
      bold: false,
      italic: false,
      strike: false,
      code: false,
      codeBlock: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      horizontalRule: false,
      gapcursor: false
    }),
    Placeholder.configure({ placeholder: () => inputPlaceholder.value }),
    FileRef
  ],
  editorProps: {
    attributes: { class: 'message-editor-inner' },
    handleKeyDown: (_view, event) => {
      // 录音期间锁定编辑
      if (isRecording.value) return true
      // Enter 发送（Shift/Ctrl/Cmd/Option 组合键 → 换行）
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        sendMessage()
        return true
      }
      return false
    },
    // 粘贴图片：拦截剪贴板中的 image/* 项，走图片附件流程
    handlePaste: (_view, event) => {
      const items = Array.from(event.clipboardData?.items || [])
      const imageItems = items.filter(
        (it) => it.kind === 'file' && isSupportedImageMime(it.type)
      )
      if (imageItems.length === 0) return false
      event.preventDefault()
      for (const item of imageItems) {
        const blob = item.getAsFile()
        if (blob) void addImageAttachment(blob, item.type)
      }
      return true
    }
  },
  onUpdate({ editor: ed }) {
    messageInput.value = ed.getText()
  }
})

// ── 图片附件（粘贴 / 工具栏上传）──
// path 为会话临时目录中的落盘绝对路径；previewUrl 供输入框上方缩略图使用。
const store = useChatflowStore()
interface ImageAttachment {
  path: string
  mediaType: string
  fileName: string
  previewUrl: string
}
const attachments = ref<ImageAttachment[]>([])
const uploadingImage = ref(false)
/** 本地文件选择器（web 形态替代 desktop 主进程 dialog） */
const imagePickerRef = ref<HTMLInputElement | null>(null)

/** Blob → 纯 base64（去掉 data: 前缀） */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const idx = result.indexOf(',')
      resolve(idx >= 0 ? result.substring(idx + 1) : result)
    }
    reader.onerror = () => reject(new Error('读取图片数据失败'))
    reader.readAsDataURL(blob)
  })
}

/** 单图上传主流程：blob → base64 → fs.write_base64 落盘 → 插入附件预览。
 * work 无 desktop 的会话懒创建前置（ensureSessionForSend，会话生命周期由 Tasks 驱动）：
 * 无活动会话目录时提示，不新建。串行守卫（uploadingImage）前置：粘贴多图时后续调用
 * 在首个 await 前即被拦截。 */
async function addImageAttachment(blob: Blob, mime: string): Promise<void> {
  if (uploadingImage.value) return
  uploadingImage.value = true
  try {
    const sessionDir = store.activeSession?.session_dir || ''
    if (!sessionDir) {
      ElMessage.warning('会话目录未知，无法保存图片')
      return
    }
    const base64 = await blobToBase64(blob)
    const uploaded = await store.uploadImageToSessionTmp(base64, mime, sessionDir)
    // 仅加入附件列表（输入框上方缩略图展示），编辑器内不插入任何内容
    attachments.value.push({
      ...uploaded,
      fileName: uploaded.path.split(/[\\/]/).pop() || uploaded.path,
      previewUrl: URL.createObjectURL(blob)
    })
  } catch (err) {
    console.error('[ChatInput] image upload failed:', err)
    ElMessage.error('图片上传失败，请稍后重试')
  } finally {
    uploadingImage.value = false
  }
}

/** 删除附件：移除预览，并同步删除会话临时目录中的落盘文件（fs.rm） */
async function removeAttachment(att: ImageAttachment): Promise<void> {
  attachments.value = attachments.value.filter((a) => a.path !== att.path)
  URL.revokeObjectURL(att.previewUrl)
  // 落盘文件同步删除：未发送即关闭 = 用户废弃该图，临时目录不留垃圾
  try {
    await store.removeFile(att.path)
  } catch (err) {
    console.error('[ChatInput] image tmp file delete failed:', err)
    ElMessage.warning('图片临时文件删除失败')
  }
}

/** 工具栏「插入图片」：本地文件选择 → 上传。
 * work 为 web 形态，desktop 主进程 dialog 通道改浏览器 input[type=file]。 */
function handlePickImage(): void {
  imagePickerRef.value?.click()
}

/** 文件选择回调：取首个选中图片走统一上传流程 */
async function handleImagePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await addImageAttachment(file, file.type)
  // 允许再次选择同一文件（input 同文件不重复触发 change）
  input.value = ''
}

/** 用纯文本整体替换编辑器内容（\n 分段；转义防注入） */
function setEditorText(text: string): void {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = esc.split('\n').map((line) => `<p>${line}</p>`).join('') || '<p></p>'
  editor.value?.commands.setContent(html)
  messageInput.value = text
}

/** 聚焦编辑器末尾 */
function focusEditorEnd(): void {
  editor.value?.chain().focus('end').run()
}

// 录音/优化输入期间锁定编辑（与原 readonly 行为对齐）；未连接时同样整体锁定
watchEffect(() => {
  editor.value?.setEditable(props.connected && !optimizeLoading.value && !isRecording.value)
})

// ── 翻译工具栏状态 ──
const translateMode = ref(false)
const translateTargetLang = ref('英文')
const LANG_OPTIONS = ['英文', '中文', '日文', '韩文', '法文', '德文', '西班牙文', '俄文', '阿拉伯文']

// ── 语音识别（按钮触发开始/停止；浏览器 SpeechRecognition API）──
const recognition = ref<any>(null)

function startSpeechRecognition() {
  const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SpeechRecognitionAPI) {
    ElMessage.warning('当前环境不支持语音输入')
    return
  }

  isRecording.value = true
  // 保留已有输入内容，录音转写结果追加到尾部
  const existingText = messageInput.value

  const sr = new SpeechRecognitionAPI()
  // work 纯中文界面（无 vue-i18n），语音区域固定 zh-CN
  sr.lang = 'zh-CN'
  sr.continuous = true
  sr.interimResults = true

  let finalTranscript = ''
  sr.onresult = (event: any) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i]
      if (r.isFinal) {
        finalTranscript += r[0].transcript
      }
    }
    // 仅在尾部插入转写文本，不清除已有内容
    setEditorText(existingText + finalTranscript)
  }

  sr.onerror = () => {
    isRecording.value = false
  }

  sr.onend = () => {
    isRecording.value = false
  }

  sr.start()
  recognition.value = sr
}

function stopSpeechRecognition() {
  if (recognition.value) {
    recognition.value.stop()
    recognition.value = null
  }
  isRecording.value = false
}

function toggleVoice() {
  if (isRecording.value) stopSpeechRecognition()
  else startSpeechRecognition()
}

// 卸载清理：录音中组件被卸载（hero↔消息流形态切换等）时停止识别，
// 否则 SR 回调持有组件闭包继续转写，向已销毁的编辑器写入（desktop 输入区
// 永不卸载故无此路径；work 形态切换可触发）
onBeforeUnmount(() => {
  if (isRecording.value) stopSpeechRecognition()
})

// ── 思考状态（发送按钮 ⇄ 停止按钮）──
const isBusy = computed(() => props.busy)

function handleSendOrStop() {
  if (isBusy.value) {
    // 停止执行（desktop chatStore.cancelProcessing → work store.stopProcessing）
    store.stopProcessing(store.activeSessionId || undefined)
    return
  }
  sendMessage()
}

// ── 优化输入 ──
async function optimizeInput() {
  const text = messageInput.value.trim()
  if (!text || text.length <= 5 || optimizeLoading.value) return

  optimizeLoading.value = true
  try {
    const optimized = await store.optimizeText(text)
    setEditorText(optimized)
  } catch (err) {
    console.error('[ChatInput] optimize failed:', err)
    ElMessage.error('输入优化失败，请稍后重试')
  } finally {
    optimizeLoading.value = false
  }
}

// ── 发送 ──
function sendMessage() {
  // 引用标签 + 输入文本合成出站消息；文本与图片附件皆空或忙碌时拦截
  const outgoing = composeOutgoingText()
  if ((!outgoing && attachments.value.length === 0) || props.busy) return

  // 附加图片：path + media_type 随出站载荷送达（打桩期 attachments 恒空 → images 恒 []）
  const images = attachments.value.map((a) => ({ path: a.path, media_type: a.mediaType }))

  // 翻译模式：包装用户输入为翻译指令
  let finalMessage = outgoing
  if (translateMode.value && outgoing) {
    finalMessage = `请将以下的文本翻译为${translateTargetLang.value}：${finalMessage}`
    translateMode.value = false
  }

  // work：发送上抛宿主（ChatFlowPage 打桩 / 四期 store），无 desktop 的
  // 会话懒创建前置（ensureSessionForSend 随四期数据层落位）
  emit('send', { text: finalMessage, images })

  // 清空图片附件（释放预览的 blob URL），并清空编辑器文本
  for (const att of attachments.value) URL.revokeObjectURL(att.previewUrl)
  attachments.value = []

  setEditorText('')
}

// ── 外部填入：仅填入并聚焦（如撤销回退的消息内容；四期经 defineExpose 消费）──
function fillText(text: string) {
  setEditorText(text)
  nextTick(() => {
    focusEditorEnd()
  })
}

// ── 外部填入：快捷提示词（填入并发送）──
function fillAndSend(text: string) {
  setEditorText(text)
  sendMessage()
}

/** 出站消息文本：编辑器纯文本序列化，fileRef chip 即其完整路径 */
function composeOutgoingText(): string {
  return editor.value?.getText().trim() ?? ''
}

defineExpose({ fillText, fillAndSend })
</script>

<template>
  <footer v-if="!showNoModel" class="chat-input-area">
    <!-- 工作区选择 chip（hero 新会话态；图 2 定稿形态：输入卡上方独立行，左对齐） -->
    <div v-if="showWorkspace" class="workspace-row">
      <WorkspacePicker
        :workspaces="workspaces"
        :current-dir="currentDir"
        @select="(d) => emit('select-workspace', d)"
        @add="emit('add-workspace')"
      />
    </div>
    <div class="input-container" :class="{ 'is-recording': isRecording }">
      <!-- 图片附件预览条（粘贴 / 工具栏上传的图片，发送前展示；打桩期不激活） -->
      <div v-if="attachments.length > 0" class="attachment-bar">
        <div v-for="att in attachments" :key="att.path" class="attachment-item">
          <img :src="att.previewUrl" :alt="att.fileName" class="attachment-thumb" />
          <el-tooltip content="取消" placement="top" effect="dark">
            <button type="button" class="attachment-remove" @click="removeAttachment(att)">
              ×
            </button>
          </el-tooltip>
        </div>
        <span v-if="uploadingImage" class="attachment-uploading">
          <MxIcon name="lucide:loader-circle" :size="16" class="optimize-spinner" />
          图片上传中...
        </span>
      </div>

      <!-- 第一行：富文本输入框（文字流内嵌文件引用 chip） -->
      <!-- show-file-icons：文件图标主题 CSS 全部 scoped 在该 class 下（.show-file-icons .file-icon::before），
           本输入区在工作台容器之外，需自带该作用域 chip 才能渲染主题图标 -->
      <div class="input-row input-row-1">
        <editor-content :editor="editor" class="message-input show-file-icons" />
        <div v-if="isRecording" class="recording-indicator">
          <span class="rec-dot"></span>
          <span class="rec-label">录音中...</span>
        </div>
      </div>

      <!-- 第二行：翻译模式 或 按钮组（模型 → 插图 → 优化 → 翻译 → 语音 → 发送/停止） -->
      <div class="input-row-toolbar" v-if="translateMode">
        <el-tag closable size="small" type="info" class="translate-tag" @close="translateMode = false">
          <MxIcon name="lucide:languages" :size="16" class="translate-tag-icon" />
          翻译
        </el-tag>
        <span class="translate-prefix">翻译为</span>
        <el-select
          v-model="translateTargetLang"
          size="small"
          class="translate-lang-select"
          popper-class="translate-popper"
        >
          <el-option v-for="lang in LANG_OPTIONS" :key="lang" :label="lang" :value="lang" />
        </el-select>
        <el-button size="small" text class="toolbar-cancel" @click="translateMode = false">取消</el-button>
      </div>

      <div class="input-row-toolbar" v-else>
        <div class="toolbar-actions">
          <!-- 上下文用量指示器（原 RoundFooter 最后一轮 ring 前移至此；无数据不渲染） -->
          <ContextUsageGauge v-if="connected && contextUsage" :context-usage="contextUsage" />
          <!-- 模型快速选择器（desktop ModelSelector 同构；select 上抛宿主执行切换） -->
          <ModelSelector
            v-if="connected"
            :models="models"
            :raw-providers="rawProviders"
            :provider-titles="providerTitles"
            :current-model-name="currentModelName"
            :current-model-provider="currentModelProvider"
            @select="(m) => emit('model-select', m)"
            @open-model-settings="emit('open-model-settings')"
          />
          <!-- 插入图片（本地文件选择后上传到会话临时目录 fs.write_base64） -->
          <el-tooltip v-if="!isRecording" content="插入图片" placement="top" effect="dark">
            <button class="tool-btn image-btn" :disabled="!connected" @click="handlePickImage">
              <MxIcon name="lucide:image" :size="16" />
            </button>
          </el-tooltip>
          <!-- 隐藏文件选择器：handlePickImage 触发（web 形态替代 desktop 主进程 dialog） -->
          <input
            ref="imagePickerRef"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            class="image-picker-input"
            @change="handleImagePicked"
          />
          <!-- 优化输入（>5 字才亮；optimize.rpc） -->
          <el-tooltip
            v-if="!isRecording && messageInput.length > 5 && !optimizeLoading"
            content="优化输入"
            placement="top"
            effect="dark"
          >
            <button class="tool-btn optimize-btn" :disabled="!connected" @click="optimizeInput">
              <MxIcon name="lucide:sparkles" :size="16" />
            </button>
          </el-tooltip>
          <button v-if="!isRecording && optimizeLoading" class="tool-btn optimize-btn optimizing" disabled>
            <MxIcon name="lucide:loader-circle" :size="16" class="optimize-spinner" />
          </button>

          <!-- 翻译输入（进入翻译模式，第二行切换为目标语言选择面板） -->
          <el-tooltip v-if="!isRecording" content="翻译" placement="top" effect="dark">
            <button class="tool-btn" :disabled="!connected" @click="translateMode = true">
              <MxIcon name="lucide:languages" :size="16" />
            </button>
          </el-tooltip>

          <!-- 语音输入（点击开始/停止录音） -->
          <el-tooltip
            :content="isRecording ? '录音中...' : '语音输入'"
            placement="top"
            effect="dark"
          >
            <button
              class="tool-btn voice-btn"
              :class="{ recording: isRecording }"
              :disabled="!connected"
              @click="toggleVoice"
            >
              <MxIcon v-if="!isRecording" name="lucide:mic" :size="16" />
              <MxIcon v-else name="lucide:square" :size="16" />
            </button>
          </el-tooltip>

          <!-- 发送 / 停止（思考状态时变停止按钮，并叠加处理中动画） -->
          <el-button
            circle
            class="send-btn"
            :class="{ processing: isBusy }"
            :type="isBusy ? 'danger' : 'primary'"
            :disabled="!connected || (!isBusy && !messageInput.trim() && attachments.length === 0)"
            @click="handleSendOrStop"
          >
            <MxIcon v-if="isBusy" name="lucide:loader-circle" :size="16" class="send-spinner" />
            <MxIcon v-else name="lucide:arrow-up" :size="16" />
          </el-button>
        </div>
      </div>
    </div>
  </footer>

  <!-- 未配置模型：整块替换输入区，仅提供「打开模型设置」 -->
  <NoModel v-if="showNoModel" @open-model-settings="emit('open-model-settings')" />
</template>

<style scoped>
.chat-input-area {
  padding: 0 var(--mx-space-4);
}

/* ── 工作区选择行（hero 态；chip 与输入卡左缘对齐，间距紧贴输入卡） ── */
.workspace-row {
  display: flex;
  align-items: center;
  padding: 0 var(--mx-space-1) var(--mx-space-2);
}

/* ── 工具栏行 ── */
.input-row-toolbar {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  padding: 0 var(--mx-space-3);
  min-height: 28px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  margin-left: auto;
}

.translate-tag {
  flex-shrink: 0;
}

.translate-tag-icon {
  margin-right: var(--mx-space-1);
  vertical-align: middle;
}

.translate-prefix {
  font: var(--mx-font-caption);
  color: var(--mx-text-secondary);
  white-space: nowrap;
}

.translate-lang-select {
  width: 110px;
}

.toolbar-cancel {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
  margin-left: auto;
}

.input-container {
  max-width: 920px;
  /* 顶部留白：与消息流拉开间距，避免对话流贴到输入区 */
  margin: var(--mx-space-4) auto var(--mx-space-6);
  display: flex;
  flex-direction: column;
  gap: var(--mx-space-3);
  background: color-mix(in srgb, var(--mx-bg-window) 98%, transparent);
  backdrop-filter: blur(20px);
  border: 1px solid color-mix(in srgb, var(--mx-separator) 60%, transparent);
  border-radius: var(--mx-radius-card);
  padding: var(--mx-space-3);
  transition: border-color 0.25s ease, box-shadow 0.25s ease;
}

.input-container:focus-within {
  border-color: var(--mx-accent);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--mx-accent) 15%, transparent),
    0 4px 20px color-mix(in srgb, var(--mx-accent) 10%, transparent);
}

/* ── 图片附件预览条（输入框上方） ── */
.attachment-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--mx-space-2);
  padding: 0 var(--mx-space-3);
}

.attachment-item {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: var(--mx-radius-control);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--mx-separator) 60%, transparent);
}

.attachment-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.attachment-remove {
  position: absolute;
  top: 0;
  right: 0;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 0 0 0 var(--mx-radius-control);
  background: color-mix(in srgb, var(--mx-tooltip-bg) 70%, transparent);
  color: var(--mx-static-white);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.attachment-remove:hover {
  background: color-mix(in srgb, var(--mx-danger) 85%, transparent);
}

.attachment-uploading {
  display: inline-flex;
  align-items: center;
  gap: var(--mx-space-1);
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.input-row-1 {
  display: flex;
  align-items: flex-end;
  gap: var(--mx-space-3);
  padding: 0 var(--mx-space-3);
}

.message-input {
  flex: 1;
  min-width: 0;
}

/* Tiptap 编辑区：对齐原 textarea 的观感（透明底、无框、自动高度）。
   高度即原 textarea 的自动伸缩逻辑：ProseMirror 高度随内容增长，
   min-height 定空态/起步高度（3 行，附录 A.2：--font-md 就近 --mx-font-body 14px，
   按字号×行高计算），超过 max-height 后开启滚动 */
.message-input :deep(.message-editor-inner) {
  background-color: transparent;
  color: var(--mx-text);
  font: var(--mx-font-body);
  padding: 0;
  min-height: calc(14px * 1.6 * 3);
  max-height: 240px;
  overflow-y: auto;
  outline: none;
  white-space: pre-wrap;
  word-break: break-word;
  cursor: text;
}

.message-input :deep(.message-editor-inner p) {
  margin: 0;
}

/* 空态占位符（Placeholder 扩展在空段落上注入 data-placeholder）；
   用半透明前景色，明显淡于正文 */
.message-input :deep(.message-editor-inner p.is-editor-empty:first-child)::before {
  content: attr(data-placeholder);
  color: color-mix(in srgb, var(--mx-text) 40%, transparent);
  pointer-events: none;
  float: left;
  height: 0;
}

/* 文件引用 chip：原子节点，整体选中/删除，悬浮显示完整路径（title）。
   取色中性（军规 14：同屏单 Primary），选中态用前景加深表达 */
.message-input :deep([data-type='file-ref']) {
  display: inline-block;
  max-width: 260px;
  padding: 0 var(--mx-space-2);
  margin: 0 2px;
  border-radius: var(--mx-radius-control);
  border: 1px solid color-mix(in srgb, var(--mx-separator) 90%, transparent);
  background: color-mix(in srgb, var(--mx-text) 6%, transparent);
  color: var(--mx-text);
  font: var(--mx-font-caption);
  line-height: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
  cursor: default;
}

.message-input :deep([data-type='file-ref'].ProseMirror-selectednode) {
  border-color: color-mix(in srgb, var(--mx-text) 35%, transparent);
  background: color-mix(in srgb, var(--mx-text) 12%, transparent);
}

/* 引用 chip 内的主题图标：class（file-icon/ext-file-icon 等）由 getIconClasses 计算，
   实际图形由文件图标主题 CSS 注入的 ::before 渲染；此处只负责尺寸与对齐。
   SVG 图标主题走 background-image（16px 居中），字体图标主题（Seti）走 font content */
.message-input :deep(.file-ref-icon) {
  display: inline-block;
  width: 16px;
  height: 16px;
  margin-right: 3px;
  vertical-align: -4px;
  background-repeat: no-repeat;
  background-position: center center;
  background-size: 16px auto;
  text-align: center;
}

/* ── 录音指示器 ── */
.recording-indicator {
  display: flex;
  align-items: center;
  gap: var(--mx-space-2);
  flex-shrink: 0;
  padding: var(--mx-space-1) var(--mx-space-3);
  background: color-mix(in srgb, var(--mx-danger) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--mx-danger) 25%, transparent);
  border-radius: var(--mx-radius-control);
  animation: rec-pulse-border 1.5s ease-in-out infinite;
}

.rec-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--mx-danger);
  animation: rec-pulse-dot 1s ease-in-out infinite;
}

.rec-label {
  font: var(--mx-font-caption);
  font-weight: 600;
  color: var(--mx-danger);
  white-space: nowrap;
}

@keyframes rec-pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
}

@keyframes rec-pulse-border {
  0%, 100% { border-color: color-mix(in srgb, var(--mx-danger) 25%, transparent); }
  50% { border-color: color-mix(in srgb, var(--mx-danger) 55%, transparent); }
}

.input-container.is-recording {
  border-color: color-mix(in srgb, var(--mx-danger) 40%, transparent) !important;
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--mx-danger) 10%, transparent),
    0 4px 20px color-mix(in srgb, var(--mx-danger) 8%, transparent) !important;
}

/* ── 按钮组 ── */
/* 隐藏文件选择器（handlePickImage 程序触发，不参与视觉布局） */
.image-picker-input {
  display: none;
}

.tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid color-mix(in srgb, var(--mx-separator) 50%, transparent);
  border-radius: var(--mx-radius-control);
  background: color-mix(in srgb, var(--mx-bg-window) 80%, transparent);
  color: var(--mx-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.tool-btn:hover {
  background: color-mix(in srgb, var(--mx-text) 6%, transparent);
  border-color: color-mix(in srgb, var(--mx-text) 25%, transparent);
  color: var(--mx-text);
}

.tool-btn:active {
  transform: scale(0.92);
}

/* 未连接（全禁用）：工具按钮置灰，去除 hover 高亮，明确不可交互 */
.tool-btn:disabled,
.tool-btn:disabled:hover {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
  background: transparent;
  border-color: color-mix(in srgb, var(--mx-separator) 40%, transparent);
  color: var(--mx-text-tertiary);
}

.optimize-btn {
  color: var(--mx-warning);
}

.optimize-btn:hover {
  background: color-mix(in srgb, var(--mx-warning) 12%, transparent);
  border-color: color-mix(in srgb, var(--mx-warning) 40%, transparent);
  color: var(--mx-warning);
  box-shadow: 0 0 12px color-mix(in srgb, var(--mx-warning) 15%, transparent);
}

.optimize-btn.optimizing {
  cursor: not-allowed;
  opacity: 0.6;
}

.optimize-spinner {
  animation: optimize-rotate 1s linear infinite;
}

@keyframes optimize-rotate {
  to { transform: rotate(360deg); }
}

.voice-btn.recording {
  background: color-mix(in srgb, var(--mx-danger) 15%, transparent);
  border-color: color-mix(in srgb, var(--mx-danger) 45%, transparent);
  color: var(--mx-danger);
  animation: rec-pulse-border 1.5s ease-in-out infinite;
}

.send-btn {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
}

/* 处理中：发送/暂停按钮上的旋转动画（仅在发送/处理中显示） */
.send-btn.processing {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mx-danger) 18%, transparent);
}

.send-spinner {
  animation: send-rotate 1s linear infinite;
}

@keyframes send-rotate {
  to { transform: rotate(360deg); }
}
</style>

<style>
/* ── Translate 语言选择下拉 ── */
.translate-popper {
  background: var(--mx-bg-elevated) !important;
  border: 1px solid color-mix(in srgb, var(--mx-separator) 60%, transparent) !important;
}
</style>
