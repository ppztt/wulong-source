// 账户 skill：新建账户、改资料、调余额、删除账户
//
// 账户和分类/标签不同：它一旦写错会直接改净资产和报表口径，
// 所以这里所有金额都在 apply 里重新按库里的真实余额算一次差额，
// 不信任确认卡上的 delta —— 卡片可能是几分钟前生成、中间用户又记了几笔账。

import {
  getAccounts, getCategories, createCategory, createAccount, updateAccount,
  deleteAccount, createTransaction
} from '../db'
import { todayStr } from '../utils/finance'
import { valueAccounts } from '../utils/accountValuation'
import { accountDraft, accountValidate, accountFields, isLiabilityType, planRedeem } from './drafts'
import { buildAccountPrompt } from './prompts'

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

// 「账目调整」分类与账户页的一致，避免同一个概念出现两个分类
async function ensureAdjustCategory(type) {
  const categories = await getCategories(type)
  const found = categories.find(c => c.name === '账目调整')
  if (found) return found.id
  await createCategory({ name: '账目调整', icon: '⚖️', type })
  const refreshed = await getCategories(type)
  return refreshed.find(c => c.name === '账目调整')?.id || null
}

function createPayload(draft) {
  const type = draft.type || 'cash'
  const rawBalance = Math.abs(Number(draft.initial_balance) || 0)
  return {
    name: draft.name,
    icon: draft.icon || '💰',
    type,
    // 品种必须跟着 AI 的判断走：黄金账户被当成基金会去查不存在的净值，
    // 市值就只能按成本价算，用户看到的数字和实际持仓对不上
    market: type === 'investment' ? (draft.market === 'gold' ? 'gold' : 'fund') : '',
    symbol: type === 'investment' ? draft.symbol : '',
    shares: type === 'investment' ? Number(draft.shares) || 0 : 0,
    cost_price: type === 'investment' ? Number(draft.cost_price) || 0 : 0,
    // 信用 / 欠款账户界面填欠款正数，存储层统一用负数（总额计算时直接就是减项）
    initial_balance: isLiabilityType(type) ? -rawBalance : rawBalance,
    credit_limit: type === 'credit' ? Number(draft.credit_limit) || 0 : 0,
    bill_day: Number(draft.bill_day) || 1,
    repay_day: Number(draft.repay_day) || 1
  }
}

