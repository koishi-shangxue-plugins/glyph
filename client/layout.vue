<script lang="ts" setup>
import { send, store } from '@koishijs/client'
import { computed, ref, watch } from 'vue'
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
const previewText = ref('字体预览 Font Preview 1234567890')
const uploadFile = ref<File | null>(null)
const uploadProgress = ref(0) // 上传进度 0-100
const isUploading = ref(false) // 是否正在上传
const uploadRef = ref() // el-upload 组件引用

// 动态注入字体样式
const fontStyleId = 'glyph-preview-font-style'

// 监听预览字体变化，动态注入样式
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
      }
    `
    document.head.appendChild(style)
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
        <div class="preview-text" :style="{
          fontFamily: previewFont.name,
          fontSize: '32px',
          lineHeight: '1.5'
        }">
          {{ previewText }}
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

.preview-text {
  padding: 20px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background-color: var(--el-fill-color-blank);
  min-height: 100px;
  word-break: break-all;
}

.mb-4 {
  margin-bottom: 16px;
}
</style>
