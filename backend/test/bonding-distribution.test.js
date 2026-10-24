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
