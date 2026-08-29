const aiModuleEnabled = process.env.JIANZHANG_AI_MODULE !== '0'
const requestedIconVariant = process.env.JIANZHANG_ICON_VARIANT
const iconVariant =
  requestedIconVariant === 'red' || requestedIconVariant === 'black'
    ? requestedIconVariant
    : 'white'
const iconFiles = {
  white: 'build/icon-white.png',
  red: 'build/icon.png',
  black: 'build/icon-black.png'
}

module.exports = {
  appId: 'com.jianzhang.stock',
  productName: '见涨',
  asar: true,
  directories: {
    output: 'release'
  },
  files: ['out/**/*', 'package.json'],
  extraResources: [
    {
      from: 'scripts/generate_dividend_financing_report.py',
      to: 'scripts/generate_dividend_financing_report.py'
    },
    {
      from: 'scripts/generate_fundamental_snapshot.py',
      to: 'scripts/generate_fundamental_snapshot.py'
    },
    ...(aiModuleEnabled
      ? [
          {
            from: 'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc',
            to: 'codex-runtime'
          }
        ]
      : [])
  ],
  win: {
    icon: iconFiles[iconVariant],
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: '见涨-Setup-${version}-${arch}.${ext}'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: '见涨',
    uninstallDisplayName: '见涨股票行情'
  }
}
