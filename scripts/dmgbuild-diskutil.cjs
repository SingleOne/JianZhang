#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { downloadBuilderToolset } = require('app-builder-lib/out/util/electronGet')

async function main() {
  // Use the same checksum-verified, self-contained runtime as electron-builder 26.
  // Its Python packages preserve the existing DMG background and Finder layout.
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
  const toolset = await downloadBuilderToolset({
    releaseName: 'dmg-builder@1.2.5',
    filenameWithExt: `dmgbuild-bundle-${arch}-75c8a6c.tar.gz`,
    checksums: {
      'dmgbuild-bundle-arm64-75c8a6c.tar.gz':
        '793404d0c96687e27d5ee40a668d498c92e36a64d6c2906df511031adb33cbeb',
      'dmgbuild-bundle-x86_64-75c8a6c.tar.gz':
        '1664972f9cc2d6e8fce3b63e42cd30078aff602669c5856939c4519921200433'
    }
  })

  const args = process.argv.slice(2)
  const settingsIndex = args.indexOf('-s') + 1
  const settingsFile = args[settingsIndex]
  args[settingsIndex] = path.join(__dirname, 'dmgbuild-diskutil.py')
  const result = spawnSync(path.join(toolset, 'dmgbuild'), args, {
    stdio: 'inherit',
    env: { ...process.env, JIANZHANG_DMG_SETTINGS: settingsFile }
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
