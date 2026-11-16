<template>
  <div class="categories-page">
    <div class="page-header">
      <span class="back-btn" @click="$router.back()">← 返回</span>
      <span>分类管理</span>
    </div>

    <!-- 类型切换 -->
    <div class="type-toggle">
      <div class="item" :class="{ 'active-expense': activeType === 'expense' }" @click="activeType = 'expense'">支出分类</div>
      <div class="item" :class="{ 'active-income': activeType === 'income' }" @click="activeType = 'income'">收入分类</div>
    </div>

    <!-- 分类列表 -->
    <div v-if="filteredCategories.length === 0" class="empty-state">
      <div class="emoji">📂</div>
      <div class="text">暂无分类，点击右下角添加</div>
    </div>

    <div v-for="cat in filteredCategories" :key="cat.id" class="list-item" @click="openEdit(cat)">
      <div class="icon" style="background: var(--primary-light);">{{ cat.icon }}</div>
      <div class="info">
        <div class="title">{{ cat.name }}</div>
      </div>
    </div>

    <button class="fab" @click="openAdd">+</button>

    <!-- 添加/编辑弹窗 -->
    <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
      <div class="modal-content">
        <div class="modal-title">{{ editingId ? '编辑分类' : '新建分类' }}</div>

        <div class="form-group">
          <label class="form-label">名称</label>
          <input class="form-input" v-model="form.name" placeholder="如：餐饮、交通" />
        </div>

        <div class="form-group">
          <label class="form-label">图标</label>
          <div class="icon-picker">
            <span
              v-for="icon in iconOptions"
              :key="icon"
              class="icon-option"
              :class="{ selected: form.icon === icon }"
              @click="form.icon = icon"
            >{{ icon }}</span>
          </div>
        </div>

        <div style="display: flex; gap: 12px; padding: 0 16px; margin-top: 16px;">
          <button v-if="editingId" class="btn btn-danger" style="flex:1;" @click="confirmDel = true">删除</button>
          <button class="btn btn-primary" style="flex:2;" @click="save">{{ editingId ? '保存' : '添加' }}</button>
        </div>
      </div>
    </div>

    <!-- 删除确认 -->
    <div v-if="confirmDel" class="confirm-dialog" @click.self="confirmDel = false">
      <div class="confirm-box">
        <div class="msg">删除分类后，相关交易记录将显示为"未分类"，挂在这个分类上的预算也会一并删除。确定继续吗？</div>
        <div class="actions">
          <button class="btn btn-outline" @click="confirmDel = false">取消</button>
          <button class="btn btn-danger" @click="doDelete">删除</button>
        </div>
      </div>
    </div>

    <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getCategories, createCategory, updateCategory, deleteCategory } from '../db'

const categories = ref([])
const activeType = ref('expense')
const showModal = ref(false)
const editingId = ref(null)
const confirmDel = ref(false)
const toastMsg = ref('')

const iconOptions = [
  '🍜', '🚗', '🛒', '🏠', '📱', '👔', '💊', '🎮', '📚', '✈️',
  '🎁', '🐱', '💡', '📦', '🎵', '🏥', '🎓', '🍎', '☕', '🎬',
  '💼', '💰', '📈', '🏦', '🎯', '💵', '🪙', '💎', '🤝', '🎉'
]

const form = reactive({ name: '', icon: '📌', type: 'expense' })

const filteredCategories = computed(() =>
  categories.value.filter(c => c.type === activeType.value)
)

function resetForm() {
  form.name = ''
  form.icon = '📌'
  form.type = activeType.value
  editingId.value = null
}

function openAdd() {
  resetForm()
  form.type = activeType.value
  showModal.value = true
}

function openEdit(cat) {
  editingId.value = cat.id
  form.name = cat.name
  form.icon = cat.icon
  form.type = cat.type
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  resetForm()
}

function showToast(msg) {
  toastMsg.value = msg
  setTimeout(() => { toastMsg.value = '' }, 2000)
}

async function loadData() {
  categories.value = await getCategories()
}

async function save() {
  if (!form.name.trim()) {
    showToast('请输入分类名称')
    return
  }
  try {
    if (editingId.value) {
      await updateCategory({ ...form, id: editingId.value })
    } else {
      await createCategory(form)
    }
    closeModal()
    await loadData()
    showToast(editingId.value ? '修改成功' : '添加成功')
  } catch (e) {
    showToast('操作失败: ' + e.message)
  }
}

async function doDelete() {
  try {
    await deleteCategory(editingId.value)
    confirmDel.value = false
    closeModal()
    await loadData()
    showToast('已删除')
  } catch (e) {
    showToast('删除失败: ' + e.message)
  }
}

onMounted(async () => {
  await loadData()
  // 如果没有分类，预置一些默认分类
  if (categories.value.length === 0) {
    const defaults = [
      { name: '餐饮', icon: '🍜', type: 'expense' },
      { name: '交通', icon: '🚗', type: 'expense' },
      { name: '购物', icon: '🛒', type: 'expense' },
      { name: '住房', icon: '🏠', type: 'expense' },
      { name: '通讯', icon: '📱', type: 'expense' },
      { name: '娱乐', icon: '🎮', type: 'expense' },
      { name: '医疗', icon: '💊', type: 'expense' },
      { name: '教育', icon: '📚', type: 'expense' },
      { name: '工资', icon: '💰', type: 'income' },
      { name: '奖金', icon: '🎯', type: 'income' },
      { name: '理财', icon: '📈', type: 'income' },
      { name: '其他', icon: '💵', type: 'income' }
    ]
    for (const d of defaults) {
      await createCategory(d)
    }
    await loadData()
  }
})
</script>

<style scoped>
.categories-page {
  min-height: 100%;
  position: relative;
}
/* 二级页统一模式：标题居中、返回固定在左侧 */
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
.icon-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.icon-option {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  border-radius: 10px;
  background: var(--bg);
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.2s;
}
.icon-option.selected {
  border-color: var(--primary);
  background: var(--primary-light);
}
</style>
