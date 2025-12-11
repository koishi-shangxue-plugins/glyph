<script lang="ts" setup>
import { send, store } from '@koishijs/client'
import { computed, ref, watch, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadFile } from 'element-plus'

// 字体信息接口
interface GlyphFont {
  name: string
  fileName: string
  format: string
  size: number
  path: string
  dataUrl?: string
}

const keyword = ref('')
const showUploadDialog = ref(false)
const showPreviewDialog = ref(false)
const previewFont = ref<GlyphFont | null>(null)
const previewText = ref('Koishi 跨平台、可扩展、高性能！3210+ 插件支持 QQ, Telegram, Discord 等主流平台。✨ Dev 2025')
const uploadFile = ref<File | null>(null)
const uploadProgress = ref(0) // 上传进度 0-100
const isUploading = ref(false) // 是否正在上传
const uploadRef = ref() // el-upload 组件引用
const previewCanvasRef = ref<HTMLCanvasElement>() // Canvas引用

// 动态注入字体样式
const fontStyleId = 'glyph-preview-font-style'

// 检测字体是否包含字符的函数
async function checkCharInFont(char: string, fontFamily: string): Promise<boolean> {
  // 空格总是返回true，不需要检测
  if (char === ' ') return true

  // 等待字体加载完成
  await document.fonts.load(`100px "${fontFamily}"`)

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  const fontSize = 100
  canvas.width = fontSize * 2
  canvas.height = fontSize * 2

  // 使用一个肯定不存在的字体作为参考
  ctx.font = `${fontSize}px "NonExistentFontXYZ123"`
  ctx.fillText(char, 0, fontSize)
  const referenceData = ctx.getImageData(0, 0, canvas.width, canvas.height).data

  // 清空画布
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // 使用目标字体绘制
  ctx.font = `${fontSize}px "${fontFamily}"`
  ctx.fillText(char, 0, fontSize)
  const fontData = ctx.getImageData(0, 0, canvas.width, canvas.height).data

  // 比较两次绘制的结果
  // 如果完全相同，说明都使用了fallback，即字体不包含该字符
  let isDifferent = false
  for (let i = 0; i < referenceData.length; i++) {
    if (referenceData[i] !== fontData[i]) {
      isDifferent = true
      break
    }
  }

  return isDifferent // 不同则说明字体包含该字符
}

// 渲染预览文本到Canvas
async function renderPreviewToCanvas() {
  if (!previewFont.value || !previewCanvasRef.value) return

  const font = previewFont.value // 保存引用避免null检查问题

  await nextTick()

  const canvas = previewCanvasRef.value
  if (!canvas) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // 等待字体加载完成
  await document.fonts.load(`32px "${font.name}"`)

  const text = previewText.value
  const fontSize = 32
  const lineHeight = fontSize * 1.5
  const padding = 20
  const maxWidth = 560 // 最大宽度，用于自动换行

  // 设置字体
  ctx.font = `${fontSize}px "${font.name}"`

  // 自动换行处理
  const lines: string[] = []
  const paragraphs = text.split('\n')

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('')
      continue
    }

    let currentLine = ''
    for (const char of paragraph) {
      const testLine = currentLine + char
      const metrics = ctx.measureText(testLine)

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine)
        currentLine = char
      } else {
        currentLine = testLine
      }
    }
    if (currentLine) {
      lines.push(currentLine)
    }
  }

  // 设置Canvas尺寸
  canvas.width = maxWidth + padding * 2
  canvas.height = lines.length * lineHeight + padding * 2

  // 重新设置字体（Canvas尺寸改变后会重置）
  ctx.font = `${fontSize}px "${font.name}"`
  ctx.textBaseline = 'top'

  // 绘制背景
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // 绘制文本
  ctx.fillStyle = '#000000'
  let y = padding

  for (const line of lines) {
    let x = padding
    // 逐字符绘制，检测每个字符
    for (const char of line) {
      // 跳过空格的渲染（但保留位置）
      if (char === ' ') {
        x += ctx.measureText(char).width
        continue
      }

      const hasChar = await checkCharInFont(char, font.name)
      if (hasChar) {
        // 字体包含该字符，正常绘制
        ctx.fillText(char, x, y)
      } else {
        // 字体不包含该字符，绘制方框
        const charWidth = ctx.measureText(char).width || fontSize * 0.6
        ctx.strokeStyle = '#000000'
        ctx.lineWidth = 2
        ctx.strokeRect(x + 2, y + 2, charWidth - 4, fontSize - 4)
      }
      x += ctx.measureText(char).width
    }
    y += lineHeight
  }
}

