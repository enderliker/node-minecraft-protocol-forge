/* eslint-env mocha */
'use strict'

const assert = require('assert')
const ProtoDef = require('protodef').ProtoDef
const neoforgeData = require('../src/client/data/neoforge.json')

describe('NeoForge ProtoDef schema', function () {
  let proto

  beforeEach(function () {
    proto = new ProtoDef(false)
    proto.addType('string', [
      'pstring',
      {
        countType: 'varint'
      }
    ])
    proto.addTypes({
      restBuffer: [
        (buffer, offset) => {
          return {
            value: buffer.slice(offset),
            size: buffer.length - offset
          }
        },
        (value, buffer, offset) => {
          value.copy(buffer, offset)
          return offset + value.length
        },
        (value) => {
          return value.length
        }
      ]
    })
    proto.addProtocol(neoforgeData, ['neoforge'])
  })

  it('serializes and deserializes neoforge:modded_network_query', function () {
    const sampleQuery = {
      queries: [
        {
          protocol: 'configuration',
          components: [
            {
              id: 'neoforge:early_display',
              version: '1',
              flow: undefined,
              optional: true
            },
            {
              id: 'mymod:network_channel',
              version: '1.0.0',
              flow: 'serverbound',
              optional: false
            }
          ]
        },
        {
          protocol: 'play',
          components: [
            {
              id: 'mymod:play_channel',
              version: '2.0.0',
              flow: 'clientbound',
              optional: false
            }
          ]
        }
      ]
    }

    const buffer = proto.createPacketBuffer('neoforge_modded_network_query', sampleQuery)
    assert(Buffer.isBuffer(buffer))
    assert(buffer.length > 0)

    const parsed = proto.parsePacketBuffer('neoforge_modded_network_query', buffer).data
    assert.strictEqual(parsed.queries.length, 2)
    assert.strictEqual(parsed.queries[0].protocol, 'configuration')
    assert.strictEqual(parsed.queries[0].components.length, 2)
    assert.strictEqual(parsed.queries[0].components[0].id, 'neoforge:early_display')
    assert.strictEqual(parsed.queries[0].components[0].version, '1')
    assert.strictEqual(parsed.queries[0].components[0].optional, true)
    assert.strictEqual(parsed.queries[0].components[0].flow, undefined)

    assert.strictEqual(parsed.queries[0].components[1].id, 'mymod:network_channel')
    assert.strictEqual(parsed.queries[0].components[1].version, '1.0.0')
    assert.strictEqual(parsed.queries[0].components[1].flow, 'serverbound')
    assert.strictEqual(parsed.queries[0].components[1].optional, false)

    assert.strictEqual(parsed.queries[1].protocol, 'play')
    assert.strictEqual(parsed.queries[1].components[0].id, 'mymod:play_channel')
    assert.strictEqual(parsed.queries[1].components[0].version, '2.0.0')
    assert.strictEqual(parsed.queries[1].components[0].flow, 'clientbound')
  })

  it('serializes and deserializes neoforge:modded_network', function () {
    const sampleSetup = {
      channels: [
        {
          protocol: 'configuration',
          channels: [
            {
              key: 'neoforge:early_display',
              value: {
                id: 'neoforge:early_display',
                chosenVersion: '1'
              }
            }
          ]
        },
        {
          protocol: 'play',
          channels: [
            {
              key: 'mymod:play_channel',
              value: {
                id: 'mymod:play_channel',
                chosenVersion: '2.0.0'
              }
            }
          ]
        }
      ]
    }

    const buffer = proto.createPacketBuffer('neoforge_modded_network', sampleSetup)
    assert(Buffer.isBuffer(buffer))
    assert(buffer.length > 0)

    const parsed = proto.parsePacketBuffer('neoforge_modded_network', buffer).data
    assert.strictEqual(parsed.channels.length, 2)
    assert.strictEqual(parsed.channels[0].protocol, 'configuration')
    assert.strictEqual(parsed.channels[0].channels.length, 1)
    assert.strictEqual(parsed.channels[0].channels[0].key, 'neoforge:early_display')
    assert.strictEqual(parsed.channels[0].channels[0].value.id, 'neoforge:early_display')
    assert.strictEqual(parsed.channels[0].channels[0].value.chosenVersion, '1')

    assert.strictEqual(parsed.channels[1].protocol, 'play')
    assert.strictEqual(parsed.channels[1].channels[0].key, 'mymod:play_channel')
    assert.strictEqual(parsed.channels[1].channels[0].value.chosenVersion, '2.0.0')
  })

  it('serializes and deserializes neoforge:modded_network_setup_failed', function () {
    const sampleFailure = {
      failureReasons: [
        {
          channel: 'mymod:mandatory_channel',
          reason: 'Channel version mismatch: required 2.0.0 but got 1.0.0'
        }
      ]
    }

    const buffer = proto.createPacketBuffer('neoforge_modded_network_setup_failed', sampleFailure)
    assert(Buffer.isBuffer(buffer))

    const parsed = proto.parsePacketBuffer('neoforge_modded_network_setup_failed', buffer).data
    assert.strictEqual(parsed.failureReasons.length, 1)
    assert.strictEqual(parsed.failureReasons[0].channel, 'mymod:mandatory_channel')
    assert.strictEqual(parsed.failureReasons[0].reason, 'Channel version mismatch: required 2.0.0 but got 1.0.0')
  })

  it('serializes and deserializes known_registry_data_maps and reply', function () {
    const sampleQuery = {
      registries: [
        {
          registry: 'minecraft:block',
          dataMaps: [
            { id: 'create:catalysts', mandatory: true }
          ]
        }
      ]
    }
    const buf = proto.createPacketBuffer('known_registry_data_maps', sampleQuery)
    const parsed = proto.parsePacketBuffer('known_registry_data_maps', buf).data
    assert.strictEqual(parsed.registries.length, 1)
    assert.strictEqual(parsed.registries[0].registry, 'minecraft:block')
    assert.strictEqual(parsed.registries[0].dataMaps[0].id, 'create:catalysts')
    assert.strictEqual(parsed.registries[0].dataMaps[0].mandatory, true)

    const reply = {
      registries: [
        {
          registry: 'minecraft:block',
          dataMaps: ['create:catalysts']
        }
      ]
    }
    const replyBuf = proto.createPacketBuffer('known_registry_data_maps_reply', reply)
    const replyParsed = proto.parsePacketBuffer('known_registry_data_maps_reply', replyBuf).data
    assert.strictEqual(replyParsed.registries[0].dataMaps[0], 'create:catalysts')
  })
})
