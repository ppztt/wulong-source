// 周期记账 skill：只在用户描述「固定重复的一笔」时才加载

import { getRecurringRules, getCategories, getAccounts, saveRecurringRule } from '../db'
import { todayStr } from '../utils/finance'
import { recurringDraft, recurringValidate, recurringFields } from './drafts'
import { buildRecurringPrompt } from './prompts'

export const recurringSkill = {
  id: 'recurring',
  label: '周期记账',
  routerHint: '设置固定重复的收支，例如「每月5号房租1500」「每周一停车费50」「每年车险6000」',

  async loadContext() {
    const [rules, categories, accounts] = await Promise.all([
      getRecurringRules(), getCategories(), getAccounts()
    ])
    return { rules, categories, accounts, today: todayStr() }
  },

  buildPrompt: buildRecurringPrompt,
  toDraft: recurringDraft,
  validate: recurringValidate,
  fields: recurringFields,

  async apply(draft) {
    return saveRecurringRule({
      name: draft.name,
      type: draft.type,
      amount: draft.amount,
      category_id: draft.type === 'transfer' ? null : draft.category_id,
      account_id: draft.account_id,
      to_account_id: draft.type === 'transfer' ? draft.to_account_id : null,
      note: draft.note,
      merchant: draft.merchant,
      frequency: draft.frequency,
      start_date: draft.start_date,
      end_date: draft.end_date,
      enabled: 1
    })
  }
}
