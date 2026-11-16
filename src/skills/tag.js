// 标签 skill：只在用户要新建标签时才加载

import { getTags, createTag } from '../db'
import { tagDraft, tagValidate, tagFields } from './drafts'
import { buildTagPrompt } from './prompts'

export const tagSkill = {
  id: 'tag',
  label: '标签',
  routerHint: '新建记账标签，例如「加个标签叫可报销」「建个标签叫旅行」',

  async loadContext() {
    return { tags: await getTags() }
  },

  buildPrompt: buildTagPrompt,
  toDraft: tagDraft,
  validate: tagValidate,
  fields: tagFields,

  async apply(draft) {
    return createTag({ name: draft.name })
  }
}
