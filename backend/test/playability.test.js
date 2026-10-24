import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { assessTorrentPlayability, hasMoovAtBeginning } from '../lib/playability.js';

test('hasMoovAtBeginning accurately detects presence or absence of moov atom in head', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svorrent-play-test-'));
  const headMoovFile = path.join(tmpDir, 'faststart.mp4');
  const tailMoovFile = path.join(tmpDir, 'standard.mp4');

  // Faststart MP4: ftyp + moov + mdat
  const fastBuf = Buffer.concat([
    Buffer.from([0, 0, 0, 32]),
    Buffer.from('ftypisom'),
    Buffer.alloc(20),
    Buffer.from([0, 0, 0, 64]),
    Buffer.from('moov'),
    Buffer.alloc(56),
    Buffer.from([0, 0, 0, 100]),
    Buffer.from('mdat'),
    Buffer.alloc(92),
  ]);
  fs.writeFileSync(headMoovFile, fastBuf);

  // Standard MP4: ftyp + mdat + moov at tail
  const stdBuf = Buffer.concat([
    Buffer.from([0, 0, 0, 32]),
    Buffer.from('ftypisom'),
    Buffer.alloc(20),
    Buffer.from([0, 0, 0, 100]),
    Buffer.from('mdat'),
    Buffer.alloc(92),
    Buffer.from([0, 0, 0, 64]),
    Buffer.from('moov'),
    Buffer.alloc(56),
  ]);
  fs.writeFileSync(tailMoovFile, stdBuf);

  assert.equal(hasMoovAtBeginning(headMoovFile, 128), true);
  assert.equal(hasMoovAtBeginning(tailMoovFile, 64), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('assessTorrentPlayability requires tail pieces for non-faststart MP4 files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svorrent-mp4-test-'));
  const filePath = path.join(tmpDir, 'movie.mp4');
  fs.writeFileSync(filePath, Buffer.alloc(1024 * 1024)); // No moov atom at head

  const pieceLength = 1024 * 1024;
  const totalPieces = 100;
  const bitfieldMap = new Map();
  // Download first 20 pieces (head downloaded)
  for (let i = 0; i < 20; i++) bitfieldMap.set(i, true);

  const mockTorrent = {
    infoHash: 'abc123mock',
    pieceLength,
    length: totalPieces * pieceLength,
    downloaded: 20 * pieceLength,
    downloadSpeed: 5 * 1024 * 1024,
    paused: false,
    bitfield: {
      get: (idx) => !!bitfieldMap.get(idx),
    },
    files: [
      {
        name: 'movie.mp4',
        path: 'movie.mp4',
        length: totalPieces * pieceLength,
        offset: 0,
        _startPiece: 0,
        _endPiece: 99,
        downloaded: 20 * pieceLength,
      },
    ],
  };

  // Without tail pieces: canPlay must be false with MP4 index reason
  const resultMissingTail = assessTorrentPlayability(mockTorrent, tmpDir);
  assert.equal(resultMissingTail.canPlay, false);
  assert.ok(resultMissingTail.reason.includes('Buffering MP4 index'));

  // Mark tail pieces as downloaded
  for (let i = 90; i < 100; i++) bitfieldMap.set(i, true);

  const resultWithTail = assessTorrentPlayability(mockTorrent, tmpDir);
  assert.equal(resultWithTail.canPlay, true);
  assert.ok(resultWithTail.reason.includes('Safe to stream'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
