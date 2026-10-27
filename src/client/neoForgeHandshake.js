'use strict'

const ProtoDef = require('protodef').ProtoDef
const debug = require('../../debug')
const neoforgeData = require('./data/neoforge.json')

const proto = new ProtoDef(false)
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

const NEOFORGE_CHANNELS = {
  MODDED_NETWORK_QUERY: 'neoforge:modded_network_query',
  MODDED_NETWORK: 'neoforge:modded_network',
  MODDED_NETWORK_SETUP_FAILED: 'neoforge:modded_network_setup_failed',
  REGISTER: 'minecraft:register'
}

/**
 * NeoForge 1.21.1+ Handshake & Channel Negotiation handler.
 * Runs during the Minecraft configuration phase.
 *
 * @param {import('minecraft-protocol').Client} client Client connecting to the NeoForge server.
 * @param {{
 *   channels?: Object.<string, string>,
 *   mods?: Array.<{ modid: string, version?: string }> | Object.<string, string>,
 *   autoNegotiate?: boolean
 * }} [options={}]
 */
function neoForgeHandshake (client, options = {}) {
  const autoNegotiate = options.autoNegotiate !== false
  const userChannels = options.channels || {}
  const userMods = options.mods || {}

  debug('NeoForge handshake plugin attached')

  function registerNeoForgeChannels () {
    const channels = [
      NEOFORGE_CHANNELS.MODDED_NETWORK,
      NEOFORGE_CHANNELS.MODDED_NETWORK_QUERY,
      NEOFORGE_CHANNELS.MODDED_NETWORK_SETUP_FAILED
    ]
    const data = Buffer.from(channels.join('\0'))
    try {
      client.write('custom_payload', {
        channel: NEOFORGE_CHANNELS.REGISTER,
        data
      })
      debug('Registered NeoForge channels via minecraft:register')
    } catch (err) {
      debug('Could not send channel registration (may not be connected yet):', err.message)
    }
  }

  // Hook into configuration state transitions
  if (client.state === 'configuration') {
    registerNeoForgeChannels()
  }

  client.on('state', function (newState) {
    if (newState === 'configuration') {
      registerNeoForgeChannels()
    }
  })

  // Listen for custom_payload packets from the server
  client.on('custom_payload', function (packet) {
    if (packet.channel === NEOFORGE_CHANNELS.MODDED_NETWORK_QUERY) {
      debug('Received neoforge:modded_network_query')
      handleNetworkQuery(packet.data)
    }
  })

  function handleNetworkQuery (buffer) {
    let query
    try {
      query = proto.parsePacketBuffer('neoforge_modded_network_query', buffer).data
    } catch (err) {
      debug('Failed to parse neoforge:modded_network_query buffer:', err)
      client.emit('error', new Error(`Failed to parse NeoForge network query: ${err.message}`))
      return
    }

    debug('Processing NeoForge query with %d protocol sections', query.queries ? query.queries.length : 0)

    const negotiatedProtocols = []

    for (const protoQuery of (query.queries || [])) {
      const protocolName = protoQuery.protocol
      const channelEntries = []

      for (const comp of (protoQuery.components || [])) {
        const channelId = comp.id
        let chosenVersion = null

        // Check explicit channel configuration
        if (Object.prototype.hasOwnProperty.call(userChannels, channelId)) {
          chosenVersion = userChannels[channelId]
        } else if (Array.isArray(userMods)) {
          const found = userMods.find(m => m && (m.modid === channelId || channelId.startsWith(m.modid + ':')))
          if (found && found.version) chosenVersion = found.version
        } else if (typeof userMods === 'object' && userMods !== null) {
          const modKey = Object.keys(userMods).find(k => k === channelId || channelId.startsWith(k + ':'))
          if (modKey) chosenVersion = typeof userMods[modKey] === 'string' ? userMods[modKey] : userMods[modKey].version
        }

        // Auto-negotiate by adopting server's requested version
        if (chosenVersion === null && autoNegotiate) {
          chosenVersion = comp.version
        }

        if (chosenVersion !== null && chosenVersion !== undefined) {
          debug('Negotiated channel [%s] %s -> version %s', protocolName, channelId, chosenVersion)
          channelEntries.push({
            key: channelId,
            value: {
              id: channelId,
              chosenVersion: String(chosenVersion)
            }
          })
        } else if (!comp.optional) {
          debug('Required channel [%s] %s could not be satisfied', protocolName, channelId)
        }
      }

      negotiatedProtocols.push({
        protocol: protocolName,
        channels: channelEntries
      })
    }

    const setupPayload = {
      channels: negotiatedProtocols
    }

    try {
      const responseBuffer = proto.createPacketBuffer('neoforge_modded_network', setupPayload)
      client.write('custom_payload', {
        channel: NEOFORGE_CHANNELS.MODDED_NETWORK,
        data: responseBuffer
      })
      debug('Sent neoforge:modded_network response payload')
      client.emit('neoforge_negotiated', setupPayload)
    } catch (err) {
      debug('Failed to encode neoforge:modded_network response:', err)
      client.emit('error', new Error(`Failed to encode NeoForge setup response: ${err.message}`))
    }
  }
}

neoForgeHandshake.proto = proto
neoForgeHandshake.CHANNELS = NEOFORGE_CHANNELS

module.exports = neoForgeHandshake
