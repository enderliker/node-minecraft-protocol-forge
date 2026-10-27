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
  MODDED_NETWORK: 'neoforge:network',
  MODDED_NETWORK_LEGACY: 'neoforge:modded_network',
  MODDED_NETWORK_SETUP_FAILED: 'neoforge:modded_network_setup_failed',
  REGISTER: 'neoforge:register',
  EXTENSIBLE_ENUM_DATA: 'neoforge:extensible_enum_data',
  EXTENSIBLE_ENUM_ACK: 'neoforge:extensible_enum_ack',
  FEATURE_FLAG_DATA: 'neoforge:feature_flag_data',
  FEATURE_FLAG_ACK: 'neoforge:feature_flag_acknowledge',
  KNOWN_DATA_MAPS: 'neoforge:known_registry_data_maps',
  KNOWN_DATA_MAPS_REPLY: 'neoforge:known_registry_data_maps_reply',
  SPLIT: 'neoforge:split',
  CONFIG_FILE: 'neoforge:config_file',
  COMMON_VERSION: 'c:version',
  COMMON_REGISTER: 'c:register',
  MINECRAFT_REGISTER: 'minecraft:register',
  MINECRAFT_UNREGISTER: 'minecraft:unregister'
}

const DEFAULT_KNOWN_CHANNELS = [
  NEOFORGE_CHANNELS.REGISTER,
  NEOFORGE_CHANNELS.MODDED_NETWORK,
  NEOFORGE_CHANNELS.MODDED_NETWORK_LEGACY,
  NEOFORGE_CHANNELS.MODDED_NETWORK_QUERY,
  NEOFORGE_CHANNELS.MODDED_NETWORK_SETUP_FAILED,
  NEOFORGE_CHANNELS.EXTENSIBLE_ENUM_DATA,
  NEOFORGE_CHANNELS.EXTENSIBLE_ENUM_ACK,
  NEOFORGE_CHANNELS.FEATURE_FLAG_DATA,
  NEOFORGE_CHANNELS.FEATURE_FLAG_ACK,
  NEOFORGE_CHANNELS.KNOWN_DATA_MAPS,
  NEOFORGE_CHANNELS.KNOWN_DATA_MAPS_REPLY,
  NEOFORGE_CHANNELS.SPLIT,
  NEOFORGE_CHANNELS.CONFIG_FILE,
  NEOFORGE_CHANNELS.COMMON_VERSION,
  NEOFORGE_CHANNELS.COMMON_REGISTER
]

/**
 * NeoForge 1.21.1+ Handshake & Channel Negotiation handler.
 * Runs during the Minecraft configuration phase.
 *
 * @param {import('minecraft-protocol').Client} client Client connecting to the NeoForge server.
 * @param {{
 *   channels?: Object.<string, string> | string[],
 *   mods?: Array.<{ modid: string, version?: string }> | Object.<string, string>,
 *   autoNegotiate?: boolean
 * }} [options={}]
 */
