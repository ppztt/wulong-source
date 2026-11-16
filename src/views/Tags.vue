<template>
  <div class="tags-page">
    <div class="page-header">
      <span class="back-btn" @click="$router.back()">← 返回</span>
      <span>标签管理</span>
    </div>

    <div v-if="tags.length === 0" class="empty-state">
      <div class="emoji">🏷️</div>
      <div class="text">还没有标签，在下方添加</div>
    </div>

    <div v-for="tag in tags" :key="tag.id" class="list-item">
      <div class="icon" style="background: var(--primary-light);">🏷️</div>
      <div class="info">
        <div class="title">{{ tag.name }}</div>
      </div>
      <span class="del-btn" @click="askDelete(tag)">删除</span>
    </div>

    <!-- 底部新增 -->
    <div class="add-bar">
      <input
        class="form-input"
        v-model="newName"
        placeholder="输入新标签名称"
        @keyup.enter="addTag"
      />
      <button class="btn btn-primary" @click="addTag">添加</button>
    </div>

    <!-- 删除确认 -->
    <div v-if="pendingDelete" class="confirm-dialog" @click.self="pendingDelete = null">
      <div class="confirm-box">
        <div class="msg">删除标签「{{ pendingDelete.name }}」吗？<br/>已有账单上的该标签会一并移除</div>
        <div class="actions">
          <button class="btn btn-outline" @click="pendingDelete = null">取消</button>
          <button class="btn btn-danger" @click="doDelete">删除</button>
        </div>
      </div>
    </div>

    <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getTags, createTag, deleteTag } from '../db'

const tags = ref([])
const newName = ref('')
const pendingDelete = ref(null)
const toastMsg = ref('')

function showToast(msg) {
  toastMsg.value = msg
  setTimeout(() => { toastMsg.value = '' }, 2000)
}

async function loadTags() {
  tags.value = await getTags()
}

async function addTag() {
  const name = newName.value.trim()
  if (!name) {
    showToast('请输入标签名称')
    return
  }
  if (tags.value.some(t => t.name === name)) {
    showToast('标签已存在')
    return
  }
  try {
    await createTag({ name })
    newName.value = ''
    await loadTags()
    showToast('添加成功')
  } catch (e) {
    showToast('添加失败: ' + e.message)
  }
}

function askDelete(tag) {
  pendingDelete.value = tag
}

async function doDelete() {
  try {
    await deleteTag(pendingDelete.value.id)
    pendingDelete.value = null
    await loadTags()
    showToast('已删除')
  } catch (e) {
    showToast('删除失败: ' + e.message)
  }
}

onMounted(loadTags)
</script>

<style scoped>
.tags-page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  padding-bottom: calc(76px + env(safe-area-inset-bottom, 0px));
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.back-btn {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 14px;
  font-weight: 400;
  cursor: pointer;
  padding: 4px 8px;
}
.del-btn {
  font-size: 13px;
  color: var(--danger);
  padding: 6px 10px;
  cursor: pointer;
  flex-shrink: 0;
}
.add-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  gap: 8px;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px));
  background: var(--card);
  border-top: 1px solid var(--border);
  z-index: 20;
}
.add-bar .form-input {
  flex: 1;
  padding: 10px 12px;
}
.add-bar .btn {
  flex-shrink: 0;
  padding: 10px 20px;
}
</style>
