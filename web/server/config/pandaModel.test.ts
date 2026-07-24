import assert from 'node:assert/strict'
import test from 'node:test'
import { getPandaModelStatus, readPandaModelConfig } from './pandaModel.js'

test('DeepSeek V4 Pro is the preferred PandaAI model when the competition token is configured', () => {
  const config = readPandaModelConfig({
    DEEPSEEK_API_KEY: 'deepseek-secret',
    ARK_API_KEY: 'ark-secret',
  })
  const status = getPandaModelStatus(config)

  assert.equal(config.provider, 'deepseek')
  assert.equal(config.endpointId, 'deepseek-v4-pro')
  assert.equal(config.baseUrl, 'https://api.deepseek.com')
  assert.equal(status.provider, 'deepseek')
  assert.equal(status.configured, true)
  assert.deepEqual(status.missing, [])
})

test('ARK remains a supported fallback when no DeepSeek token exists', () => {
  const config = readPandaModelConfig({
    ARK_API_KEY: 'ark-secret',
    PANDA_MODEL_ENDPOINT_ID: 'ep-demo',
  })
  assert.equal(config.provider, 'ark')
  assert.equal(config.endpointId, 'ep-demo')
})

test('missing model credentials are reported against the required DeepSeek token', () => {
  const status = getPandaModelStatus(readPandaModelConfig({}))
  assert.equal(status.provider, 'template')
  assert.equal(status.endpointId, 'deepseek-v4-pro')
  assert.deepEqual(status.missing, ['DEEPSEEK_API_KEY'])
})
