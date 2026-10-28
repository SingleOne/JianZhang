const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  developmentIdentities,
  selectDevelopmentIdentity,
  teamIdFromSubject,
  localSigningEnvironment,
  localBuildArguments
} = require('./mac-local-signing.cjs')

const first = { hash: 'A'.repeat(40), name: 'Apple Development: Example Person (MEMBER0001)' }
const second = { hash: 'B'.repeat(40), name: 'Apple Development: Another Person (MEMBER0002)' }
const team = 'A1B2C3D4E5'

test('parses valid development identities and excludes Developer ID distribution identities', () => {
  const output = ` 1) ${first.hash} "${first.name}"\n 2) ${'C'.repeat(40)} "Developer ID Application: Example"\n 2 valid identities found`
  assert.deepEqual(developmentIdentities(output), [first])
})
test('selects the sole valid identity', () =>
  assert.equal(selectDevelopmentIdentity([first]), first))
test('rejects missing or ambiguous identities', () => {
  assert.throws(() => selectDevelopmentIdentity([]), /未找到/)
  assert.throws(() => selectDevelopmentIdentity([first, second]), /多个/)
})
test('selects exact names or case independent certificate fingerprints', () => {
  assert.equal(selectDevelopmentIdentity([first, second], second.name), second)
  assert.equal(selectDevelopmentIdentity([first, second], first.hash.toLowerCase()), first)
  assert.throws(() => selectDevelopmentIdentity([first], 'unavailable'), /指定的证书/)
})
test('takes Team ID from OU rather than the team member ID in the certificate name', () => {
  assert.equal(teamIdFromSubject(`CN=${first.name}\nOU=${team}\nO=Example`), team)
  assert.throws(() => teamIdFromSubject(`CN=${first.name}`), /Organizational Unit/)
})
test('constructs a team scoped local group and preserves unrelated environment settings', () => {
  const environment = { KEEP: 'value' }
  const resolved = localSigningEnvironment(environment, first, team)
  assert.equal(resolved.JIANZHANG_WIDGET_APP_GROUP, `${team}.com.jianzhang.stock`)
  assert.equal(resolved.JIANZHANG_MAC_LOCAL_SIGNING, '1')
  assert.equal(resolved.JIANZHANG_WIDGET_SIGN_IDENTITY, first.hash)
  assert.equal(resolved.KEEP, 'value')
  assert.deepEqual(environment, { KEEP: 'value' })
})
test('rejects mismatched group teams and unprovisioned group prefix in local mode', () => {
  assert.throws(
    () => localSigningEnvironment({ JIANZHANG_WIDGET_TEAM_ID: 'Z9Y8X7W6V5' }, first, team),
    /不一致/
  )
  assert.throws(
    () => localSigningEnvironment({ JIANZHANG_WIDGET_APP_GROUP: 'group.com.example' }, first, team),
    /App Group/
  )
  assert.throws(
    () => localSigningEnvironment({ JIANZHANG_WIDGET_APP_GROUP: `${team}.bad/path` }, first, team),
    /App Group/
  )
})
test('accepts a custom local group scoped to the selected team', () => {
  const group = `${team}.com.example.local`
  assert.equal(
    localSigningEnvironment({ JIANZHANG_WIDGET_APP_GROUP: group }, first, team)
      .JIANZHANG_WIDGET_APP_GROUP,
    group
  )
})

test('defaults to the current architecture and disables publishing', () => {
  assert.deepEqual(localBuildArguments(['--mac'], 'arm64'), [
    '--mac',
    '--arm64',
    '--publish',
    'never'
  ])
  assert.deepEqual(localBuildArguments(['--mac'], 'x64'), ['--mac', '--x64', '--publish', 'never'])
})
test('keeps an explicit supported architecture', () => {
  assert.deepEqual(localBuildArguments(['--mac', '--x64'], 'arm64'), [
    '--mac',
    '--x64',
    '--publish',
    'never'
  ])
})
test('rejects publishing aliases and unsupported architectures', () => {
  for (const argument of [
    '--publish',
    '--publish=always',
    '-p',
    '-p=always',
    '--universal',
    '--ia32'
  ]) {
    assert.throws(() => localBuildArguments(['--mac', argument], 'arm64'))
  }
})