export const accountSkill = {
  id: 'account',
  label: '账户',
  routerHint: '新建账户、改账户名称/图标/额度、调账户余额、删除账户、把投资账户的持仓赎回到其他账户，例如「建个招行卡，余额 3000」「把余额宝余额改成 8000」「把白酒基金赎回 2000 到银行卡」',

  async loadContext() {
    // 投资账户要带上市值：它在提示词里给模型的「账户有多少钱」就是份额 × 行情价，
    // 只给流水余额会让模型拿 0 或某笔转入去向用户解释账户余额
    return { accounts: await valueAccounts(await getAccounts()), today: todayStr() }
  },

  buildPrompt: buildAccountPrompt,
  toDraft: accountDraft,
  validate: accountValidate,
  fields: accountFields,

  async apply(draft) {
    if (draft.mode === 'create') {
      await createAccount(createPayload(draft))
      return
    }

    // 卡片可能已经放了很久，实际余额以库里当前值为准
    const accounts = await getAccounts()
    const acc = accounts.find(a => Number(a.id) === Number(draft.account_id))
    if (!acc) throw new Error('这个账户已经不存在了，刷新后重试')

    if (draft.mode === 'delete') {
      await deleteAccount(acc.id)
      return
    }

    if (draft.mode === 'redeem') {
      // 赎回是两个账户之间的事：转出必须是投资账户，转入还得存在且不是它自己
      if (acc.type !== 'investment') throw new Error('只有投资账户可以赎回')
      const to = accounts.find(a => Number(a.id) === Number(draft.to_account_id))
      if (!to) throw new Error('转入账户已经不存在了，刷新后重试')
      if (Number(to.id) === Number(acc.id)) throw new Error('转出和转入不能是同一个账户')
      if (to.type === 'investment') throw new Error('赎回只能转到普通、信用或欠款账户')

      const held = Math.max(Number(acc.shares) || 0, 0)
      if (!(held > 0)) throw new Error('这个账户已经没有持仓可赎回')
      // 单价优先用用户确认过的，其次才退到成本价：确认卡可能放了几分钟，但净值不会天天变
      const price = Number(draft.price) > 0 ? Number(draft.price) : Number(acc.cost_price) || 0
      if (!(price > 0)) throw new Error('没有单价算不出赎回金额，请先在卡片上填单价')

      // 卡片上的金额可能被改过，份额一律按库里当前持仓重算，避免卖出超过持仓
      const plan = planRedeem({
        amount: draft.amount,
        price,
        held,
        all: Number(draft.redeem_all) > 0,
        digits: acc.market === 'gold' ? 4 : 2
      })
      if (!(plan.shares > 0)) throw new Error('赎回份额要大于 0')

      const unit = acc.market === 'gold' ? '克' : '份'
      await updateAccount({ ...acc, shares: plan.remaining })
      // 钱得真的到转入账户：记一笔转账，转出方是投资账户。
      // 转账不进收支统计，所以不会影响当月收支和预算
      await createTransaction({
        type: 'transfer',
        amount: plan.amount,
        account_id: acc.id,
        to_account_id: to.id,
        note: `赎回 ${plan.shares}${unit} @ ${price}`,
        date: todayStr()
      })

      // 清仓后份额为 0，账户金额的显示口径会退回「账面余额」：
      // 不把这次转出的钱抵掉，用户会看到一个负数余额，以为赎回记错了
      if (plan.remaining <= 0) {
        const after = round2((Number(acc.balance) || 0) - plan.amount)
        if (Math.abs(after) > 0.005) {
          await updateAccount({
            ...acc,
            shares: 0,
            initial_balance: round2((Number(acc.initial_balance) || 0) - after)
          })
        }
      }
      return
    }

    if (draft.mode === 'balance') {
      const target = Math.abs(Number(draft.target_balance) || 0)
      // 信用 / 欠款账户填的是欠款正数，换成 balance 口径要取负
      const targetBalance = isLiabilityType(acc.type) ? -target : target
      const diff = round2(targetBalance - (Number(acc.balance) || 0))
      if (Math.abs(diff) < 0.005) return

      if (draft.balance_mode === 'bill' || draft.balance_mode === 'offset') {
        if (draft.balance_mode === 'bill') {
          const type = diff > 0 ? 'income' : 'expense'
          const categoryId = await ensureAdjustCategory(type)
          await createTransaction({
            type,
            amount: Math.abs(diff),
            category_id: categoryId,
            account_id: acc.id,
            note: '余额校准',
            date: todayStr()
          })
        } else {
          // 只校准余额：差额并进期初，历史流水、收支统计与预算都不动
          await updateAccount({
            ...acc,
            initial_balance: (Number(acc.initial_balance) || 0) + diff
          })
        }
        return
      }
      // 没选处理方式就别落库：进不进流水是用户必须自己决定的事
      throw new Error('请先选择这笔差额怎么处理')
    }

    // update：只覆盖用户明确改的字段，其余原样带回去
    const type = acc.type
    await updateAccount({
      ...acc,
      name: String(draft.name || acc.name).trim(),
      icon: draft.icon || acc.icon,
      credit_limit: type === 'credit' ? Number(draft.credit_limit) || 0 : Number(acc.credit_limit) || 0,
      bill_day: type === 'credit' ? Number(draft.bill_day) || Number(acc.bill_day) || 1 : Number(acc.bill_day) || 1,
      repay_day: type === 'credit' ? Number(draft.repay_day) || Number(acc.repay_day) || 1 : Number(acc.repay_day) || 1,
      symbol: type === 'investment' ? draft.symbol : acc.symbol,
      shares: type === 'investment' ? Number(draft.shares) || 0 : Number(acc.shares) || 0,
      cost_price: type === 'investment' ? Number(draft.cost_price) || 0 : Number(acc.cost_price) || 0
    })
  }
}
