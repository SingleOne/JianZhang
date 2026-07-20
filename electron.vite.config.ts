import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const marketInsightModuleEnabled = process.env.JIANZHANG_MARKET_INSIGHT_MODULE !== '0'
const buildConstants = {
  __JIANZHANG_MARKET_INSIGHT_ENABLED__: JSON.stringify(marketInsightModuleEnabled)
}

export default defineConfig({
  main: {
    define: buildConstants,
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'electron/main/index.ts')
      }
    }
  },
  preload: {
    define: buildConstants,
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'electron/preload/index.ts')
      }
    }
  },
  renderer: {
    define: buildConstants,
    root: resolve(__dirname, '.'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'index.html')
      }
    }
  }
})
