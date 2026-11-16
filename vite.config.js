import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      // 新浪行情接口要求携带 Referer，浏览器无法设置，开发环境由代理补上
      '/sina-api': {
        target: 'https://hq.sinajs.cn',
        changeOrigin: true,
        headers: { Referer: 'https://finance.sina.com.cn' },
        rewrite: path => path.replace(/^\/sina-api/, '')
      },
      // 天天基金历史净值接口同样校验 Referer，作为货币基金收益的备用数据源
      '/fund-api': {
        target: 'https://api.fund.eastmoney.com',
        changeOrigin: true,
        headers: {
          Referer: 'https://fundf10.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
        },
        rewrite: path => path.replace(/^\/fund-api/, '')
      },
      // DeepSeek 开放平台：浏览器直连会被跨域拦截，开发环境经代理转发
      // 原生 App 走 CapacitorHttp，不经过这里
      '/ds-api': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/ds-api/, '')
      }
    }
  }
})
