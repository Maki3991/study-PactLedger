import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasOperators, parseOperatorMap, resolveOperator } from './operators.js'

test('parseOperatorMap 解析多条映射', () => {
  const operators = parseOperatorMap('123456789:a1b2c3d4, 987654321:e5f6g7h8')
  assert.equal(operators.byTelegramId.size, 2)
  assert.equal(resolveOperator(operators, 123456789), 'a1b2c3d4')
  assert.equal(resolveOperator(operators, '987654321'), 'e5f6g7h8')
  assert.equal(operators.invalidEntryCount, 0)
})

test('parseOperatorMap 对空配置 fail closed', () => {
  for (const raw of [undefined, '', '   ', ',,']) {
    const operators = parseOperatorMap(raw)
    assert.equal(hasOperators(operators), false, `${JSON.stringify(raw)} 应视为无授权用户`)
  }
})

test('parseOperatorMap 跳过非法条目并计数', () => {
  const operators = parseOperatorMap('123:ok,notanumber:x,456,:empty,789:')
  assert.equal(operators.byTelegramId.size, 1)
  assert.equal(resolveOperator(operators, 123), 'ok')
  assert.equal(operators.invalidEntryCount, 4)
})

test('resolveOperator 拒绝名单外用户', () => {
  const operators = parseOperatorMap('123:ok')
  assert.equal(resolveOperator(operators, 999), undefined)
  assert.equal(resolveOperator(operators, undefined), undefined)
})

test('parseOperatorMap 后者覆盖同一 Telegram ID', () => {
  const operators = parseOperatorMap('123:first,123:second')
  assert.equal(resolveOperator(operators, 123), 'second')
})

test('parseOperatorMap 拒绝含非法字符的 KaleidoX userId', () => {
  const operators = parseOperatorMap('123:has space,456:has:colon,789:ok_id-1')
  assert.equal(resolveOperator(operators, 789), 'ok_id-1')
  assert.equal(resolveOperator(operators, 123), undefined)
  assert.equal(resolveOperator(operators, 456), undefined)
})
