import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const marketInsightModuleEnabled = process.env.JIANZHANG_MARKET_INSIGHT_MODULE !== '0'
const aiModuleEnabled = process.env.JIANZHANG_AI_MODULE !== '0'
const aiTAdviceModuleEnabled = aiModuleEnabled && process.env.JIANZHANG_AI_T_ADVICE_MODULE !== '0'
const requestedIconVariant = process.env.JIANZHANG_ICON_VARIANT
const iconVariant = requestedIconVariant === 'red' || requestedIconVariant === 'black'
  ? requestedIconVariant
  : 'white'
const defaultGitHubOauthClientId = 'Ov23liCYRkPi2M4mnbYh'
const githubOauthClientId =
  process.env.JIANZHANG_GITHUB_OAUTH_CLIENT_ID?.trim() || defaultGitHubOauthClientId
const buildConstants = {
  __JIANZHANG_MARKET_INSIGHT_ENABLED__: JSON.stringify(marketInsightModuleEnabled),
  __JIANZHANG_AI_MODULE_ENABLED__: JSON.stringify(aiModuleEnabled),
  __JIANZHANG_AI_T_ADVICE_MODULE_ENABLED__: JSON.stringify(aiTAdviceModuleEnabled),
  __JIANZHANG_ICON_VARIANT__: JSON.stringify(iconVariant),
  __JIANZHANG_GITHUB_OAUTH_CLIENT_ID__: JSON.stringify(githubOauthClientId)
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
