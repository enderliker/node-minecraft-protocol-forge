/* eslint-env mocha */
'use strict'

const assert = require('assert')
const EventEmitter = require('events')
const { neoForgeHandshake } = require('../index')

describe('neoForgeHandshake', function () {
  let mockClient
  let writtenPackets

  beforeEach(function () {
    writtenPackets = []
    mockClient = new EventEmitter()
    mockClient.state = 'login'
    mockClient.write = function (name, params) {
      writtenPackets.push({ name, params })
    }
  })

  it('registers NeoForge channels on entering configuration state', function (done) {
    neoForgeHandshake(mockClient)

    mockClient.emit('state', 'configuration')

    assert.strictEqual(writtenPackets.length, 1)
    assert.strictEqual(writtenPackets[0].name, 'custom_payload')
    assert.strictEqual(writtenPackets[0].params.channel, 'minecraft:register')

    const registered = writtenPackets[0].params.data.toString().split('\0')
    assert(registered.includes('neoforge:modded_network'))
    assert(registered.includes('neoforge:modded_network_query'))
    done()
  })

  it('registers NeoForge channels immediately if client is already in configuration state', function () {
    mockClient.state = 'configuration'
    neoForgeHandshake(mockClient)

    assert.strictEqual(writtenPackets.length, 1)
    assert.strictEqual(writtenPackets[0].name, 'custom_payload')
    assert.strictEqual(writtenPackets[0].params.channel, 'minecraft:register')
  })

  it('auto-negotiates channels from neoforge:modded_network_query', function (done) {
    neoForgeHandshake(mockClient)

    const queryData = {
      queries: [
        {
          protocol: 'configuration',
          components: [
            {
              id: 'neoforge:early_display',
              version: '1',
              flow: undefined,
              optional: true
            }
          ]
        },
        {
          protocol: 'play',
          components: [
            {
              id: 'mymod:teleport_channel',
              version: '1.2.3',
              flow: 'serverbound',
              optional: false
            }
          ]
        }
      ]
    }

    const queryBuffer = neoForgeHandshake.proto.createPacketBuffer('neoforge_modded_network_query', queryData)

    mockClient.once('neoforge_negotiated', (negotiated) => {
      assert.strictEqual(negotiated.channels.length, 2)
      assert.strictEqual(negotiated.channels[0].protocol, 'configuration')
      assert.strictEqual(negotiated.channels[0].channels[0].key, 'neoforge:early_display')
      assert.strictEqual(negotiated.channels[0].channels[0].value.chosenVersion, '1')

      assert.strictEqual(negotiated.channels[1].protocol, 'play')
      assert.strictEqual(negotiated.channels[1].channels[0].key, 'mymod:teleport_channel')
      assert.strictEqual(negotiated.channels[1].channels[0].value.chosenVersion, '1.2.3')

      // Verify the client wrote the custom_payload response
      const responsePacket = writtenPackets.find(p => p.params && p.params.channel === 'neoforge:modded_network')
      assert(responsePacket, 'neoforge:modded_network packet was sent')

      const decoded = neoForgeHandshake.proto.parsePacketBuffer('neoforge_modded_network', responsePacket.params.data).data
      assert.strictEqual(decoded.channels.length, 2)
      assert.strictEqual(decoded.channels[0].channels[0].value.chosenVersion, '1')
      assert.strictEqual(decoded.channels[1].channels[0].value.chosenVersion, '1.2.3')

      done()
    })

    mockClient.emit('custom_payload', {
      channel: 'neoforge:modded_network_query',
      data: queryBuffer
    })
  })

  it('respects user-specified channel version overrides', function (done) {
    neoForgeHandshake(mockClient, {
      channels: {
        'mymod:teleport_channel': '2.0.0-custom'
      }
    })

    const queryData = {
      queries: [
        {
          protocol: 'play',
          components: [
            {
              id: 'mymod:teleport_channel',
              version: '1.0.0',
              flow: undefined,
              optional: false
            }
          ]
        }
      ]
    }

    const queryBuffer = neoForgeHandshake.proto.createPacketBuffer('neoforge_modded_network_query', queryData)

    mockClient.once('neoforge_negotiated', (negotiated) => {
      assert.strictEqual(negotiated.channels[0].channels[0].value.chosenVersion, '2.0.0-custom')
      done()
    })

    mockClient.emit('custom_payload', {
      channel: 'neoforge:modded_network_query',
      data: queryBuffer
    })
  })

  it('emits error on invalid query packet buffer', function (done) {
    neoForgeHandshake(mockClient)

    mockClient.once('error', (err) => {
      assert(err instanceof Error)
      assert(err.message.includes('NeoForge network query'))
      done()
    })

    mockClient.emit('custom_payload', {
      channel: 'neoforge:modded_network_query',
      data: Buffer.from([0xff, 0xff])
    })
  })

  it('responds to configuration ping with pong', function () {
    neoForgeHandshake(mockClient)

    mockClient.emit('ping', { id: 42 })

    const pong = writtenPackets.find(p => p.name === 'pong')
    assert(pong, 'pong packet was sent')
    assert.strictEqual(pong.params.id, 42)
  })

  it('responds to c:version with supported version 1', function () {
    neoForgeHandshake(mockClient)

    mockClient.emit('custom_payload', {
      channel: 'c:version',
      data: Buffer.from([0x01, 0x01])
    })

    const versionPkt = writtenPackets.find(p => p.name === 'custom_payload' && p.params.channel === 'c:version')
    assert(versionPkt, 'c:version response was sent')
    assert.deepStrictEqual(Array.from(versionPkt.params.data), [0x01, 0x01])
  })

  it('responds to c:register with common_register payload', function (done) {
    neoForgeHandshake(mockClient)

    mockClient.once('neoforge_common_registered', (event) => {
      assert(event.channels.includes('jade:server_ping_v1'))

      const regPkt = writtenPackets.find(p => p.name === 'custom_payload' && p.params.channel === 'c:register')
      assert(regPkt, 'c:register response was sent')

      const parsed = neoForgeHandshake.proto.parsePacketBuffer('common_register', regPkt.params.data).data
      assert.strictEqual(parsed.version, 1)
      assert.strictEqual(parsed.protocol, 'play')
      assert(parsed.channels.includes('jade:server_ping_v1'))
      done()
    })

    const sampleCRegister = neoForgeHandshake.proto.createPacketBuffer('common_register', {
      version: 1,
      protocol: 'play',
      channels: ['jade:server_ping_v1', 'jade:request_block']
    })

    mockClient.emit('custom_payload', {
      channel: 'c:register',
      data: sampleCRegister
    })
  })

  it('responds to neoforge:extensible_enum_data with neoforge:extensible_enum_ack', function () {
    neoForgeHandshake(mockClient)

    mockClient.emit('custom_payload', {
      channel: 'neoforge:extensible_enum_data',
      data: Buffer.from([0x00])
    })

    const ackPkt = writtenPackets.find(p => p.name === 'custom_payload' && p.params.channel === 'neoforge:extensible_enum_ack')
    assert(ackPkt, 'extensible_enum_ack was sent')
    assert.strictEqual(ackPkt.params.data.length, 0)
  })

  it('sanitizes invalid modded command tree in declare_commands', function () {
    neoForgeHandshake(mockClient)

    const invalidPacket = {
      nodes: [
        { flags: { command_node_type: 0 }, children: [999] } // references nonexistent node 999
      ],
      rootIndex: 0
    }

    mockClient.emit('declare_commands', invalidPacket)

    assert.strictEqual(invalidPacket.nodes.length, 1)
    assert.deepStrictEqual(invalidPacket.nodes[0].children, [])
  })
})
