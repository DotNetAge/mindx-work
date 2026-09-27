<script setup lang="ts">
// UserMessageRow —— 轮头用户消息行（源：mindx-desktop ChatRound/UserMessageRow.vue）。
// 左侧品牌导轨 + 淡底正文 + hover 显现操作组（回退/回收/复制）。
// work 无 vue-i18n：文案改查证中文字面量；图片加载四期已接线——消息内 base64_data
// 直出，path 引用走 daemon fs.read_base64 RPC（store 层带缓存，同路径只读一次）。
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { MxIcon } from '@mindx-work/ui-shell-vue'
import type { ChatMessage } from '../model/message'
import { useChatflowStore } from '../store'
import FormattedContent from './FormattedContent.vue'

const props = defineProps<{
  message: ChatMessage
}>()

const emit = defineEmits<{
  (e: 'undo-round', messageId: number, restoreContent?: string): void
}>()

const store = useChatflowStore()

// ── 用户消息图片渲染 ──
// 消息内 base64_data 直出转 data URL；path 引用走 daemon fs.read_base64 RPC
//（store.loadImageAsDataUrl 带模块级缓存，实时消息与历史恢复同路径只读一次）。
const imageUrls = ref<Record<string, string>>({})
const brokenImagePaths = ref<Set<string>>(new Set())

function loadImageAsDataUrl(img: {
  base64_data?: string
  media_type?: string
  path?: string
}): Promise<string> {
  if (img.base64_data) {
    return Promise.resolve(`data:${img.media_type || 'image/png'};base64,${img.base64_data}`)
  }
  if (img.path) {
    return store.loadImageAsDataUrl(img.path)
  }
  return Promise.reject(new Error('图片缺少 base64 数据与路径引用'))
}

watch(
  () => props.message.images,
  (imgs) => {
    if (!imgs || imgs.length === 0) return
    for (const img of imgs) {
      const path = img.path
      if (!path || imageUrls.value[path] || brokenImagePaths.value.has(path)) continue
      loadImageAsDataUrl(img)
        .then((url) => {
          imageUrls.value = { ...imageUrls.value, [path]: url }
        })
        .catch(() => {
          // 加载失败（文件被清理等）：标记后显示占位，不再重试
          brokenImagePaths.value = new Set([...brokenImagePaths.value, path])
        })
    }
  },
  { immediate: true }
)

function canUndo(m: ChatMessage): boolean {
  const ts = m?.metadata?.backendTimestamp
  return typeof ts === 'number' && ts > 0
}

const isDeleting = ref(false)

// 回收本轮：restore=true 时先把用户消息回填到输入框（"回退"），restore=false 时直接删除（"删除"）
async function handleUndoRound(restore: boolean) {
  const ts = props.message?.metadata?.backendTimestamp
  if (isDeleting.value || typeof ts !== 'number' || ts <= 0) return
  isDeleting.value = true
  try {
    emit('undo-round', ts, restore ? (props.message?.content || '') : undefined)
  } catch (e) {
    console.error('undo round failed:', e)
  } finally {
    isDeleting.value = false
  }
}

// 复制用户消息内容到剪贴板
async function copyContent() {
  const content = props.message?.content || ''
  if (!content) return
  try {
    await navigator.clipboard.writeText(content)
    ElMessage.success('已复制')
  } catch (e) {
    ElMessage.error('复制失败')
  }
}

// 点击图片：浏览器原生大图预览（新窗口打开 data URL）
function previewImage(url: string): void {
  if (!url) return
  window.open(url, '_blank')
}
</script>

