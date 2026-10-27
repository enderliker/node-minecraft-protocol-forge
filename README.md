# minecraft-protocol-forge
[![NPM version](https://img.shields.io/npm/v/minecraft-protocol-forge.svg)](http://npmjs.com/package/minecraft-protocol-forge)
[![Join the chat at https://gitter.im/PrismarineJS/node-minecraft-protocol](https://img.shields.io/badge/gitter-join%20chat-brightgreen.svg)](https://gitter.im/PrismarineJS/node-minecraft-protocol)

Adds FML/Forge and NeoForge support to [node-minecraft-protocol](https://github.com/PrismarineJS/node-minecraft-protocol) and [mineflayer](https://github.com/PrismarineJS/mineflayer).

## Features

* Supports legacy `FML|HS` client handshake (Forge 1.7 - 1.12)
* Supports FML2 network handshake (Forge 1.13 - 1.16)
* Supports FML3 network handshake (Forge 1.16 - 1.20)
* Supports **NeoForge 1.21.1+** configuration-phase channel negotiation (`neoforge:modded_network_query` / `neoforge:modded_network`)
* Adds automatic Forge / NeoForge mod detection to node-minecraft-protocol's auto-versioning

## Usage

### NeoForge 1.21.1 with Mineflayer

```javascript
const mineflayer = require('mineflayer')
const { neoForgeHandshake } = require('minecraft-protocol-forge')

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'NeoBot',
  version: '1.21.1'
})

// Attach NeoForge 1.21.1 handshake handler
neoForgeHandshake(bot._client, {
  autoNegotiate: true, // Automatically accepts server queried mod channels (default: true)
  channels: {
    // Optional channel version overrides
    // 'somemod:channel': '1.0.0'
  }
})

bot.on('spawn', () => {
  console.log('Joined NeoForge server!')
})
```

### NeoForge 1.21.1 with node-minecraft-protocol

```javascript
const mc = require('minecraft-protocol')
const { neoForgeHandshake } = require('minecraft-protocol-forge')

const client = mc.createClient({
  host: 'localhost',
  port: 25565,
  username: 'Player',
  version: '1.21.1'
})

neoForgeHandshake(client)

client.on('neoforge_negotiated', (setup) => {
  console.log('NeoForge channels negotiated:', setup.channels)
})
```

### Legacy Forge (FML / FML2 / FML3)

```javascript
var mc = require('minecraft-protocol');
var forgeHandshake = require('minecraft-protocol-forge').forgeHandshake;
var client = mc.createClient({
    host: host,
    port: port,
    username: username,
    password: password
});

forgeHandshake(client, {forgeMods: [
  { modid: 'mcp', version: '9.18' },
  { modid: 'FML', version: '8.0.99.99' },
  { modid: 'Forge', version: '11.15.0.1715' },
  { modid: 'IronChest', version: '6.0.121.768' }
]});
```

The `forgeMods` option is an array of modification identifiers and versions to present
to the server. Servers will kick the client if they do not have the required mods.

To automatically present the list of mods offered by the server, the `autoVersionForge`
plugin for node-minecraft-protocol's `autoVersion` (activated by `version: false`) can
be used:

```javascript
var mc = require('minecraft-protocol');
var autoVersionForge = require('minecraft-protocol-forge').autoVersionForge;
var client = mc.createClient({
    version: false,
    host: host,
    port: port,
    username: username,
    password: password
});

autoVersionForge(client);
```

This will automatically install the appropriate handshake plugin (`forgeHandshake`, `forgeHandshake2`, `forgeHandshake3` or `neoForgeHandshake`), with the appropriate mods,
if the server advertises itself as Forge or NeoForge.

## Installation

`npm install minecraft-protocol-forge`

## Debugging

You can enable protocol debugging output using the `NODE_DEBUG` environment variable:

```bash
NODE_DEBUG="minecraft-protocol-forge" node [...]
```
