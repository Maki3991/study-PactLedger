import assert from 'node:assert/strict'
import test from 'node:test'
import { getPandaConfigStatus, readPandaDataConfig } from './panda.js'

test('PandaData defaults to explicit replay mode when credentials are absent', () => {
  const status = getPandaConfigStatus(readPandaDataConfig({}))
  assert.equal(status.provider, 'replay')
  assert.equal(status.ready, true)
  assert.deepEqual(status.missing, ['PANDA_DATA_USERNAME', 'PANDA_DATA_PASSWORD'])
})

test('PandaData switches to live provider when credentials are configured', () => {
  const status = getPandaConfigStatus(readPandaDataConfig({
    PANDA_DATA_USERNAME: '86-phone',
    PANDA_DATA_PASSWORD: 'secret',
  }))
  assert.equal(status.provider, 'panda-data')
  assert.equal(status.credentialsConfigured, true)
  assert.deepEqual(status.missing, [])
})
