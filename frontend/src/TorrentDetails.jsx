import React, { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { apiGet, formatBytes, formatSpeed, formatPeerAddress, progressPercent } from './lib';
import { countryFlag, countryName } from './countryUtils';
import { useDialog } from './useDialog';

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
  const dialog = useDialog(true, onClose);

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={dialog} tabIndex={-1} className="drawer" role="dialog" aria-modal="true" aria-label={title}>
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
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    let timer;
    const controller = new AbortController();
    setStats(null);
    setError('');
    const load = async () => {
      try {
        const data = await apiGet(`/torrent/${encodeURIComponent(torrentId)}/nerd-stats`, { signal: controller.signal });
        if (alive) { setStats(data); setError(''); }
      } catch (err) {
        if (alive) setError(err.message || 'Could not load torrent details. Retrying…');
      } finally {
        if (alive) timer = setTimeout(load, 1500);
      }
    };
    load();
    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [torrentId]);

  if (!stats) {
    return (
      <Drawer title="Torrent details" onClose={onClose}>
        <p className="empty" role="status">{error || 'Fetching torrent details…'}</p>
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
      {error && <p className="notice notice-error" role="status">{error} Showing the last update.</p>}
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
                    <td className="col-num mono">{progressPercent(f.progress)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

        {tab === 'peers' &&
          (peers.length === 0 ? (
            <p className="empty">No peers connected.</p>
          ) : (
            <ul className="details-peer-list">
              {peers.map((p, i) => {
                const addr = formatPeerAddress(p.ip, p.port);
                return (
                  <li className="details-peer" key={`${addr}-${i}`}>
                    <div className="details-peer-main">
                      <span className="table-flag" title={countryName(p.geo?.countryCode)}>{countryFlag(p.geo?.countryCode)}</span>
                      <span className="mono details-peer-address">{addr}</span>
                      <span className="details-peer-client">{p.client || 'Unknown'}</span>
                    </div>
                    <div className="details-peer-meta">
                      <span>{p.type || 'tcp'} · {p.networkDevice || 'default'}</span>
                      <span>Down <strong className="mono">{formatSpeed(p.downloadSpeed)}</strong></span>
                      <span>Up <strong className="mono">{formatSpeed(p.uploadSpeed)}</strong></span>
                      <span>Has <strong className="mono">{p.progress ?? 0}%</strong></span>
                      <span title="C = choking us, I = interested">Flags <strong className="mono">{p.choked ? 'C' : '·'}{p.interested ? 'I' : '·'}</strong></span>
                    </div>
                  </li>
                );
              })}
            </ul>
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
    <Boundary key={props.torrentId} onClose={props.onClose}>
      <DetailsInner {...props} />
    </Boundary>
  );
}
