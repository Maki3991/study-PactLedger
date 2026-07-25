import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BOT_COMMANDS, parseClaimCommand, parseNewPoolCommand } from './commands.js'

test('parseNewPoolCommand 解析份数、单价和商品', () => {
  assert.deepEqual(parseNewPoolCommand('/pool_new 3 89 杨梅'), {
    product: '杨梅',
    priceEach: 89,
    slotsTotal: 3,
  })
})

test('parseNewPoolCommand 接受小数单价和带空格的商品名', () => {
  assert.deepEqual(parseNewPoolCommand('/pool_new 4 12.50 冰镇 西瓜'), {
    product: '冰镇 西瓜',
    priceEach: 12.5,
    slotsTotal: 4,
  })
})

test('parseNewPoolCommand 兼容 @botname 后缀和中文逗号', () => {
  assert.deepEqual(parseNewPoolCommand('/pool_new@pactledger_bot 2，30，苹果'), {
    product: '苹果',
    priceEach: 30,
    slotsTotal: 2,
  })
})

test('parseNewPoolCommand 拒绝超出 service 校验范围的输入', () => {
  // service.validateRequest: slotsTotal 2..20, 0 < priceEach <= 500
  assert.equal(parseNewPoolCommand('/pool_new 1 89 杨梅'), undefined)
  assert.equal(parseNewPoolCommand('/pool_new 21 89 杨梅'), undefined)
  assert.equal(parseNewPoolCommand('/pool_new 3 501 杨梅'), undefined)
  assert.equal(parseNewPoolCommand('/pool_new 3 0 杨梅'), undefined)
})

test('parseNewPoolCommand 拒绝缺少参数的输入', () => {
  assert.equal(parseNewPoolCommand('/pool_new'), undefined)
  assert.equal(parseNewPoolCommand('/pool_new 3'), undefined)
  assert.equal(parseNewPoolCommand('/pool_new 3 89'), undefined)
  assert.equal(parseNewPoolCommand('/pool_new 杨梅 89 3'), undefined)
})

test('parseClaimCommand 缺省一份', () => {
  assert.deepEqual(parseClaimCommand('/pool_claim'), { slots: 1 })
})

test('parseClaimCommand 读取显式份数', () => {
  assert.deepEqual(parseClaimCommand('/pool_claim 2'), { slots: 2 })
  assert.deepEqual(parseClaimCommand('/pool_claim@pactledger_bot 3'), { slots: 3 })
})

test('parseClaimCommand 拒绝非法份数', () => {
  assert.equal(parseClaimCommand('/pool_claim 0'), undefined)
  assert.equal(parseClaimCommand('/pool_claim -1'), undefined)
  assert.equal(parseClaimCommand('/pool_claim 两份'), undefined)
  assert.equal(parseClaimCommand('/pool_claim 21'), undefined)
})

test('BOT_COMMANDS 满足 Telegram setMyCommands 的格式约束', () => {
  assert.ok(BOT_COMMANDS.length > 0)
  for (const { command, description } of BOT_COMMANDS) {
    assert.match(command, /^[a-z0-9_]{1,32}$/, `${command} 不是合法命令名`)
    assert.ok(description.length > 0 && description.length <= 256)
  }
  const names = BOT_COMMANDS.map((entry) => entry.command)
  assert.equal(new Set(names).size, names.length, '命令名重复')
})
