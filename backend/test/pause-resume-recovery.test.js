import assert from 'node:assert/strict';
import test from 'node:test';
import { setTorrentPaused } from '../lib/torrents.js';

test('setTorrentPaused preserves known peers and resets queue on pause, then redials on resume', () => {
  const redialedPeers = [];
  const destroyedWires = [];
  const destroyedPeers = [];
  let pauseCalled = false;
  let resumeCalled = false;
  let announceStarted = false;

  const mockTorrent = {
    paused: false,
    _pausedManually: false,
    _knownPeers: new Set(['1.1.1.1:51413']),
    wires: [
      { remoteAddress: '2.2.2.2', remotePort: 6881, destroy: () => destroyedWires.push('2.2.2.2:6881') },
    ],
    _peers: new Map([
      ['3.3.3.3:8000', { addr: '3.3.3.3:8000', destroy: () => destroyedPeers.push('3.3.3.3:8000') }],
    ]),
    _queue: ['old-queued-peer'],
    _numPending: 15,
    pause: () => { pauseCalled = true; },
    resume: () => { resumeCalled = true; },
    addPeer: (addr) => { redialedPeers.push(addr); return true; },
    discovery: {
      tracker: {
        _trackers: [{ announce: () => { announceStarted = true; } }],
        _defaultAnnounceOpts: (o) => o,
      },
    },
  };

  // 1. Pause
  setTorrentPaused(mockTorrent, true);
  assert.equal(pauseCalled, true);
  assert.equal(mockTorrent._pausedManually, true);
  assert.equal(destroyedWires.length, 1);
  assert.equal(destroyedPeers.length, 1);
  assert.equal(mockTorrent._queue.length, 0);
  assert.equal(mockTorrent._numPending, 0);
  assert.equal(mockTorrent._peers.size, 0);

  // Verify all peers were captured into knownPeers before destruction
  assert.ok(mockTorrent._knownPeers.has('1.1.1.1:51413'));
  assert.ok(mockTorrent._knownPeers.has('2.2.2.2:6881'));
  assert.ok(mockTorrent._knownPeers.has('3.3.3.3:8000'));

  // 2. Resume
  setTorrentPaused(mockTorrent, false);
  assert.equal(resumeCalled, true);
  assert.equal(mockTorrent._pausedManually, false);
  assert.ok(redialedPeers.includes('1.1.1.1:51413'));
  assert.ok(redialedPeers.includes('2.2.2.2:6881'));
  assert.ok(redialedPeers.includes('3.3.3.3:8000'));
  assert.equal(announceStarted, true);
});
