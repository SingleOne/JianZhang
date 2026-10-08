// Node-only tools use the Chromium version bundled with the current Electron dependency.
const chromeVersion = process.versions.chrome ?? '150.0.7871.114'

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  `(KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
