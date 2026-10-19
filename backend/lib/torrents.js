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
  if (paused) torrent.pause();
  if (torrent.ready && torrent.pieces?.length) {
    if (paused) torrent.deselect(0, torrent.pieces.length - 1);
    else torrent.select(0, torrent.pieces.length - 1);
  }
  // pause() only stops new connections in WebTorrent. Existing requests and
  // uploads must also be stopped; closing the wire clears their request queues.
  if (paused) {
    for (const wire of [...(torrent.wires || [])]) wire.destroy();
  } else {
    torrent.resume();
  }
}
