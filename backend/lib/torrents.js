// Input and lifecycle helpers shared by initial downloads and archive recovery.
export function cleanMagnet(source) {
  if (source instanceof Uint8Array) return source;
  if (typeof source !== 'string') throw new Error('A magnet URI or torrent file is required');
  let value = source.trim();
  // Decode a URL-encoded whole URI only. Decoding an ordinary magnet would
  // turn escaped ampersands inside display names and tracker URLs into fields.
  if (/^magnet%3a/i.test(value)) value = decodeURIComponent(value);
  if (/^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(value)) value = `magnet:?xt=urn:btih:${value}`;
  if (!/^magnet:\?/i.test(value)) throw new Error('Invalid magnet URI');
  const params = new URLSearchParams(value.slice(value.indexOf('?') + 1));
  const xt = params.get('xt') || '';
  if (/^urn:btih:3a[a-f0-9]{40}$/i.test(xt)) params.set('xt', `urn:btih:${xt.slice(-40)}`);
  if (!/^urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(params.get('xt') || '')) {
    throw new Error('Invalid BitTorrent info hash');
  }
  return `magnet:?${params.toString().replace(/xt=urn%3Abtih%3A/gi, 'xt=urn:btih:')}`;
}

export function extractInfoHash(source) {
  if (typeof source !== 'string') return null;
  const xt = new URLSearchParams(source.slice(source.indexOf('?') + 1)).get('xt') || '';
  const hash = xt.slice('urn:btih:'.length);
  if (/^[a-f0-9]{40}$/i.test(hash)) return hash.toLowerCase();
  if (!/^[a-z2-7]{32}$/i.test(hash)) return null;
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of hash.toUpperCase()) {
    value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
    }
  }
  return Buffer.from(bytes).toString('hex');
}

export function waitForInfoHash(torrent) {
  if (torrent.destroyed) return Promise.reject(new Error('Torrent was destroyed before initialization'));
  if (torrent.infoHash) return Promise.resolve(torrent);
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      torrent.removeListener('infoHash', ready);
      torrent.removeListener('error', failed);
      torrent.removeListener('close', closed);
      if (error) reject(error);
      else resolve(torrent);
    };
    const ready = () => finish();
    const failed = (error) => finish(error);
    const closed = () => finish(new Error('Torrent closed before initialization'));
    torrent.once('infoHash', ready);
    torrent.once('error', failed);
    torrent.once('close', closed);
  });
}

export function setTorrentPaused(torrent, paused) {
  torrent._pausedManually = paused;
  if (!torrent._knownPeers) torrent._knownPeers = new Set();

  if (paused) {
    // 1. Snapshot all active wires and known peers before tearing down
    if (torrent.wires) {
      for (const wire of torrent.wires) {
        if (wire.remoteAddress && wire.remotePort) {
          torrent._knownPeers.add(`${wire.remoteAddress}:${wire.remotePort}`);
        }
      }
    }
    if (torrent._peers) {
      for (const [id, peer] of torrent._peers.entries()) {
        const addr = peer.addr || (typeof id === 'string' && id.includes(':') ? id : null);
        if (addr) torrent._knownPeers.add(addr);
      }
    }

    torrent.pause();
    if (torrent.ready && torrent.pieces?.length) {
      torrent.deselect(0, torrent.pieces.length - 1);
    }

    // Cleanly tear down all peers and connecting sockets to prevent socket queue deadlock
    if (torrent._peers) {
      for (const peer of Array.from(torrent._peers.values())) {
        try {
          if (peer.wire) peer.wire.destroy();
          if (peer.conn) peer.conn.destroy();
          if (typeof peer.destroy === 'function') peer.destroy();
        } catch {}
      }
      torrent._peers.clear();
    }
    for (const wire of [...(torrent.wires || [])]) {
      try { wire.destroy(); } catch {}
    }
    torrent._queue = [];
    torrent._numPending = 0;
  } else {
    torrent.resume();
    if (torrent.ready && torrent.pieces?.length) {
      torrent.select(0, torrent.pieces.length - 1);
    }

    // 1. Instant Peer Redial: immediately reconnect to known active peers
    if (torrent._knownPeers && torrent._knownPeers.size > 0) {
      for (const addr of torrent._knownPeers) {
        try { torrent.addPeer(addr); } catch {}
      }
    }

    // 2. Instant Tracker Announce: force all active trackers to announce immediately
    if (torrent.discovery?.tracker?._trackers) {
      try {
        const opts = torrent.discovery.tracker._defaultAnnounceOpts({ event: 'started' });
        for (const tr of torrent.discovery.tracker._trackers) {
          try { tr.announce(opts); } catch {}
        }
      } catch (err) {
        console.warn('[resume] tracker announce failed:', err.message);
      }
    }

    // 3. Instant DHT Lookup: query DHT immediately
    if (torrent.client?.dht && torrent.discovery) {
      try {
        if (typeof torrent.discovery._dhtAnnounce === 'function') {
          torrent.discovery._dhtAnnounce();
        }
        if (torrent.client?.dht?.lookup && torrent.infoHash) {
          torrent.client.dht.lookup(torrent.infoHash);
        }
      } catch (err) {
        console.warn('[resume] DHT query failed:', err.message);
      }
    }
  }
}
