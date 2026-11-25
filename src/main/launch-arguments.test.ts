import assert from 'node:assert/strict'
import test from 'node:test'

import { frozenLaunchArguments } from './launch-arguments.ts'

test('新冻结版只追加独立缓存目录，不再关闭 Steam', () => {
  assert.deepEqual(frozenLaunchArguments(undefined, 'E:\\Vault\\cache'), ['-cachedir=E:\\Vault\\cache'])
})

test('旧配置会移除 nosteam、更新缓存目录并保留其他参数', () => {
  assert.deepEqual(
    frozenLaunchArguments(['-nosteam', '-cachedir=E:\\Old\\cache', '-debug'], 'E:\\Vault\\cache'),
    ['-cachedir=E:\\Vault\\cache', '-debug']
  )
})

test('重复缓存参数只保留一个受管路径', () => {
  assert.deepEqual(
    frozenLaunchArguments(['-CACHEdir=E:\\One', '-cachedir=E:\\Two'], 'E:\\Vault\\cache'),
    ['-cachedir=E:\\Vault\\cache']
  )
})
