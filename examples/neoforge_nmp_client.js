'use strict'

// Usage: node neoforge_nmp_client.js [host] [port] [username]
// Connects a node-minecraft-protocol client to a NeoForge 1.21.1 modded server.

const mc = require('minecraft-protocol')
const { neoForgeHandshake } = require('../index')

const host = process.argv[2] || 'localhost'
const port = parseInt(process.argv[3]) || 25565
const username = process.argv[4] || 'NeoClient'

console.log(`Connecting to ${host}:${port} as ${username} (NeoForge 1.21.1)...`)

const client = mc.createClient({
  host,
  port,
  username,
  version: '1.21.1'
})

// Attach NeoForge 1.21.1 handshake & channel negotiation handler
neoForgeHandshake(client, {
  autoNegotiate: true,
  channels: {
    // Optional channel overrides, e.g.:
    // 'jade:server_ping_v1': '1'
  }
})

client.on('connect', function () {
  console.log('Connected to server socket, beginning configuration phase...')
})

client.on('state', function (state) {
  console.log(`Connection state -> ${state}`)
})

client.on('custom_payload', function (packet) {
  if (packet.channel.startsWith('jade:')) {
    console.log(`Received mod custom payload [${packet.channel}] (${packet.data.length} bytes)`)
  }
})

client.on('login', function () {
  console.log('Successfully logged into the world in PLAY state!')
  console.log('Bot is active and receiving world packets.')
})

client.on('kicked', function (reason) {
  console.log('Client was kicked:', reason)
})

client.on('error', function (err) {
  console.error('Error encountered:', err.message)
})
