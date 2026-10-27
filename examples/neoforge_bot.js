'use strict'

// Usage: node neoforge_bot.js [host] [port] [username]
// Connects a Mineflayer bot to a NeoForge 1.21.1 modded server.

const mineflayer = require('mineflayer')
const { neoForgeHandshake } = require('../index')

const host = process.argv[2] || 'localhost'
const port = parseInt(process.argv[3]) || 25565
const username = process.argv[4] || 'NeoForgeBot'

console.log(`Connecting to ${host}:${port} as ${username} (NeoForge 1.21.1)...`)

const bot = mineflayer.createBot({
  host,
  port,
  username,
  version: '1.21.1'
})

// Attach NeoForge 1.21.1 handshake handler to the client
neoForgeHandshake(bot._client, {
  // autoNegotiate is enabled by default (reflects server requested channels)
  autoNegotiate: true,
  // Optional custom channel version overrides:
  channels: {
    // 'examplemod:network_channel': '1.0.0'
  }
})

bot.on('connect', function () {
  console.log('Connected to server socket, beginning configuration phase...')
})

bot._client.on('neoforge_negotiated', function (setup) {
  console.log('NeoForge channel negotiation complete!')
  console.log('Negotiated protocol sections:', setup.channels.map(s => s.protocol))
})

bot.on('spawn', function () {
  console.log('Bot spawned successfully into the world!')
  bot.chat('Hello NeoForge world!')
})

bot.on('kicked', function (reason) {
  console.log('Bot was kicked:', reason)
})

bot.on('error', function (err) {
  console.error('Error encountered:', err)
})
