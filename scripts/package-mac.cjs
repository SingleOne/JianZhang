const { execFileSync } = require('node:child_process')
const path = require('node:path')
const { log } = require('builder-util')
const { packageArguments, packageEnvironment } = require('./mac-package-options.cjs')
const {
  LogMessageByKey,
  logMessageLevelByKey
} = require('app-builder-lib/out/node-module-collector/moduleManager')

try {
  if (process.platform !== 'darwin') throw new Error('macOS 安装包需要在 Mac 上构建。')
  const { mode, args } = packageArguments(process.argv.slice(2), process.arch)
  const environment = packageEnvironment(mode, process.env)
  // Credentials removed for the local build must not be inherited by builder.
  for (const key of Object.keys(process.env)) {
    if (!(key in environment)) delete process.env[key]
  }
  Object.assign(process.env, environment)
  process.argv = [...process.argv.slice(0, 2), ...args]
  console.info(
    mode === 'local'
      ? '本机打包：ad-hoc 签名，不使用开发证书、联网时间戳或公证。'
      : '分发打包：Developer ID Application 签名、联网时间戳与 Apple 公证。'
  )
} catch (reason) {
  console.error(reason instanceof Error ? reason.message : reason)
  process.exit(1)
}

// npm's shared dependency references are normal. Keep unresolved references at warn level.
logMessageLevelByKey[LogMessageByKey.PKG_DUPLICATE_REF] = 'debug'

if (process.platform === 'darwin' && !process.env.CUSTOM_DMGBUILD_PATH) {
  const macVersion = execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' })
  if (Number(macVersion.split('.')[0]) >= 27) {
    const adapterPath = path.join(__dirname, 'dmgbuild-diskutil.cjs')
    process.env.CUSTOM_DMGBUILD_PATH = adapterPath
    const warn = log.warn.bind(log)
    log.warn = (fields, message) => {
      // This bundled adapter is an expected backend, rather than a user tool override.
      if (
        message === 'using CUSTOM_DMGBUILD_PATH override for dmgbuild binary' &&
        fields.path === adapterPath
      ) {
        log.info({ backend: 'diskutil image' }, 'using macOS disk image backend')
      } else {
        warn(fields, message)
      }
    }
  }
}

// Keep electron-builder's CLI arguments, exit status, signing and artifact handling.
require('electron-builder/cli')
