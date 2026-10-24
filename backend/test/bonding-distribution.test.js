import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import { NetworkManager } from '../lib/networks.js';

test('multi-adapter bonding picks connected adapters in round-robin fashion', () => {
  const originalNetworkInterfaces = os.networkInterfaces;
  os.networkInterfaces = () => ({
    en0: [{ family: 'IPv4', internal: false, address: '192.168.1.100' }], // Wi-Fi
    en12: [{ family: 'IPv4', internal: false, address: '172.20.10.4' }],   // Phone Hotspot / Tether
  });

  try {
    const manager = Object.create(NetworkManager.prototype);
    manager.hardwarePorts = new Map([['en0', 'Wi-Fi'], ['en12', 'iPhone USB']]);
    manager.disabledIds = new Set();
    manager.stats = new Map();
    manager.roundRobinIndex = 0;

    // Both should be recognized as connected
    const ifaces = manager.getAllInterfaces();
    assert.equal(ifaces.length, 2);
    assert.equal(ifaces[0].connected, true);
    assert.equal(ifaces[1].connected, true);

    // Snapshot should indicate 2 bonded adapters
    const snapshot = manager.getSnapshot();
    assert.equal(snapshot.bondedCount, 2);

    // Alternating calls should rotate between both adapters
    const firstPick = manager.pickInterface();
    const secondPick = manager.pickInterface();
    const thirdPick = manager.pickInterface();

    assert.equal(firstPick.id, 'en0');
    assert.equal(secondPick.id, 'en12');
    assert.equal(thirdPick.id, 'en0');
  } finally {
    os.networkInterfaces = originalNetworkInterfaces;
  }
});

test('disabling an adapter via UI toggle immediately stops routing peer sockets to it', () => {
  const originalNetworkInterfaces = os.networkInterfaces;
  os.networkInterfaces = () => ({
    en0: [{ family: 'IPv4', internal: false, address: '192.168.1.100' }],
    en12: [{ family: 'IPv4', internal: false, address: '172.20.10.4' }],
  });

  try {
    const manager = Object.create(NetworkManager.prototype);
    manager.hardwarePorts = new Map([['en0', 'Wi-Fi'], ['en12', 'iPhone USB']]);
    manager.disabledIds = new Set(['en12']); // User disabled en12
    manager.stats = new Map();
    manager.roundRobinIndex = 0;

    // Snapshot bonded count should now be 1
    assert.equal(manager.getSnapshot().bondedCount, 1);

    // Repeated picks should always use the enabled adapter (en0)
    for (let i = 0; i < 5; i++) {
      assert.equal(manager.pickInterface().id, 'en0');
    }
  } finally {
    os.networkInterfaces = originalNetworkInterfaces;
  }
});

test('seeding peers on one adapter do not starve download peers on another adapter', () => {
  const originalNetworkInterfaces = os.networkInterfaces;
  os.networkInterfaces = () => ({
    en0: [{ family: 'IPv4', internal: false, address: '192.168.1.100' }], // Wi-Fi
    en12: [{ family: 'IPv4', internal: false, address: '172.20.10.4' }],   // Mobile Tether
  });

  try {
    const manager = Object.create(NetworkManager.prototype);
    manager.hardwarePorts = new Map([['en0', 'Wi-Fi'], ['en12', 'Samsung USB']]);
    manager.disabledIds = new Set();
    // Simulate en12 having 20 seeding peers in stats from a completed torrent
    manager.stats = new Map([
      ['en0', { peers: 2 }],
      ['en12', { peers: 20 }],
    ]);
    manager.roundRobinIndex = 0;

    // Mock client with 1 active downloading torrent that currently has 2 wires on en0, 0 on en12
    const wireEn0_1 = {};
    const wireEn0_2 = {};
    manager.wireToInterface = new WeakMap([
      [wireEn0_1, 'en0'],
      [wireEn0_2, 'en0'],
    ]);

    manager.getClient = () => ({
      torrents: [
        { done: false, paused: false, destroyed: false, wires: [wireEn0_1, wireEn0_2] },
        { done: true, paused: false, destroyed: false, wires: [] },
      ],
    });

    // pickInterface should select en12 because en12 has 0 downloading peers (even though it has 20 seeding peers in stats)
    const pick = manager.pickInterface();
    assert.equal(pick.id, 'en12');
  } finally {
    os.networkInterfaces = originalNetworkInterfaces;
  }
});

