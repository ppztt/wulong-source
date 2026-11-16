// 预算 skill：只在用户说的事情跟预算有关时才被加载

import { getBudgets, getCategories, saveBudget } from '../db'
import { todayStr } from '../utils/finance'
import { budgetDraft, budgetValidate, budgetFields } from './drafts'
import { buildBudgetPrompt } from './prompts'

export const budgetSkill = {
  id: 'budget',
  label: '预算',
  // 给基础提示词的分派清单用，一句话说清什么时候该走这里
  routerHint: '设置或修改预算额度，例如「这个月总预算3000」「餐饮预算800」「每周零花200」',

  async loadContext() {
    const [budgets, categories] = await Promise.all([getBudgets(), getCategories()])
    return { budgets, categories, today: todayStr() }
  },

  buildPrompt: buildBudgetPrompt,
  toDraft: budgetDraft,
  validate: budgetValidate,
  fields: budgetFields,

  async apply(draft) {
    return saveBudget({
      id: draft.existingId || undefined,
      name: draft.scope === 'category'
        ? `${draft.category_name || '分类'}预算`
        : '总预算',
      scope: draft.scope,
      category_id: draft.category_id,
      amount: draft.amount,
      period: draft.period,
      carry_over: draft.carry_over,
      start_date: draft.start_date,
      enabled: 1
    })
  }
}
