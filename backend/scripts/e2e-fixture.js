// A local-only seeder for the browser integration test. No public trackers or DHT.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebTorrent from 'webtorrent';
import TrackerServer from 'bittorrent-tracker/server';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'svorrent-ui-transfer-'));
const source = path.join(root, 'Svorrent Loopback Fixture.bin');
fs.writeFileSync(source, crypto.randomBytes(128 * 1024));
const tracker = new TrackerServer({ http: true, udp: false, ws: false, stats: false, interval: 1000 });
const seeder = new WebTorrent({ dht: false, lsd: false, utp: false, natUpnp: false, natPmp: false, torrentPort: 0 });

async function cleanup() {
  await new Promise((resolve) => seeder.destroy(resolve));
  await new Promise((resolve) => tracker.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}

try {
  await new Promise((resolve, reject) => tracker.once('error', reject).listen(0, '127.0.0.1', resolve));
  const announce = `http://127.0.0.1:${tracker.http.address().port}/announce`;
  const seeded = await new Promise((resolve, reject) => {
    const torrent = seeder.seed(source, { announce: [announce], private: true }, resolve);
    torrent.once('error', reject);
  });
  process.stdout.write(JSON.stringify({
    source,
    infoHash: seeded.infoHash,
    magnet: `${seeded.magnetURI}&tr=${encodeURIComponent(announce)}`,
  }) + '\n');
  process.stdin.resume();
  process.stdin.once('data', async () => {
    await cleanup();
    process.exit(0);
  });
} catch (error) {
  console.error(error);
  await cleanup();
  process.exitCode = 1;
}
