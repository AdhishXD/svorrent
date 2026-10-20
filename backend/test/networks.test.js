import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import os from 'node:os';
import { NetworkManager } from '../lib/networks.js';

test('self-assigned adapters stay visible but are excluded from peer routing', () => {
  const originalNetworkInterfaces = os.networkInterfaces;
  os.networkInterfaces = () => ({
    en0: [{ family: 'IPv4', internal: false, address: '10.29.42.201' }],
    en14: [{ family: 'IPv4', internal: false, address: '169.254.239.58' }],
  });
  try {
    const manager = Object.create(NetworkManager.prototype);
    manager.hardwarePorts = new Map([['en0', 'Wi-Fi'], ['en14', 'iPhone USB']]);
    manager.disabledIds = new Set();
    manager.stats = new Map();
    manager.roundRobinIndex = 0;
    const interfaces = manager.getAllInterfaces();
    assert.equal(interfaces.find((iface) => iface.id === 'en14').connected, false);
    assert.equal(interfaces.find((iface) => iface.id === 'en14').statusReason, 'link-local');
    assert.equal(manager.pickInterface().id, 'en0');
    assert.equal(manager.getSnapshot().bondedCount, 1);
  } finally {
    os.networkInterfaces = originalNetworkInterfaces;
  }
});

test('interface routing does not capture ordinary web requests', () => {
  const realConnect = net.connect;
  const calls = [];
  net.connect = (...args) => { calls.push(args); return {}; };
  try {
    const manager = Object.create(NetworkManager.prototype);
    manager.socketToInterface = new WeakMap();
    manager.pickInterface = () => ({ id: 'cellular', ip: '192.0.2.10' });
    manager.hookNetConnect();

    net.connect(443, '198.51.100.10');
    net.connect({ port: '80', host: '198.51.100.10' });
    assert.equal(calls[0][0].localAddress, undefined);
    assert.equal(calls[1][0].localAddress, undefined);

    net.connect(51413, '198.51.100.10');
    net.connect({ port: 51413, host: '198.51.100.10' });
    assert.equal(calls[2][0].localAddress, '192.0.2.10');
    assert.equal(calls[3][0].localAddress, '192.0.2.10');
  } finally {
    net.connect = realConnect;
  }
});