// 监听预览字体变化，动态注入样式并渲染Canvas
watch(previewFont, (font) => {
  // 移除旧的样式
  const oldStyle = document.getElementById(fontStyleId)
  if (oldStyle) {
    oldStyle.remove()
  }

  // 如果有新字体且有dataUrl，注入新样式
  if (font && font.dataUrl) {
    const style = document.createElement('style')
    style.id = fontStyleId
    style.textContent = `
      @font-face {
        font-family: '${font.name}';
        src: url('${font.dataUrl}');
        font-display: block;
      }
    `
    document.head.appendChild(style)

    // 延迟渲染，确保字体已注入
    setTimeout(() => {
      renderPreviewToCanvas()
    }, 100)
  }
})

// 监听预览文本变化，重新渲染Canvas
watch(previewText, () => {
  if (previewFont.value) {
    renderPreviewToCanvas()
  }
})

// 重置上传对话框
function resetUpload() {
  uploadFile.value = null
  uploadProgress.value = 0
  isUploading.value = false
  showUploadDialog.value = false
  // 清空 el-upload 组件的文件列表
  uploadRef.value?.clearFiles()
}

// 处理文件选择
function handleFileChange(file: UploadFile) {
  if (file.raw) {
    uploadFile.value = file.raw
  }
}

// 上传字体文件
async function uploadFont() {
  if (!uploadFile.value) {
    ElMessage.warning('请选择字体文件')
    return
  }

  try {
    isUploading.value = true
    uploadProgress.value = 0

    // 读取文件为base64
    const reader = new FileReader()

    // 监听读取进度
    reader.onprogress = (e) => {
      if (e.lengthComputable) {
        uploadProgress.value = Math.round((e.loaded / e.total) * 100)
      }
    }

    reader.onload = async (e) => {
      const base64Data = e.target?.result as string
      send('glyph/upload' as any, uploadFile.value!.name, base64Data)

      // 上传完成
      uploadProgress.value = 100
      ElMessage.success('字体上传成功')

      // 延迟关闭对话框，让用户看到100%的进度
      setTimeout(() => {
        resetUpload()
      }, 500)
    }

    reader.onerror = () => {
      isUploading.value = false
      uploadProgress.value = 0
      ElMessage.error('文件读取失败')
    }

    reader.readAsDataURL(uploadFile.value)
  } catch (err: unknown) {
    isUploading.value = false
    uploadProgress.value = 0
    const message = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('上传失败: ' + message)
  }
}

// 删除字体（带二次确认）
async function deleteFont(fontName: string) {
  try {
    await ElMessageBox.confirm(
      `确定要删除字体 "${fontName}" 吗？<br><br>此操作不可恢复。`,
      '删除确认',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning',
        dangerouslyUseHTMLString: true,
      }
    )

    send('glyph/delete' as any, fontName)
    ElMessage.success('字体删除成功')
  } catch (err: unknown) {
    // 用户取消删除
    if (err === 'cancel') {
      return
    }
    const message = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('删除失败: ' + message)
  }
}

// 预览字体
function previewFontStyle(font: GlyphFont) {
  previewFont.value = font
  showPreviewDialog.value = true
}

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

// 过滤字体列表
const filteredFonts = computed(() => {
  const searchTerm = keyword.value.trim().toLowerCase()
  const fonts = ((store as any).glyph?.fonts as GlyphFont[]) || []

  if (!searchTerm) {
    return fonts
  }

  return fonts.filter((font: GlyphFont) => {
    return (
      font.name?.toLowerCase().includes(searchTerm) ||
      font.fileName?.toLowerCase().includes(searchTerm) ||
      font.format?.toLowerCase().includes(searchTerm)
    )
  })
})

</script>

