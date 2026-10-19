import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import { NetworkManager } from '../lib/networks.js';

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
