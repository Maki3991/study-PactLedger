import assert from 'node:assert/strict'
import test from 'node:test'
import { getPandaConfigStatus, readPandaDataConfig } from './panda.js'

test('PandaData defaults to explicit replay mode when credentials are absent', () => {
  const status = getPandaConfigStatus(readPandaDataConfig({}))
  assert.equal(status.provider, 'replay')
  assert.equal(status.ready, true)
  assert.equal(status.sourceMethod, 'get_stock_daily_pre')
  assert.equal(status.sdkVersion, '0.0.12')
  assert.equal(status.skill, 'QuantSkills/pandadata-api')
  assert.deepEqual(status.missing, ['PANDA_DATA_USERNAME', 'PANDA_DATA_PASSWORD'])
})

test('PandaData switches to live provider when credentials are configured', () => {
  const config = readPandaDataConfig({
    PANDA_DATA_USERNAME: '13800138000',
    PANDA_DATA_PASSWORD: 'secret',
  })
  const status = getPandaConfigStatus(config)
  assert.equal(config.username, '8613800138000')
  assert.equal(status.provider, 'panda-data')
  assert.equal(status.credentialsConfigured, true)
  assert.deepEqual(status.missing, [])
})

test('PandaData keeps an already normalized international username unchanged', () => {
  const config = readPandaDataConfig({
    PANDA_DATA_USERNAME: '8613800138000',
    PANDA_DATA_PASSWORD: 'secret',
  })
  assert.equal(config.username, '8613800138000')
})
