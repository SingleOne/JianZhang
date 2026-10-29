const { execFileSync } = require('node:child_process')

const certificatePrefix = 'Developer ID Application:'
const localCredentialKeys = [
  'CSC_NAME',
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'CSC_KEYCHAIN',
  'CSC_INSTALLER_LINK',
  'CSC_INSTALLER_KEY_PASSWORD'
]

function readIdentities(keychain) {
  return execFileSync(
    '/usr/bin/security',
    ['find-identity', '-v', '-p', 'codesigning', ...(keychain ? [keychain] : [])],
    { encoding: 'utf8' }
  )
}

function distributionIdentity(output, requested) {
  const candidates = [...output.matchAll(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"([^"]+)"\s*$/gm)]
    .map((match) => ({ hash: match[1].toUpperCase(), name: match[2] }))
    .filter((identity) => identity.name.startsWith(certificatePrefix))
    .filter(
      (identity) =>
        !requested ||
        identity.hash === requested.trim().toUpperCase() ||
        identity.name.includes(requested.trim())
    )
  if (candidates.length === 0)
    throw new Error(
      '分发打包需要有效的 Developer ID Application 证书及私钥；Apple Development 不能用于此命令。本机运行请使用 npm run package:mac:local。'
    )
  if (candidates.length > 1)
    throw new Error(
      '找到多个 Developer ID Application 证书，请用 CSC_NAME 指定证书名称或 SHA-1 指纹。'
    )
  return candidates[0]
}

function requireNotarization(environment) {
  const complete =
    environment.APPLE_ID || environment.APPLE_APP_SPECIFIC_PASSWORD
      ? environment.APPLE_ID && environment.APPLE_APP_SPECIFIC_PASSWORD && environment.APPLE_TEAM_ID
      : environment.APPLE_API_KEY || environment.APPLE_API_KEY_ID || environment.APPLE_API_ISSUER
        ? environment.APPLE_API_KEY && environment.APPLE_API_KEY_ID && environment.APPLE_API_ISSUER
        : environment.APPLE_KEYCHAIN_PROFILE
  if (!complete)
    throw new Error(
      '分发打包需要完整公证凭据：推荐设置 APPLE_KEYCHAIN_PROFILE；也可配置完整的 Apple ID 或 App Store Connect API 凭据。'
    )
}

function packageEnvironment(mode, environment, getIdentities = readIdentities) {
  const result = { ...environment, JIANZHANG_MAC_PACKAGE_MODE: mode }
  if (mode === 'local') {
    for (const key of localCredentialKeys) delete result[key]
    result.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  } else if (mode === 'dist') {
    result.CSC_IDENTITY_AUTO_DISCOVERY = 'true'
    if (!result.CSC_LINK) {
      result.CSC_NAME = distributionIdentity(
        getIdentities(result.CSC_KEYCHAIN),
        result.CSC_NAME
      ).hash
    }
    requireNotarization(result)
  } else {
    throw new Error('macOS 打包模式仅支持 local 或 dist。')
  }
  return result
}

function packageArguments(arguments_, arch) {
  const args = [...arguments_]
  const index = args.indexOf('--mode')
  const mode = index < 0 ? 'local' : args[index + 1]
  if (!['local', 'dist'].includes(mode)) throw new Error('--mode 必须指定 local 或 dist。')
  if (index >= 0) args.splice(index, 2)
  if (!args.some((argument) => ['--arm64', '--x64', '--universal'].includes(argument)))
    args.push(
      ...(mode === 'local' ? [arch === 'arm64' ? '--arm64' : '--x64'] : ['--x64', '--arm64'])
    )
  if (args.some((argument) => /^(-p|--publish)(=|$)/.test(argument)))
    throw new Error('打包命令只生成安装包，不接受 --publish；请单独执行发布流程。')
  args.push('--publish', 'never')
  return { mode, args }
}

async function signDistribution(options) {
  // Validate after CSC_LINK import as well: electron-builder 26 may otherwise
  // mistake Apple Development for a custom distribution certificate.
  distributionIdentity(readIdentities(options.keychain), options.identity)
  await require('@electron/osx-sign').signAsync(options)
}

async function signLocal(options) {
  // Pin the actual signer too: builder 26 can substring-match "-" against
  // a certificate name containing a hyphen before its ad-hoc fallback runs.
  await require('@electron/osx-sign').signAsync({
    ...options,
    identity: '-',
    identityValidation: false
  })
}

function macOptions(mode = 'local') {
  if (mode === 'local')
    return {
      type: 'development',
      identity: '-',
      sign: signLocal,
      timestamp: 'none',
      hardenedRuntime: false,
      preAutoEntitlements: false,
      notarize: false,
      target: ['dmg'],
      artifactName: '见涨-${version}-mac-${arch}-local.${ext}'
    }
  if (mode === 'dist')
    return {
      type: 'distribution',
      sign: signDistribution,
      hardenedRuntime: true,
      notarize: true,
      target: ['dmg'],
      artifactName: '见涨-${version}-mac-${arch}.${ext}'
    }
  throw new Error('macOS 打包模式仅支持 local 或 dist。')
}

module.exports = {
  distributionIdentity,
  requireNotarization,
  packageEnvironment,
  packageArguments,
  macOptions
}
