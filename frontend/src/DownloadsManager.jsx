import { useState } from 'react';
import { TorrentDetails } from './TorrentDetails';
import { Icon } from './Icon';
import { apiPost, formatBytes, formatEta, formatSpeed } from './lib';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'paused', label: 'Paused' },
  { key: 'completed', label: 'Completed' },
];

function statusOf(t) {
  if (t.done) return { key: 'done', label: 'Completed' };
  if (t.paused) return { key: 'paused', label: 'Paused' };
  if (!t.ready) return { key: 'meta', label: 'Fetching metadata' };
  if (!t.numPeers) return { key: 'stalled', label: 'Looking for peers' };
  return { key: 'active', label: 'Downloading' };
}

export function DownloadsManager({ torrents, setTorrents, refresh, notify, onGoSearch }) {
  const [filter, setFilter] = useState('all');
  const [detailsId, setDetailsId] = useState(null);

  const counts = {
    all: torrents.length,
    active: torrents.filter((t) => !t.done && !t.paused).length,
    paused: torrents.filter((t) => t.paused).length,
    completed: torrents.filter((t) => t.done).length,
  };

  const visible = torrents.filter((t) => {
    if (filter === 'active') return !t.done && !t.paused;
    if (filter === 'paused') return t.paused;
    if (filter === 'completed') return t.done;
    return true;
  });

  const togglePause = async (t) => {
    setTorrents((prev) => prev.map((x) => (x.infoHash === t.infoHash ? { ...x, paused: !t.paused } : x)));
    try {
      await apiPost(`/torrent/${t.infoHash}/${t.paused ? 'resume' : 'pause'}`);
    } catch (err) {
      notify(err.message, 'error');
    }
    refresh();
  };

  const remove = async (t) => {
    if (!window.confirm(`Remove “${t.name}” from the list?\n\nFiles already on disk are kept.`)) return;
    try {
      await apiPost(`/torrent/${t.infoHash}/delete`, { deleteFiles: false });
      setTorrents((prev) => prev.filter((x) => x.infoHash !== t.infoHash));
      if (detailsId === t.infoHash) setDetailsId(null);
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const reveal = async (id) => {
    try {
      await apiPost(`/torrent/${id}/open-finder`);
    } catch (err) {
      notify(err.message || 'Could not open folder', 'error');
    }
  };


  return (
    <section className="downloads-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Downloads</h1>
          <p className="page-sub">
            Saved to <span className="mono">~/Downloads/Svorrent</span>
          </p>
        </div>
        <button id="open-downloads-folder" className="btn btn-outline" onClick={() => reveal('root')}>
          <Icon name="folder" size={14} /> Open folder
        </button>
      </div>

      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="Filter downloads">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              id={`filter-${f.key}`}
              role="tab"
              aria-selected={filter === f.key}
              className={`segment ${filter === f.key ? 'is-active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span className="segment-count">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="empty-block">
          {torrents.length === 0 ? (
            <>
              <p>No downloads yet.</p>
              <button className="btn btn-outline" onClick={onGoSearch}>
                Search for something
              </button>
            </>
          ) : (
            <p>Nothing in this view.</p>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table downloads-table">
            <thead>
              <tr>
                <th className="col-name">Name</th>
                <th className="col-num">Size</th>
                <th className="col-num col-hide-sm">Down</th>
                <th className="col-num col-hide-sm">Up</th>
                <th className="col-num col-hide-md">Peers</th>
                <th className="col-num">ETA</th>
                <th className="col-actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => {
                const pct = Math.floor((t.progress || 0) * 1000) / 10;
                const status = statusOf(t);
                return (
                  <tr key={t.infoHash} className={`dl-row is-${status.key}`}>
                    <td className="col-name">
                      <button className="dl-name" onClick={() => setDetailsId(t.infoHash)} title={t.name}>
                        {t.name}
                      </button>
                      <div className="dl-progress">
                        <div className="bar">
                          <div className="bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="dl-status">
                          <span className="mono">{t.done ? '100%' : `${pct.toFixed(1)}%`}</span>
                          <span className="dot-sep" />
                          {status.label}
                          {!t.done && t.length > 0 && (
                            <>
                              <span className="dot-sep" />
                              <span className="mono">{formatBytes(t.downloaded)}</span>
                            </>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="col-num mono">{t.length ? formatBytes(t.length) : '—'}</td>
                    <td className="col-num mono col-hide-sm">{t.done ? '—' : formatSpeed(t.downloadSpeed)}</td>
                    <td className="col-num mono col-hide-sm muted">{formatSpeed(t.uploadSpeed)}</td>
                    <td className="col-num mono col-hide-md muted">{t.numPeers || 0}</td>
                    <td className="col-num mono muted">{t.done || t.paused ? '—' : formatEta(t.timeRemaining)}</td>
                    <td className="col-actions">
                      <div className="row-actions">
                        {!t.done && (
                          <button className="icon-btn" onClick={() => togglePause(t)} title={t.paused ? 'Resume' : 'Pause'} aria-label={t.paused ? 'Resume' : 'Pause'}>
                            <Icon name={t.paused ? 'play' : 'pause'} />
                          </button>
                        )}
                        <button className="icon-btn" onClick={() => reveal(t.infoHash)} title="Show in Finder" aria-label="Show in Finder">
                          <Icon name="folder" />
                        </button>
                        <button className="icon-btn" onClick={() => setDetailsId(t.infoHash)} title="Details" aria-label="Details">
                          <Icon name="info" />
                        </button>
                        <button className="icon-btn icon-btn-danger" onClick={() => remove(t)} title="Remove" aria-label="Remove">
                          <Icon name="trash" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detailsId && (
        <TorrentDetails
          torrentId={detailsId}
          onClose={() => setDetailsId(null)}
          onReveal={() => reveal(detailsId)}
        />
      )}
    </section>
  );
}
