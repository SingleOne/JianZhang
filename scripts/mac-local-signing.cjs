const { execFileSync } = require('node:child_process')
const { X509Certificate } = require('node:crypto')

function developmentIdentities(output) {
  return [
    ...output.matchAll(
      /^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"((?:Apple Development|Mac Developer):.*)"\s*$/gm
    )
  ].map((match) => ({ hash: match[1].toUpperCase(), name: match[2] }))
}

function selectDevelopmentIdentity(identities, configured) {
  const requested = configured?.trim()
  const matches = requested
    ? identities.filter(
        (identity) => identity.hash === requested.toUpperCase() || identity.name === requested
      )
    : identities
  if (matches.length === 0) {
    throw new Error(
      requested
        ? '指定的证书不是有效的 Apple Development 签名身份，请检查证书名称和私钥。'
        : '未找到有效的 Apple Development 证书。请先在 Xcode 创建开发证书，并确认 Apple WWDR G3 中间证书已安装。'
    )
  }
  if (matches.length > 1)
    throw new Error('存在多个开发证书，请用 CSC_NAME 指定完整证书名称或 SHA-1 指纹。')
  return matches[0]
}

function teamIdFromSubject(subject) {
  const team = /^OU=([A-Z0-9]{10})$/m.exec(subject)?.[1]
  if (!team) throw new Error('无法从开发证书的 Organizational Unit 读取有效 Team ID。')
  return team
}

function localSigningEnvironment(environment, identity, teamId) {
  if (environment.JIANZHANG_WIDGET_TEAM_ID && environment.JIANZHANG_WIDGET_TEAM_ID !== teamId) {
    throw new Error('JIANZHANG_WIDGET_TEAM_ID 与开发证书的真实 Team ID 不一致。')
  }
  const group = environment.JIANZHANG_WIDGET_APP_GROUP || `${teamId}.com.jianzhang.stock`
  if (!group.startsWith(`${teamId}.`) || !/^[A-Za-z0-9.-]+$/.test(group)) {
    throw new Error(
      '本机模式需要证书 Team ID 前缀的 App Group；请清除 JIANZHANG_WIDGET_APP_GROUP，或使用 <Team ID>.com.jianzhang.stock。'
    )
  }
  return {
    ...environment,
    JIANZHANG_MAC_LOCAL_SIGNING: '1',
    // electron-builder rejects certificate type prefixes; the fingerprint is unambiguous.
    JIANZHANG_WIDGET_SIGN_IDENTITY: identity.hash,
    JIANZHANG_WIDGET_TEAM_ID: teamId,
    JIANZHANG_WIDGET_APP_GROUP: group
  }
}

function resolveLocalSigning(environment = process.env) {
  if (process.platform !== 'darwin') throw new Error('本机 macOS 签名命令只能在 Mac 上运行。')
  const output = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8'
  })
  const identity = selectDevelopmentIdentity(
    developmentIdentities(output),
    environment.JIANZHANG_WIDGET_SIGN_IDENTITY || environment.CSC_NAME
  )
  // Export only public certificates; private key operations stay inside codesign.
  const certificates =
    execFileSync('/usr/bin/security', ['find-certificate', '-a', '-c', identity.name, '-p'], {
      encoding: 'utf8'
    }).match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []
  const certificate = certificates
    .map((pem) => new X509Certificate(pem))
    .find((item) => item.fingerprint.replaceAll(':', '').toUpperCase() === identity.hash)
  if (!certificate) throw new Error('无法找到与所选开发签名身份匹配的公钥证书。')
  const teamId = teamIdFromSubject(certificate.subject)
  return localSigningEnvironment(environment, identity, teamId)
}

function localBuildArguments(arguments_, arch) {
  if (
    arguments_.some(
      (argument) =>
        argument === '--publish' ||
        argument.startsWith('--publish=') ||
        argument === '-p' ||
        argument.startsWith('-p=')
    )
  ) {
    throw new Error('本机开发签名命令不支持发布参数。')
  }
  if (arguments_.some((argument) => ['--universal', '--ia32'].includes(argument))) {
    throw new Error('本机小组件打包仅支持 --arm64 或 --x64。')
  }
  const result = [...arguments_]
  if (!result.some((argument) => ['--arm64', '--x64'].includes(argument))) {
    result.push(arch === 'arm64' ? '--arm64' : '--x64')
  }
  result.push('--publish', 'never')
  return result
}

module.exports = {
  developmentIdentities,
  selectDevelopmentIdentity,
  teamIdFromSubject,
  localSigningEnvironment,
  resolveLocalSigning,
  localBuildArguments
}