<template>
  <div class="container">
    <!-- 搜索和上传按钮 -->
    <div class="my-4 px-4">
      <div class="flex items-center">
        <el-input class="flex-1" v-model="keyword" clearable placeholder="输入关键词搜索字体…" #suffix>
          <k-icon name="search" />
        </el-input>
        <el-button class="ml-4" type="primary" @click="showUploadDialog = true">
          <k-icon name="upload" />
          上传字体
        </el-button>
      </div>

      <!-- 上传进度条 -->
      <div v-if="isUploading" class="mt-3">
        <el-progress :percentage="uploadProgress" :status="uploadProgress === 100 ? 'success' : undefined" />
      </div>
    </div>

    <!-- 上传对话框 -->
    <el-dialog v-model="showUploadDialog" title="上传字体文件" width="500px">
      <el-upload ref="uploadRef" drag :auto-upload="false" :limit="1" accept=".ttf,.otf,.woff,.woff2,.ttc,.eot,.svg"
        :on-change="handleFileChange">
        <k-icon name="upload" style="font-size: 48px; margin-bottom: 16px;" />
        <div class="el-upload__text">
          将字体文件拖到此处，或<em>点击上传</em>
        </div>
        <template #tip>
          <div class="el-upload__tip">
            支持 .ttf, .otf, .woff, .woff2, .ttc, .eot, .svg 格式
          </div>
        </template>
      </el-upload>
      <template #footer>
        <el-button @click="resetUpload" :disabled="isUploading">取消</el-button>
        <el-button type="primary" @click="uploadFont" :disabled="!uploadFile || isUploading" :loading="isUploading">
          {{ isUploading ? '上传中' : '确定上传' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 字体预览对话框 -->
    <el-dialog v-model="showPreviewDialog" title="字体预览" width="600px">
      <div v-if="previewFont" class="preview-container">
        <div class="preview-info">
          <p><strong>字体名称：</strong>{{ previewFont.name }}</p>
          <p><strong>文件名：</strong>{{ previewFont.fileName }}</p>
          <p><strong>格式：</strong>{{ previewFont.format }}</p>
          <p><strong>大小：</strong>{{ formatSize(previewFont.size) }}</p>
        </div>
        <el-divider />
        <el-input v-model="previewText" type="textarea" :rows="2" placeholder="输入预览文本" class="mb-4" />
        <div class="preview-canvas-container">
          <canvas ref="previewCanvasRef" class="preview-canvas"></canvas>
        </div>
      </div>
    </el-dialog>

    <!-- 字体列表 -->
    <el-scrollbar class="fonts-list">
      <template v-if="filteredFonts.length === 0">
        <el-empty :description="keyword.trim() ? '未找到字体' : '暂无字体'" />
      </template>

      <el-table v-else :data="filteredFonts" class="fonts-table" border>
        <el-table-column label="字体名称" prop="name" min-width="150" />
        <el-table-column label="文件名" prop="fileName" min-width="180" />
        <el-table-column label="格式" prop="format" width="80" align="center" />
        <el-table-column label="大小" width="120" align="right">
          <template #default="{ row }">
            {{ formatSize(row.size) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" align="center">
          <template #default="{ row }">
            <el-button size="small" @click="previewFontStyle(row)" :disabled="!row.dataUrl || isUploading">
              <k-icon name="eye" />
              {{ isUploading ? '上传中' : '预览' }}
            </el-button>
            <el-button size="small" type="danger" plain @click="deleteFont(row.name)">
              <k-icon name="delete" />
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-scrollbar>
  </div>
</template>

<style lang="scss">
// 全局样式，不使用 scoped，确保能覆盖所有继承
.no-fallback {
  // 禁用所有字体合成和fallback机制
  font-synthesis: none !important;
  font-variant-ligatures: none !important;
  font-feature-settings: normal !important;

  // 强制所有子元素继承字体，不使用任何fallback
  * {
    font-family: inherit !important;
  }

  // 禁用浏览器的字体替换
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
</style>

<style lang="scss" scoped>
.container {
  max-width: 1000px;
  height: calc(100% - 30px);
  display: flex;
  margin-left: auto;
  margin-right: auto;
  flex-direction: column;
}

.fonts-list {
  width: 100%;
  flex-grow: 1;
  overflow: auto;
}

.fonts-table {
  width: 100%;
}

.preview-container {
  padding: 16px;
}

.preview-info {
  p {
    margin: 8px 0;
    line-height: 1.6;
  }
}

.preview-canvas-container {
  padding: 20px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background-color: var(--el-fill-color-blank);
  min-height: 100px;
  overflow: auto;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.preview-canvas {
  display: block;
  max-width: 100%;
  height: auto;
}

.mb-4 {
  margin-bottom: 16px;
}
</style>
