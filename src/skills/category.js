// 分类 skill：只在用户要新建记账分类时才加载

import { getCategories, createCategory } from '../db'
import { categoryDraft, categoryValidate, categoryFields } from './drafts'
import { buildCategoryPrompt } from './prompts'

export const categorySkill = {
  id: 'category',
  label: '分类',
  routerHint: '新建记账分类，例如「加个分类叫宠物」「加个收入分类叫外快」',

  async loadContext() {
    return { categories: await getCategories() }
  },

  buildPrompt: buildCategoryPrompt,
  toDraft: categoryDraft,
  validate: categoryValidate,
  fields: categoryFields,

  async apply(draft) {
    return createCategory({
      name: draft.name,
      type: draft.type,
      icon: draft.icon
    })
  }
}
