import { createRouter, createWebHashHistory } from 'vue-router'
import Home from '../views/Home.vue'

const routes = [
  { path: '/', name: 'Home', component: Home },
  { path: '/add', name: 'AddTransaction', component: () => import('../views/AddTransaction.vue') },
  { path: '/edit/:id', name: 'EditTransaction', component: () => import('../views/AddTransaction.vue'), props: true },
  { path: '/accounts', name: 'Accounts', component: () => import('../views/Accounts.vue') },
  { path: '/statistics', name: 'Statistics', component: () => import('../views/Statistics.vue') },
  { path: '/budgets', name: 'Budgets', component: () => import('../views/Budgets.vue') },
  { path: '/interest', name: 'Interest', component: () => import('../views/Interest.vue') },
  { path: '/guide', name: 'Guide', component: () => import('../views/Guide.vue') },
  { path: '/import', name: 'Import', component: () => import('../views/Import.vue') },
  { path: '/assistant', name: 'Assistant', component: () => import('../views/Assistant.vue') },
  { path: '/markets', name: 'Markets', component: () => import('../views/Markets.vue') },
  { path: '/categories', name: 'Categories', component: () => import('../views/Categories.vue') },
  { path: '/search', name: 'Search', component: () => import('../views/Search.vue') },
  { path: '/tags', name: 'Tags', component: () => import('../views/Tags.vue') },
  { path: '/installments', name: 'Installments', component: () => import('../views/Installments.vue') },
  { path: '/recurring', name: 'Recurring', component: () => import('../views/Recurring.vue') },
  { path: '/salary', name: 'Salary', component: () => import('../views/Salary.vue') },
  { path: '/settings', name: 'Settings', component: () => import('../views/Settings.vue') }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
