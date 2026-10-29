const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const test = require('node:test')
const {
  distributionIdentity,
  requireNotarization,
  packageEnvironment,
  packageArguments,
  macOptions
} = require('./mac-package-options.cjs')

const development = 'A'.repeat(40)
const distribution = 'B'.repeat(40)
const otherDistribution = 'C'.repeat(40)
const identities = `
  1) ${development} "Apple Development: Example (TEAMMEMBER)"
  2) ${distribution} "Developer ID Application: Example (TEAMID1234)"
  2 valid identities found
`

test('local mode defaults to the host architecture and never publishes', () => {
  assert.deepEqual(packageArguments(['--mac'], 'arm64'), {
    mode: 'local',
    args: ['--mac', '--arm64', '--publish', 'never']
  })
  assert.ok(packageArguments([], 'x64').args.includes('--x64'))
})

test('an explicit architecture replaces the default for both modes', () => {
  assert.deepEqual(packageArguments(['--mode', 'local', '--x64'], 'arm64').args, [
    '--x64',
    '--publish',
    'never'
  ])
  assert.deepEqual(packageArguments(['--mode', 'dist', '--arm64'], 'arm64').args, [
    '--arm64',
    '--publish',
    'never'
  ])
  assert.deepEqual(packageArguments(['--universal'], 'arm64').args, [
    '--universal',
    '--publish',
    'never'
  ])
})

test('distribution defaults to both supported architectures', () => {
  assert.deepEqual(packageArguments(['--mode', 'dist', '--mac'], 'arm64'), {
    mode: 'dist',
    args: ['--mac', '--x64', '--arm64', '--publish', 'never']
  })
})

test('invalid modes and publishing overrides fail before building an artifact', () => {
  assert.throws(() => packageArguments(['--mode'], 'arm64'), /--mode/)
  assert.throws(() => packageArguments(['--mode', 'unknown'], 'arm64'), /--mode/)
  for (const value of ['--publish', '--publish=always', '-p', '-p=always'])
    assert.throws(() => packageArguments([value], 'arm64'), /--publish/)
})

test('local mode never reads certificates and strips inherited signing credentials', () => {
  const environment = {
    CSC_NAME: 'old identity',
    CSC_LINK: 'private certificate',
    CSC_KEY_PASSWORD: 'private password',
    CSC_KEYCHAIN: 'private keychain',
    CSC_INSTALLER_LINK: 'installer certificate',
    CSC_INSTALLER_KEY_PASSWORD: 'installer password',
    APPLE_KEYCHAIN_PROFILE: 'notary-profile',
    JIANZHANG_ICON_VARIANT: 'black'
  }
  const result = packageEnvironment('local', environment, () => assert.fail('No keychain access'))
  assert.ok(
    Object.keys(result).every(
      (key) => !key.startsWith('CSC_') || key === 'CSC_IDENTITY_AUTO_DISCOVERY'
    )
  )
  assert.equal(result.CSC_IDENTITY_AUTO_DISCOVERY, 'false')
  assert.equal(result.JIANZHANG_MAC_PACKAGE_MODE, 'local')
  assert.equal(result.JIANZHANG_ICON_VARIANT, 'black')
  assert.equal(environment.CSC_NAME, 'old identity')
})

test('only Developer ID Application identities can sign distribution builds', () => {
  assert.equal(distributionIdentity(identities).hash, distribution)
  assert.throws(
    () => distributionIdentity(`1) ${development} "Apple Development: Example"`),
    /Developer ID Application/
  )
  assert.throws(() => distributionIdentity(identities, development), /Developer ID Application/)
})

test('multiple valid distribution identities require an explicit selection', () => {
  const multiple =
    identities + `3) ${otherDistribution} "Developer ID Application: Other (TEAMID5678)"`
  assert.throws(() => distributionIdentity(multiple), /CSC_NAME/)
  assert.equal(distributionIdentity(multiple, distribution.toLowerCase()).hash, distribution)
  assert.equal(distributionIdentity(multiple, 'Other (TEAMID5678)').hash, otherDistribution)
  assert.equal(
    distributionIdentity(multiple, 'Developer ID Application: Example (TEAMID1234)').hash,
    distribution
  )
})

