import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BOT_COMMANDS, parseResearchCommand, parseTaskIdCommand } from './commands.js'

test('parseResearchCommand 解析完整参数', () => {
  assert.deepEqual(parseResearchCommand('/research NVDA.US 5000 15 30 评估财报后的动量策略'), {
    asset: 'NVDA.US',
    budgetUsdt: 5000,
    maxLossPct: 15,
    maxAssetPct: 30,
    objective: '评估财报后的动量策略',
  })
})

test('parseResearchCommand 兼容 @botname 与小数', () => {
  const parsed = parseResearchCommand('/research@kaleidox_bot TSLA.US 1200.5 0.5 100 检验特斯拉均值回归假设')
  assert.equal(parsed?.budgetUsdt, 1200.5)
  assert.equal(parsed?.maxLossPct, 0.5)
  assert.equal(parsed?.maxAssetPct, 100)
})

test('parseResearchCommand 边界与 /api/tasks schema 对齐', () => {
  // budgetUsdt >= 1
  assert.equal(parseResearchCommand('/research NVDA.US 0 15 30 评估动量策略表现'), undefined)
  // maxLossPct 0.1..100
  assert.equal(parseResearchCommand('/research NVDA.US 5000 0 30 评估动量策略表现'), undefined)
  assert.equal(parseResearchCommand('/research NVDA.US 5000 101 30 评估动量策略表现'), undefined)
  // maxAssetPct 1..100
  assert.equal(parseResearchCommand('/research NVDA.US 5000 15 0 评估动量策略表现'), undefined)
  assert.equal(parseResearchCommand('/research NVDA.US 5000 15 101 评估动量策略表现'), undefined)
  // objective minLength 8
  assert.equal(parseResearchCommand('/research NVDA.US 5000 15 30 太短'), undefined)
  // asset 6..16
  assert.equal(parseResearchCommand('/research AB 5000 15 30 评估动量策略表现'), undefined)
  assert.equal(parseResearchCommand('/research ABCDEFGHIJKLMNOPQ 5000 15 30 评估动量策略表现'), undefined)
})

test('parseResearchCommand 拒绝缺参与非数字', () => {
  assert.equal(parseResearchCommand('/research'), undefined)
  assert.equal(parseResearchCommand('/research NVDA.US 5000 15 30'), undefined)
  assert.equal(parseResearchCommand('/research NVDA.US 五千 15 30 评估动量策略表现'), undefined)
  assert.equal(parseResearchCommand('/research NVDA.US -100 15 30 评估动量策略表现'), undefined)
})

test('parseTaskIdCommand 提取标识', () => {
  assert.equal(parseTaskIdCommand('/task KX-260725-AB12', 'task'), 'KX-260725-AB12')
  assert.equal(parseTaskIdCommand('/approve@kaleidox_bot abc123', 'approve'), 'abc123')
  assert.equal(parseTaskIdCommand('/history', 'history'), undefined)
  assert.equal(parseTaskIdCommand('/execute bad id', 'execute'), 'bad')
})

test('parseTaskIdCommand 拒绝非法字符', () => {
  assert.equal(parseTaskIdCommand('/task ../etc/passwd', 'task'), undefined)
  assert.equal(parseTaskIdCommand("/task a'b", 'task'), undefined)
})

test('BOT_COMMANDS 满足 Telegram setMyCommands 约束', () => {
  assert.ok(BOT_COMMANDS.length > 0)
  for (const { command, description } of BOT_COMMANDS) {
    assert.match(command, /^[a-z0-9_]{1,32}$/, `${command} 不是合法命令名`)
    assert.ok(description.length > 0 && description.length <= 256)
  }
  const names = BOT_COMMANDS.map((entry) => entry.command)
  assert.equal(new Set(names).size, names.length, '命令名重复')
})
