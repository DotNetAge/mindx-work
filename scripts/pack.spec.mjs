// pack.mjs 纯函数 spec：node --test scripts/ 执行（DSH 启示：仓库脚本的关键逻辑同受测试）
import test from 'node:test'
import assert from 'node:assert/strict'
import { versionFromTag, parsePackArgs } from './pack.mjs'

test('versionFromTag：去 v 前缀', () => {
  assert.equal(versionFromTag('v0.1.0'), '0.1.0')
})

test('versionFromTag：无前缀纯版本号原样返回', () => {
  assert.equal(versionFromTag('1.2.3'), '1.2.3')
})

test('versionFromTag：非版本号 tag 返回 null（由调用方回退）', () => {
  assert.equal(versionFromTag('mindx-work-v3'), null)
  assert.equal(versionFromTag('beta'), null)
})

test('parsePackArgs：--dry-run 过滤出 electron-builder 参数并置 dryRun 标志', () => {
  const r = parsePackArgs(['--mac', '--dry-run'])
  assert.deepEqual(r, { args: ['--mac'], dryRun: true })
})

test('parsePackArgs：无 --dry-run 时原样透传', () => {
  const r = parsePackArgs(['--mac', '--win', '--linux'])
  assert.deepEqual(r, { args: ['--mac', '--win', '--linux'], dryRun: false })
})
