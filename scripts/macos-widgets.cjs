const { execFileSync } = require('node:child_process')
const { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const plist = require('plist')
const { Arch } = require('builder-util')

const project = path.resolve(__dirname, '..')
const buildRoot = path.join(project, 'build', 'macos-widgets')
const sourceRoot = path.join(project, 'native', 'macos-widgets')

function widgetAppGroup() {
  const team = process.env.JIANZHANG_WIDGET_TEAM_ID?.trim()
  const group =
    process.env.JIANZHANG_WIDGET_APP_GROUP?.trim() ||
    (team ? `${team}.com.jianzhang.stock` : 'group.com.jianzhang.stock')
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]+$/.test(group))
    throw new Error('Invalid widget App Group identifier')
  return group
}

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' })
}

function output(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim()
}

function writePlist(file, value) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, plist.build(value))
}

function signingIdentity() {
  const configured = process.env.JIANZHANG_WIDGET_SIGN_IDENTITY || process.env.CSC_NAME
  if (configured) return configured
  const identities = output('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'])
  return /"(Developer ID Application:[^"]+)"/.exec(identities)?.[1] || '-'
}

function nodeIncludeDirectory() {
  const directories = [
    process.env.JIANZHANG_NODE_INCLUDE,
    process.env.npm_config_nodedir && path.join(process.env.npm_config_nodedir, 'include', 'node'),
    path.resolve(path.dirname(process.execPath), '..', 'include', 'node'),
    '/opt/homebrew/include/node',
    '/usr/local/include/node'
  ].filter(Boolean)
  const found = directories.find((directory) => existsSync(path.join(directory, 'node_api.h')))
  if (!found)
    throw new Error(
      '找不到 Node-API 头文件。请设置 JIANZHANG_NODE_INCLUDE 为包含 node_api.h 的目录。'
    )
  return found
}