function neoForgeHandshake (client, options = {}) {
  const autoNegotiate = options.autoNegotiate !== false
  const userChannels = options.channels || {}
  const userMods = options.mods || {}

  debug('NeoForge handshake plugin attached')

  const knownChannels = new Set(DEFAULT_KNOWN_CHANNELS)

  // Add any explicitly provided user channels
  if (Array.isArray(userChannels)) {
    for (const ch of userChannels) {
      if (typeof ch === 'string' && ch) knownChannels.add(ch)
    }
  } else if (typeof userChannels === 'object' && userChannels !== null) {
    for (const ch of Object.keys(userChannels)) {
      if (ch) knownChannels.add(ch)
    }
  }

  // Add user mod ids as namespace channels if applicable
  if (Array.isArray(userMods)) {
    for (const m of userMods) {
      if (m && m.modid) knownChannels.add(`${m.modid}:main`)
    }
  } else if (typeof userMods === 'object' && userMods !== null) {
    for (const modId of Object.keys(userMods)) {
      if (modId) knownChannels.add(`${modId}:main`)
    }
  }

  function registerNeoForgeChannels () {
    const validChannels = Array.from(knownChannels).filter(ch => ch && !ch.includes(','))
    const data = Buffer.from(validChannels.join('\0'))
    try {
      client.write('custom_payload', {
        channel: NEOFORGE_CHANNELS.MINECRAFT_REGISTER,
        data
      })
      debug('Registered channels via minecraft:register (%d channels)', validChannels.length)
    } catch (err) {
      debug('Could not send channel registration (may not be connected yet):', err.message)
    }
  }

  // Answer ping with pong during configuration state
  client.on('ping', function (packet) {
    if (packet && typeof packet.id === 'number') {
      try {
        client.write('pong', { id: packet.id })
        debug('Replied to configuration ping id=%d with pong', packet.id)
      } catch (err) {
        debug('Could not send pong packet:', err.message)
      }
    }
  })

  // Sanitize modded declare_commands trees to prevent chat.js crashes
  if (typeof client.prependListener === 'function') {
    client.prependListener('declare_commands', function (packet) {
      if (packet && Array.isArray(packet.nodes)) {
        const totalNodes = packet.nodes.length
        const isValid = packet.nodes.every(node =>
          Array.isArray(node.children) &&
          node.children.every(child => typeof child === 'number' && child >= 0 && child < totalNodes) &&
          (node.redirectNode === undefined || (typeof node.redirectNode === 'number' && node.redirectNode >= 0 && node.redirectNode < totalNodes))
        )
        if (!isValid || packet.rootIndex === undefined || packet.rootIndex >= totalNodes) {
          debug('Sanitizing modded declare_commands packet to prevent chat validation crash')
          packet.nodes = [{ flags: { command_node_type: 0 }, children: [] }]
          packet.rootIndex = 0
        }
      }
    })
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
    const ch = packet.channel

    if (ch === NEOFORGE_CHANNELS.MINECRAFT_REGISTER || ch === NEOFORGE_CHANNELS.MINECRAFT_UNREGISTER) {
      handleMinecraftRegister(packet.data)
    } else if (ch === NEOFORGE_CHANNELS.REGISTER) {
      debug('Received neoforge:register query')
      handleNeoForgeRegister(packet.data)
    } else if (ch === NEOFORGE_CHANNELS.COMMON_VERSION) {
      debug('Received c:version query')
      handleCommonVersion(packet.data)
    } else if (ch === NEOFORGE_CHANNELS.COMMON_REGISTER) {
      debug('Received c:register query')
      handleCommonRegister(packet.data)
    } else if (ch === NEOFORGE_CHANNELS.EXTENSIBLE_ENUM_DATA) {
      debug('Received neoforge:extensible_enum_data')
      handleExtensibleEnumData(packet.data)
    } else if (ch === NEOFORGE_CHANNELS.FEATURE_FLAG_DATA) {
      debug('Received neoforge:feature_flag_data')
      handleFeatureFlagData(packet.data)
    } else if (ch === NEOFORGE_CHANNELS.KNOWN_DATA_MAPS) {
      debug('Received neoforge:known_registry_data_maps')
      handleKnownDataMaps(packet.data)
    } else if (ch === NEOFORGE_CHANNELS.MODDED_NETWORK_QUERY) {
      debug('Received legacy neoforge:modded_network_query')
      handleNetworkQuery(packet.data)
    }
  })

  function handleMinecraftRegister (buffer) {
    if (!buffer || buffer.length === 0) return
    const str = buffer.toString('utf8')
    const list = str.split('\0').filter(Boolean)
    let added = false
    for (const name of list) {
      if (!name.includes(',') && !knownChannels.has(name)) {
        knownChannels.add(name)
        added = true
      }
    }
    if (added && client.state === 'configuration') {
      registerNeoForgeChannels()
    }
  }

  function handleNeoForgeRegister (buffer) {
    try {
      let data = Buffer.from([0x00])
      if (options.queryPayload) {
        data = proto.createPacketBuffer('neoforge_modded_network_query', options.queryPayload)
      } else if (options.queries) {
        data = proto.createPacketBuffer('neoforge_modded_network_query', { queries: options.queries })
      }
      client.write('custom_payload', {
        channel: NEOFORGE_CHANNELS.REGISTER,
        data
      })
      debug('Replied to neoforge:register query (%d bytes)', data.length)
    } catch (err) {
      debug('Failed to reply to neoforge:register:', err.message)
    }
  }

  function handleCommonVersion (buffer) {
    try {
      // Common Networking version 1 negotiation (array with single varint 1)
      client.write('custom_payload', {
        channel: NEOFORGE_CHANNELS.COMMON_VERSION,
        data: Buffer.from([0x01, 0x01])
      })
      debug('Replied to c:version with version 1')
    } catch (err) {
      debug('Failed to reply to c:version:', err.message)
    }
  }

  function handleCommonRegister (buffer) {
    let parsed
    try {
      parsed = proto.parsePacketBuffer('common_register', buffer).data
      debug('Parsed server c:register:', parsed)
      if (Array.isArray(parsed.channels)) {
        for (const name of parsed.channels) {
          if (name && !name.includes(',')) knownChannels.add(name)
        }
      }
    } catch (err) {
      debug('Failed to parse server c:register buffer:', err.message)
    }

    try {
      const validChannels = Array.from(knownChannels).filter(c => c && !c.includes(','))
      const replyData = proto.createPacketBuffer('common_register', {
        version: parsed?.version || 1,
        protocol: parsed?.protocol || 'play',
        channels: validChannels
      })
      client.write('custom_payload', {
        channel: NEOFORGE_CHANNELS.COMMON_REGISTER,
        data: replyData
      })
      debug('Sent c:register reply payload (%d channels)', validChannels.length)
      client.emit('neoforge_common_registered', { channels: validChannels })
    } catch (err) {
      debug('Failed to encode c:register reply:', err.message)
    }
  }

  function handleExtensibleEnumData (buffer) {
    try {
      client.write('custom_payload', {
        channel: NEOFORGE_CHANNELS.EXTENSIBLE_ENUM_ACK,
        data: Buffer.alloc(0)
      })
      debug('Replied to neoforge:extensible_enum_data with ack')
    } catch (err) {
      debug('Failed to reply to neoforge:extensible_enum_data:', err.message)
    }
  }

  function handleFeatureFlagData (buffer) {
    try {
      client.write('custom_payload', {
        channel: NEOFORGE_CHANNELS.FEATURE_FLAG_ACK,
        data: Buffer.alloc(0)
      })
      debug('Replied to neoforge:feature_flag_data with ack')
    } catch (err) {
      debug('Failed to reply to neoforge:feature_flag_data:', err.message)
    }
  }

  function handleKnownDataMaps (buffer) {
    try {
      const parsed = proto.parsePacketBuffer('known_registry_data_maps', buffer).data
      debug('Parsed known_registry_data_maps with %d registries', parsed?.registries?.length || 0)
      const replyRegistries = (parsed?.registries || []).map(r => ({
        registry: r.registry,
        dataMaps: (r.dataMaps || []).map(m => m.id)
      }))
      const replyData = proto.createPacketBuffer('known_registry_data_maps_reply', {
        registries: replyRegistries
      })
      client.write('custom_payload', {
        channel: NEOFORGE_CHANNELS.KNOWN_DATA_MAPS_REPLY,
        data: replyData
      })
      debug('Replied to known_registry_data_maps with %d registries', replyRegistries.length)
    } catch (err) {
      debug('Failed to handle known_registry_data_maps:', err.message)
    }
  }

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
        channel: NEOFORGE_CHANNELS.MODDED_NETWORK_LEGACY,
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
