import React, { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { apiGet, formatBytes, formatSpeed } from './lib';

function clientName(client) {
  if (!client) return 'Unknown';
  if (typeof client === 'string') return client;
  try {
    const s = Object.values(client)
      .map((c) => (typeof c === 'number' ? String.fromCharCode(c) : String(c)))
      .join('')
      .trim();
    return s || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

class Boundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <Drawer title="Details" onClose={this.props.onClose}>
          <p className="empty">Could not render details: {this.state.error.message}</p>
        </Drawer>
      );
    }
    return this.props.children;
  }
}

function Drawer({ title, subtitle, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer-head">
          <div className="drawer-heading">
            <h2 className="drawer-title" title={title}>
              {title}
            </h2>
            {subtitle && <p className="drawer-sub mono">{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        {children}
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </aside>
    </div>
  );
}

function DetailsInner({ torrentId, onClose, onReveal }) {
  const [stats, setStats] = useState(null);
  const [tab, setTab] = useState('files');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await apiGet(`/torrent/${torrentId}/nerd-stats`);
        if (alive) setStats(data);
      } catch {
        /* keep last good snapshot */
      }
    };
    load();
    const id = setInterval(load, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [torrentId]);

  if (!stats) {
    return (
      <Drawer title="Loading…" onClose={onClose}>
        <p className="empty">Fetching torrent details…</p>
      </Drawer>
    );
  }

  const peers = stats.peers || [];
  const trackers = stats.trackers || [];
  const files = stats.files || [];
  const pieces = stats.pieces || { total: 0, verified: 0, pieceLength: 0, grid: [] };

  const tabs = [
    { key: 'files', label: 'Files', count: files.length },
    { key: 'peers', label: 'Peers', count: peers.length },
    { key: 'trackers', label: 'Trackers', count: trackers.length },
    { key: 'pieces', label: 'Pieces', count: null },
  ];

  return (
    <Drawer
      title={stats.name || 'Untitled'}
      subtitle={torrentId}
      onClose={onClose}
      footer={
        <button className="btn btn-outline" onClick={onReveal}>
          <Icon name="folder" size={14} /> Show in Finder
        </button>
      }
    >
      <dl className="stat-grid">
        <div>
          <dt>Progress</dt>
          <dd className="mono">{((stats.progress || 0) * 100).toFixed(1)}%</dd>
        </div>
        <div>
          <dt>Download</dt>
          <dd className="mono">{formatSpeed(stats.downloadSpeed)}</dd>
        </div>
        <div>
          <dt>Upload</dt>
          <dd className="mono">{formatSpeed(stats.uploadSpeed)}</dd>
        </div>
        <div>
          <dt>Peers</dt>
          <dd className="mono">{stats.numPeers ?? 0}</dd>
        </div>
        <div>
          <dt>DHT nodes</dt>
          <dd className="mono">{stats.dhtNodes ?? 0}</dd>
        </div>
      </dl>

      <nav className="underline-tabs">
        {tabs.map((t) => (
          <button key={t.key} className={`utab ${tab === t.key ? 'is-active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.count !== null && <span className="utab-count">{t.count}</span>}
          </button>
        ))}
      </nav>

      <div className="drawer-body">
        {tab === 'files' &&
          (files.length === 0 ? (
            <p className="empty">Waiting for metadata…</p>
          ) : (
            <table className="table table-compact">
              <thead>
                <tr>
                  <th className="col-name">File</th>
                  <th className="col-num">Size</th>
                  <th className="col-num">Done</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f, i) => (
                  <tr key={i}>
                    <td className="col-name wrap">{f.name}</td>
                    <td className="col-num mono">{formatBytes(f.length)}</td>
                    <td className="col-num mono">{Math.round((f.progress || 0) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

        {tab === 'peers' &&
          (peers.length === 0 ? (
            <p className="empty">No peers connected.</p>
          ) : (
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>Client</th>
                  <th className="col-num">Down</th>
                  <th className="col-num">Up</th>
                  <th className="col-num">Has</th>
                  <th className="col-num" title="C = choking us, I = interested">Flags</th>
                </tr>
              </thead>
              <tbody>
                {peers.map((p, i) => (
                  <tr key={i}>
                    <td className="mono">
                      {String(p.ip)}:{String(p.port)}
                      {p.type && <span className="muted"> · {String(p.type)}</span>}
                    </td>
                    <td className="ellipsis">{clientName(p.client)}</td>
                    <td className="col-num mono">{formatSpeed(p.downloadSpeed)}</td>
                    <td className="col-num mono muted">{formatSpeed(p.uploadSpeed)}</td>
                    <td className="col-num mono">{p.progress ?? 0}%</td>
                    <td className="col-num mono muted">
                      {p.choked ? 'C' : '·'}
                      {p.interested ? 'I' : '·'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

        {tab === 'trackers' &&
          (trackers.length === 0 ? (
            <p className="empty">No trackers. Peers are found through DHT only.</p>
          ) : (
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Status</th>
                  <th className="col-num">Seeds</th>
                  <th className="col-num">Peers</th>
                </tr>
              </thead>
              <tbody>
                {trackers.map((tr, i) => (
                  <tr key={i}>
                    <td className="mono ellipsis" title={tr.url}>
                      {tr.url}
                    </td>
                    <td className="muted">{tr.status}</td>
                    <td className="col-num mono">{tr.seeds ?? '—'}</td>
                    <td className="col-num mono">{tr.peers ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

        {tab === 'pieces' && (
          <div className="pieces">
            <p className="pieces-meta">
              <span className="mono">{(pieces.verified || 0).toLocaleString()}</span> of{' '}
              <span className="mono">{(pieces.total || 0).toLocaleString()}</span> pieces verified ·{' '}
              <span className="mono">{formatBytes(pieces.pieceLength)}</span> each
            </p>
            {pieces.grid?.length ? (
              <>
                <div className="piece-grid">
                  {pieces.grid.map((v, i) => (
                    <span key={i} className={`piece p${v}`} />
                  ))}
                </div>
                <div className="legend">
                  <span><i className="piece p2" /> Have</span>
                  <span><i className="piece p1" /> Partial</span>
                  <span><i className="piece p0" /> Missing</span>
                </div>
              </>
            ) : (
              <p className="empty">Waiting for metadata…</p>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

export function TorrentDetails(props) {
  return (
    <Boundary onClose={props.onClose}>
      <DetailsInner {...props} />
    </Boundary>
  );
}
