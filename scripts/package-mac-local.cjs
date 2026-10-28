const { resolveLocalSigning, localBuildArguments } = require('./mac-local-signing.cjs')

try {
  const environment = resolveLocalSigning()
  Object.assign(process.env, environment)
  console.info(`使用本机 Apple Development 签名，Team ID: ${environment.JIANZHANG_WIDGET_TEAM_ID}`)
  console.info('这是本机开发测试包；不执行公证或上传发布。')
  process.argv = [
    ...process.argv.slice(0, 2),
    ...localBuildArguments(process.argv.slice(2), process.arch)
  ]
  require('./package-mac.cjs')
} catch (reason) {
  console.error(reason instanceof Error ? reason.message : reason)
  process.exitCode = 1
}
