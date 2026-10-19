import assert from 'node:assert/strict';
import test from 'node:test';
import { isLocalHttpUrl, localAccess } from '../lib/local-access.js';

test('accepts only loopback HTTP origins', () => {
  for (const url of ['http://localhost:3001', 'http://127.0.0.1:5173', 'http://[::1]:3001']) {
    assert.equal(isLocalHttpUrl(url), true, url);
  }
  for (const url of ['https://example.com', 'http://localhost.evil.test', 'http://192.168.1.2',
    'file:///tmp/index.html', 'http://user@localhost:3001', 'null', 'not a URL']) {
    assert.equal(isLocalHttpUrl(url), false, url);
  }
});

test('rejects remote hosts and cross-site requests', () => {
  const run = (headers) => {
    let nextCalled = false;
    let status;
    localAccess({ headers }, {
      status(code) { status = code; return this; },
      json() { return this; },
    }, () => { nextCalled = true; });
    return { nextCalled, status };
  };
  assert.deepEqual(run({ host: 'localhost:3001' }), { nextCalled: true, status: undefined });
  assert.deepEqual(run({ host: 'localhost:5173', origin: 'http://localhost:5173' }), { nextCalled: true, status: undefined });
  for (const headers of [
    { host: 'evil.test' },
    { host: 'localhost:3001', origin: 'https://evil.test' },
    { host: 'localhost:3001', 'sec-fetch-site': 'cross-site' },
    { host: '127.0.0.1:3001', origin: 'null' },
  ]) {
    assert.deepEqual(run(headers), { nextCalled: false, status: 403 });
  }
});
