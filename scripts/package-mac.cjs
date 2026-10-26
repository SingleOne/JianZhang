const { execFileSync } = require('node:child_process')
const path = require('node:path')
const { log } = require('builder-util')
const {
  LogMessageByKey,
  logMessageLevelByKey
} = require('app-builder-lib/out/node-module-collector/moduleManager')

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
