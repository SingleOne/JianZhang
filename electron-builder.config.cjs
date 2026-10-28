const requestedIconVariant = process.env.JIANZHANG_ICON_VARIANT
const { afterPack, widgetAppGroup, signMacWidgets } = require('./scripts/macos-widgets.cjs')
const localSigning = process.env.JIANZHANG_MAC_LOCAL_SIGNING === '1'
const iconVariant =
  requestedIconVariant === 'red' || requestedIconVariant === 'black'
    ? requestedIconVariant
    : 'white'
const iconFiles = {
  white: 'build/icon-white.png',
  red: 'build/icon.png',
  black: 'build/icon-black.png'
}
const macIconFiles = {
  white: 'build/icon-white-mac.png',
  red: 'build/icon-mac.png',
  black: 'build/icon-black-mac.png'
}

module.exports = {
  appId: 'com.jianzhang.stock',
  productName: '见涨',
  asar: true,
  afterPack,
  protocols: [{ name: '见涨小组件', schemes: ['jianzhang'] }],
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
    }
  ],
  win: {
    icon: iconFiles[iconVariant],
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: '见涨-Setup-${version}-${arch}.${ext}'
  },
  mac: {
    ...(localSigning
      ? { type: 'development', timestamp: 'none', preAutoEntitlements: false, notarize: false }
      : {}),
    identity: process.env.JIANZHANG_WIDGET_SIGN_IDENTITY || undefined,
    sign: signMacWidgets,
    entitlements: 'build/macos-widgets/app-entitlements.plist',
    signIgnore: ['PlugIns/JianZhangWidgets\\.appex/'],
    extendInfo: { JZWidgetAppGroup: widgetAppGroup() },
    icon: macIconFiles[iconVariant],
    category: 'public.app-category.finance',
    target: localSigning ? ['dmg'] : [{ target: 'dmg', arch: ['x64', 'arm64'] }],
    artifactName: localSigning
      ? '见涨-${version}-mac-${arch}-local.${ext}'
      : '见涨-${version}-mac-${arch}.${ext}'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: '见涨',
    uninstallDisplayName: '见涨股票行情'
  },
  portable: {
    artifactName: '见涨-portable-${version}-${arch}.${ext}'
  }
}