test('distribution preparation pins a validated identity and keeps signing credentials', () => {
  const result = packageEnvironment(
    'dist',
    { APPLE_KEYCHAIN_PROFILE: 'notary', CSC_KEYCHAIN: 'signing-keychain' },
    (keychain) => {
      assert.equal(keychain, 'signing-keychain')
      return identities
    }
  )
  assert.equal(result.CSC_NAME, distribution)
  assert.equal(result.CSC_KEYCHAIN, 'signing-keychain')
  assert.equal(result.CSC_IDENTITY_AUTO_DISCOVERY, 'true')
})

test('CSC_LINK imports are allowed and their identity is validated by the signing hook', () => {
  const result = packageEnvironment(
    'dist',
    { CSC_LINK: 'certificate.p12', APPLE_KEYCHAIN_PROFILE: 'notary' },
    () => assert.fail('Imported keychain is not ready yet')
  )
  assert.equal(result.CSC_LINK, 'certificate.p12')
  assert.equal(typeof macOptions('dist').sign, 'function')
})

test('distribution builds require complete notarization credentials', () => {
  assert.throws(() => packageEnvironment('dist', {}, () => identities), /公证凭据/)
  assert.doesNotThrow(() => requireNotarization({ APPLE_KEYCHAIN_PROFILE: 'notary' }))
  assert.doesNotThrow(() =>
    requireNotarization({
      APPLE_ID: 'example',
      APPLE_APP_SPECIFIC_PASSWORD: 'password',
      APPLE_TEAM_ID: 'team'
    })
  )
  assert.doesNotThrow(() =>
    requireNotarization({
      APPLE_API_KEY: 'key.p8',
      APPLE_API_KEY_ID: 'key-id',
      APPLE_API_ISSUER: 'issuer'
    })
  )
  assert.throws(() => requireNotarization({ APPLE_API_KEY: 'key.p8' }), /公证凭据/)
  assert.throws(
    () => requireNotarization({ APPLE_ID: 'example', APPLE_KEYCHAIN_PROFILE: 'notary' }),
    /公证凭据/
  )
})

test('local signing disables timestamps, notarization and hardened runtime', () => {
  const options = macOptions('local')
  assert.equal(options.identity, '-')
  assert.equal(options.timestamp, 'none')
  assert.equal(options.hardenedRuntime, false)
  assert.equal(options.notarize, false)
  assert.deepEqual(options.target, ['dmg'])
  assert.ok(options.artifactName.includes('-local.'))
})

test('the local signing hook overrides any identity accidentally selected by builder', async (t) => {
  const signer = require('@electron/osx-sign')
  const sign = t.mock.method(signer, 'signAsync', async (options) => {
    assert.equal(options.identity, '-')
    assert.equal(options.identityValidation, false)
    assert.equal(options.app, 'fixture.app')
  })
  await macOptions('local').sign({
    app: 'fixture.app',
    identity: 'Apple Development: Hyphen-Name',
    identityValidation: true
  })
  assert.equal(sign.mock.callCount(), 1)
})

test('distribution signing requires hardened runtime and notarization', () => {
  const options = macOptions('dist')
  assert.equal(options.type, 'distribution')
  assert.equal(options.hardenedRuntime, true)
  assert.equal(options.notarize, true)
  assert.deepEqual(options.target, ['dmg'])
  assert.ok(!options.artifactName.includes('-local.'))
  assert.throws(() => macOptions('unknown'), /local.*dist/)
})

test('actual builder config isolates outputs and leaves Windows packaging intact', () => {
  for (const mode of ['local', 'dist']) {
    const value = JSON.parse(
      execFileSync(
        process.execPath,
        ['-e', 'process.stdout.write(JSON.stringify(require("./electron-builder.config.cjs")))'],
        {
          cwd: require('node:path').resolve(__dirname, '..'),
          env: { ...process.env, JIANZHANG_MAC_PACKAGE_MODE: mode },
          encoding: 'utf8'
        }
      )
    )
    assert.equal(value.directories.output, `release/mac-${mode}`)
    assert.deepEqual(value.win.target, [{ target: 'nsis', arch: ['x64'] }])
    assert.equal(value.forceCodeSigning, mode === 'dist' ? true : undefined)
  }
})