<template>
  <div class="user-message">
    <span class="user-indicator"></span>
    <div class="user-content">
      <div class="user-text">
        <!-- 附加图片（在文本上方展示） -->
        <div v-if="message.images && message.images.length > 0" class="user-images">
          <template v-for="img in message.images" :key="img.path || img.alt_text">
            <img
              v-if="img.path && imageUrls[img.path]"
              :src="imageUrls[img.path]"
              :alt="img.alt_text || '图片'"
              class="user-image-thumb"
              @click="previewImage(imageUrls[img.path] || '')"
            />
            <span v-else-if="img.path" class="user-image-broken">读取图片失败</span>
          </template>
        </div>
        <FormattedContent :content="message.content" />
      </div>
      <span class="user-actions">
        <el-popconfirm
          v-if="canUndo(message)"
          title="此操作会彻底删除本轮对话，包括所有相应的消息及中间过程，且不可恢复。确定要执行回收操作吗？"
          confirm-button-text="确认回退"
          cancel-button-text="取消"
          @confirm="handleUndoRound(true)"
          placement="left"
          :hide-after="0"
          popper-class="undo-round-popover"
        >
          <template #reference>
            <el-tooltip content="回收本轮对话（回填输入框）" placement="top">
              <button type="button" class="action-icon-btn danger" aria-label="回退">
                <MxIcon name="lucide:undo-2" :size="16" />
              </button>
            </el-tooltip>
          </template>
        </el-popconfirm>
        <el-popconfirm
          v-if="canUndo(message)"
          title="此操作会彻底删除本轮对话，包括所有相应的消息及中间过程，且不可恢复。确定要执行回收操作吗？"
          confirm-button-text="确认回收"
          cancel-button-text="取消"
          @confirm="handleUndoRound(false)"
          placement="left"
          :hide-after="0"
          popper-class="undo-round-popover"
        >
          <template #reference>
            <el-tooltip content="回收本轮对话" placement="top">
              <button type="button" class="action-icon-btn danger" aria-label="删除">
                <MxIcon name="lucide:trash-2" :size="16" />
              </button>
            </el-tooltip>
          </template>
        </el-popconfirm>
        <el-tooltip content="复制" placement="top">
          <button type="button" class="action-icon-btn" @click="copyContent" aria-label="复制">
            <MxIcon name="lucide:copy" :size="16" />
          </button>
        </el-tooltip>
      </span>
    </div>
  </div>
</template>

<style scoped>
/* ── 轮头用户消息 ── */
.user-message {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 0;
}

.user-indicator {
  width: 3px;
  min-height: 100%;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--mx-accent), color-mix(in srgb, var(--mx-accent) 60%, transparent));
  align-self: stretch;
  flex-shrink: 0;
}

.user-content {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--mx-space-2);
  font: var(--mx-font-body);
  line-height: 1.65;
  color: var(--mx-text);
  padding: var(--mx-space-3) var(--mx-space-4);
  background: linear-gradient(135deg, color-mix(in srgb, var(--mx-accent) 15%, transparent), color-mix(in srgb, var(--mx-accent) 8%, transparent));
  border-radius: 0 var(--mx-radius-card) var(--mx-radius-card) 0;
  margin: 0;
  word-wrap: break-word;
}

.user-text {
  flex: 1;
  min-width: 0;
}

/* ── 用户消息附加图片 ── */
.user-images {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mx-space-2);
  margin-bottom: var(--mx-space-2);
}

.user-image-thumb {
  max-width: 220px;
  max-height: 160px;
  border-radius: var(--mx-radius-control);
  border: 1px solid color-mix(in srgb, var(--mx-separator) 60%, transparent);
  object-fit: cover;
  cursor: zoom-in;
}

.user-image-broken {
  font: var(--mx-font-caption);
  color: var(--mx-text-tertiary);
}

.user-actions {
  display: flex;
  align-items: center;
  gap: var(--mx-space-1);
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.user-content:hover .user-actions {
  opacity: 1;
}

.action-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: var(--mx-radius-control);
  background: transparent;
  color: var(--mx-text-tertiary);
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}

.action-icon-btn:hover {
  color: var(--mx-text);
  background: var(--mx-hover);
}

.action-icon-btn.danger:hover {
  color: var(--mx-danger);
  background: color-mix(in srgb, var(--mx-danger) 10%, transparent);
}

:global(.undo-round-popover) {
  min-width: 200px;
}
</style>