function buildMacWidgets({
  arch = process.arch,
  outputDirectory,
  identity = signingIdentity()
} = {}) {
  if (process.platform !== 'darwin')
    throw new Error('macOS widgets must be built on macOS with Xcode')
  if (!['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported widget architecture: ${arch}`)
  const cpu = arch === 'x64' ? 'x86_64' : 'arm64'
  const triple = `${cpu}-apple-macosx14.0`
  const work = path.join(buildRoot, arch)
  const destination = outputDirectory || path.join(work, 'Contents')
  const extension = path.join(destination, 'PlugIns', 'JianZhangWidgets.appex')
  const extensionContents = path.join(extension, 'Contents')
  const resources = path.join(extensionContents, 'Resources')
  const addonDirectory = path.join(destination, 'Resources', 'macos-widgets')
  const moduleCache = path.join(buildRoot, 'module-cache')
  for (const directory of [
    work,
    resources,
    path.join(extensionContents, 'MacOS'),
    addonDirectory,
    moduleCache
  ]) {
    mkdirSync(directory, { recursive: true })
  }
  const group = widgetAppGroup()
  const sdk = output('xcrun', ['--sdk', 'macosx', '--show-sdk-path'])
  const swift = output('xcrun', ['--find', 'swiftc'])
  const toolchain = path.resolve(swift, '../../..')
  const version = require('../package.json').version
  const common = [
    '-target',
    triple,
    '-sdk',
    sdk,
    '-module-cache-path',
    moduleCache,
    '-swift-version',
    '5'
  ]
  const sources = ['WidgetModels.swift', 'Widgets.swift'].map((name) => path.join(sourceRoot, name))
  const constants = path.join(work, 'Widgets.swiftconstvalues')
  const protocols = path.join(work, 'const-protocols.json')
  const protocolDefinition = JSON.parse(
    readFileSync(
      path.join(toolchain, 'usr/share/swift/SwiftConstantValues/AppIntents.json'),
      'utf8'
    )
  )
  writeFileSync(
    protocols,
    JSON.stringify(protocolDefinition.constValueProtocols || protocolDefinition)
  )
  run(swift, [
    ...common,
    '-O',
    '-whole-module-optimization',
    '-parse-as-library',
    '-application-extension',
    '-module-name',
    'JianZhangWidgets',
    '-emit-const-values-path',
    constants,
    '-const-gather-protocols-list',
    protocols,
    ...sources,
    '-o',
    path.join(extensionContents, 'MacOS', 'JianZhangWidgets')
  ])

  const sourceList = path.join(work, 'sources.txt')
  const constList = path.join(work, 'constants.txt')
  writeFileSync(sourceList, sources.join('\n') + '\n')
  writeFileSync(constList, constants + '\n')
  run('xcrun', [
    'appintentsmetadataprocessor',
    '--output',
    resources,
    '--toolchain-dir',
    toolchain,
    '--module-name',
    'JianZhangWidgets',
    '--sdk-root',
    sdk,
    '--xcode-version',
    output('xcodebuild', ['-version']).match(/Build version (\S+)/)[1],
    '--platform-family',
    'macOS',
    '--deployment-target',
    '14.0',
    '--target-triple',
    triple,
    '--source-file-list',
    sourceList,
    '--swift-const-vals-list',
    constList
  ])

  writePlist(path.join(extensionContents, 'Info.plist'), {
    CFBundleIdentifier: 'com.jianzhang.stock.widgets',
    CFBundleName: 'JianZhangWidgets',
    CFBundleDisplayName: '见涨',
    CFBundleExecutable: 'JianZhangWidgets',
    CFBundlePackageType: 'XPC!',
    CFBundleVersion: version,
    CFBundleShortVersionString: version,
    CFBundleDevelopmentRegion: 'zh_CN',
    CFBundleSupportedPlatforms: ['MacOSX'],
    LSMinimumSystemVersion: '14.0',
    JZWidgetAppGroup: group,
    NSExtension: { NSExtensionPointIdentifier: 'com.apple.widgetkit-extension' }
  })
  const profile = process.env.JIANZHANG_WIDGET_PROVISIONING_PROFILE
  if (profile) cpSync(profile, path.join(extensionContents, 'embedded.provisionprofile'))
  else rmSync(path.join(extensionContents, 'embedded.provisionprofile'), { force: true })
  const extensionEntitlements = path.join(work, 'extension-entitlements.plist')
  writePlist(extensionEntitlements, {
    'com.apple.security.app-sandbox': true,
    'com.apple.security.application-groups': [group]
  })
  writePlist(path.join(buildRoot, 'extension-entitlements.plist'), {
    'com.apple.security.app-sandbox': true,
    'com.apple.security.application-groups': [group]
  })
  // Retain Electron's default JIT/device entitlements when adding App Groups.
  const defaultEntitlements = plist.parse(
    require('node:fs').readFileSync(
      path.join(project, 'node_modules/@electron/osx-sign/entitlements/default.darwin.plist'),
      'utf8'
    )
  )
  writePlist(path.join(buildRoot, 'app-entitlements.plist'), {
    ...defaultEntitlements,
    'com.apple.security.application-groups': [group]
  })
  const object = path.join(work, 'bridge.o')
  run('xcrun', [
    'clang',
    '-target',
    triple,
    '-isysroot',
    sdk,
    '-fPIC',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-I',
    nodeIncludeDirectory(),
    '-c',
    path.join(sourceRoot, 'bridge.c'),
    '-o',
    object
  ])
  const addon = path.join(addonDirectory, 'jianzhang-widget.node')
  run(swift, [
    ...common,
    '-O',
    '-emit-library',
    path.join(sourceRoot, 'WidgetBridge.swift'),
    object,
    '-Xlinker',
    '-undefined',
    '-Xlinker',
    'dynamic_lookup',
    '-o',
    addon
  ])
  for (const [file, entitlements] of [
    [addon, null],
    [extension, extensionEntitlements]
  ]) {
    run('/usr/bin/codesign', [
      '--force',
      '--sign',
      identity,
      '--options',
      'runtime',
      ...(identity === '-' ? ['--timestamp=none'] : ['--timestamp']),
      ...(entitlements ? ['--entitlements', entitlements] : []),
      file
    ])
  }
  if (identity === '-') {
    console.warn(
      '小组件使用 ad-hoc 签名完成编译；系统加载和 App Groups 授权需要有效的开发者签名，不能以此构建确认。'
    )
  }
  return destination
}

async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const arch = Arch[context.arch]
  const destination = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents'
  )
  // The actual signing identity/keychain is selected later by electron-builder,
  // including certificates imported through CSC_LINK. Sign staging artifacts ad-hoc.
  buildMacWidgets({ arch, outputDirectory: destination, identity: '-' })
}

async function signMacWidgets(options) {
  const extension = path.join(options.app, 'Contents/PlugIns/JianZhangWidgets.appex')
  if (existsSync(extension)) {
    run('/usr/bin/codesign', [
      '--force',
      '--sign',
      options.identity,
      ...(options.keychain ? ['--keychain', options.keychain] : []),
      '--options',
      'runtime',
      options.identity === '-' ? '--timestamp=none' : '--timestamp',
      '--entitlements',
      path.join(buildRoot, 'extension-entitlements.plist'),
      extension
    ])
  }
  // Preserve electron-builder's chosen keychain, entitlements and verification options.
  await require('@electron/osx-sign').signAsync(options)
}

module.exports = { afterPack, buildMacWidgets, widgetAppGroup, signMacWidgets }
if (require.main === module) {
  const index = process.argv.indexOf('--arch')
  buildMacWidgets({ arch: index >= 0 ? process.argv[index + 1] : process.arch })
}
