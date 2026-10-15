import { useState } from 'react';
import { TorrentDetails } from './TorrentDetails';
import { SwarmModal } from './SwarmModal';
import { Icon } from './Icon';
import { apiPost, formatBytes, formatEta, formatSpeed } from './lib';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'paused', label: 'Paused' },
  { key: 'completed', label: 'Completed' },
];

function statusOf(t) {
  if (t.isFolderFile) {
    if (t.isRecoverable) return { key: 'halfway', label: 'Halfway · In Folder' };
    return { key: 'local', label: 'In Folder' };
  }
  if (t.done) return { key: 'done', label: 'Completed' };
  if (t.paused) return { key: 'paused', label: 'Paused' };
  if (!t.ready) return { key: 'meta', label: 'Fetching metadata' };
  if (!t.numPeers) return { key: 'stalled', label: 'Looking for peers' };
  return { key: 'active', label: 'Downloading' };
}

export function DownloadsManager({ torrents, setTorrents, refresh, notify, onGoSearch }) {
  const [filter, setFilter] = useState('all');
  const [detailsId, setDetailsId] = useState(null);
  const [swarmTorrent, setSwarmTorrent] = useState(null);
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [magnetInput, setMagnetInput] = useState('');
  const [resuming, setResuming] = useState(false);

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
    if (t.isFolderFile && t.isRecoverable) {
      return resumeRecoverable(t);
    }
    setTorrents((prev) => prev.map((x) => (x.infoHash === t.infoHash ? { ...x, paused: !t.paused } : x)));
    try {
      await apiPost(`/torrent/${t.infoHash}/${t.paused ? 'resume' : 'pause'}`);
    } catch (err) {
      notify(err.message, 'error');
    }
    refresh();
  };

  const remove = async (t) => {
    if (t.isFolderFile) {
      if (!window.confirm(`Delete “${t.name}” from disk permanently?\n\nThis will remove the file from ~/Downloads/Svorrent.`)) return;
      try {
        await apiPost('/folder-files/delete', { name: t.folderItemName || t.name });
        setTorrents((prev) => prev.filter((x) => x.infoHash !== t.infoHash));
        notify(`Deleted “${t.name}” from disk`);
        refresh();
      } catch (err) {
        notify(err.message || 'Failed to delete file', 'error');
      }
      return;
    }

    if (!window.confirm(`Remove “${t.name}” from the list?\n\nFiles already on disk are kept.`)) return;
    try {
      await apiPost(`/torrent/${t.infoHash}/delete`, { deleteFiles: false });
      setTorrents((prev) => prev.filter((x) => x.infoHash !== t.infoHash));
      if (detailsId === t.infoHash) setDetailsId(null);
      notify(`Removed “${t.name}” (local files retained)`);
      refresh();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const reveal = async (targetIdOrName) => {
    try {
      await apiPost(`/torrent/${encodeURIComponent(targetIdOrName || 'root')}/open-finder`);
    } catch (err) {
      notify(err.message || 'Could not open folder', 'error');
    }
  };

  const recheckTorrent = async (infoHash, name) => {
    notify(`Verifying local data for “${name || infoHash}”…`);
    try {
      const res = await apiPost(`/torrent/${infoHash}/recheck`);
      const pct = Math.round((res.progress || 0) * 100);
      notify(`Verified “${name || infoHash}”: ${pct}% complete on disk`);
      refresh();
    } catch (err) {
      notify(err.message || 'Recheck failed', 'error');
    }
  };

  const resumeRecoverable = async (t) => {
    const infoHash = t.recoverable?.infoHash || t.infoHash;
    const magnet = t.magnet || t.recoverable?.magnetURI;
    try {
      notify(`Resuming “${t.name}” against existing files…`);
      await apiPost('/folder-files/resume', { infoHash, magnet });
      notify(`Resumed “${t.name}”! Checking local pieces…`);
      refresh();
    } catch (err) {
      notify(err.message || 'Failed to resume download', 'error');
    }
  };

  const playMedia = async (t) => {
    try {
      const res = await apiPost(`/torrent/${encodeURIComponent(t.infoHash)}/play`);
      notify(`Opening “${res.file || t.name}” in ${res.player || 'VLC'}…`);
    } catch (err) {
      notify(err.message || 'Could not open media player', 'error');
    }
  };

  const handleResumeMagnetSubmit = async (e) => {
    e.preventDefault();
    const uri = magnetInput.trim();
    if (!uri) return;
    setResuming(true);
    try {
      await apiPost('/folder-files/resume', { magnet: uri });
      notify('Download added! Verifying existing local files on disk…');
      setMagnetInput('');
      setResumeModalOpen(false);
      refresh();
      setFilter('all');
    } catch (err) {
      notify(err.message || 'Could not resume with magnet', 'error');
    } finally {
      setResuming(false);
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
        <div className="page-actions">
          <button
            id="btn-resume-magnet"
            className="btn btn-outline"
            onClick={() => {
              setMagnetInput('');
              setResumeModalOpen(true);
            }}
            title="Resume a halfway download by pasting its magnet link or infohash"
          >
            <Icon name="magnet" size={14} /> Resume with Magnet
          </button>
          <button
            id="open-downloads-folder"
            className="btn btn-outline"
            onClick={() => reveal('root')}
            title="Open ~/Downloads/Svorrent in Finder"
          >
            <Icon name="folder" size={14} /> Open folder
          </button>
        </div>
      </div>

      {/* Toolbar & Filter Tabs */}
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

      {/* Downloads Table */}
      {visible.length === 0 ? (
        <div className="empty-block">
          {torrents.length === 0 ? (
            <>
              <p>No downloads yet.</p>
              <button className="btn btn-outline" onClick={() => onGoSearch('')}>
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
                const isFolder = !!t.isFolderFile;

                return (
                  <tr key={t.infoHash} className={`dl-row is-${status.key}`}>
                    <td className="col-name">
                      {isFolder ? (
                        <div className="dl-name-wrapper">
                          <span className="dl-name-static" title={t.name}>
                            {t.name}
                          </span>
                          {t.isRecoverable ? (
                            <span className="tag tag-recoverable-inline">HALFWAY</span>
                          ) : (
                            <span className="tag tag-folder-inline">IN FOLDER</span>
                          )}
                        </div>
                      ) : (
                        <button
                          className="dl-name"
                          onClick={() => setDetailsId(t.infoHash)}
                          title={t.name}
                        >
                          {t.name}
                        </button>
                      )}

                      <div className="dl-progress">
                        <div className="bar">
                          <div
                            className={`bar-fill ${t.isRecoverable ? 'bar-fill-warn' : ''}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="dl-status">
                          <span className="mono">{t.done ? '100%' : `${pct.toFixed(1)}%`}</span>
                          <span className="dot-sep" />
                          {status.label}
                          {t.length > 0 && (
                            <>
                              <span className="dot-sep" />
                              <span className="mono">{formatBytes(t.downloaded || t.length)}</span>
                              {t.isRecoverable && t.length > t.downloaded && (
                                <span className="muted mono"> of {formatBytes(t.length)}</span>
                              )}
                            </>
                          )}
                        </span>
                      </div>
                    </td>

                    <td className="col-num mono">{t.length ? formatBytes(t.length) : '—'}</td>
                    <td className="col-num mono col-hide-sm">
                      {isFolder || t.done ? '—' : formatSpeed(t.downloadSpeed)}
                    </td>
                    <td className="col-num mono col-hide-sm muted">
                      {isFolder ? '—' : formatSpeed(t.uploadSpeed)}
                    </td>
                    <td className="col-num mono col-hide-md muted">
                      {isFolder ? '—' : (t.numPeers || 0)}
                    </td>
                    <td className="col-num mono muted">
                      {isFolder || t.done || t.paused ? '—' : formatEta(t.timeRemaining)}
                    </td>

                    <td className="col-actions">
                      <div className="row-actions">
                        {isFolder ? (
                          <>
                            {t.isRecoverable && (
                              <button
                                className="icon-btn icon-btn-resume"
                                onClick={() => resumeRecoverable(t)}
                                title="Resume download halfway"
                                aria-label="Resume download halfway"
                              >
                                <Icon name="play" />
                              </button>
                            )}
                            <button
                              className="icon-btn"
                              onClick={() => {
                                setMagnetInput(t.magnet || '');
                                setResumeModalOpen(true);
                              }}
                              title={t.isRecoverable ? 'Resume with custom magnet' : 'Seed / Resume via magnet link'}
                              aria-label="Resume with magnet link"
                            >
                              <Icon name="magnet" />
                            </button>
                            {t.playability?.isMedia && (
                              <button
                                className={`icon-btn icon-btn-play ${t.playability.canPlay ? 'is-playable' : 'is-disabled'}`}
                                disabled={!t.playability.canPlay}
                                onClick={() => playMedia(t)}
                                title={t.playability.reason}
                                aria-label={t.playability.reason}
                              >
                                <Icon name="play" />
                              </button>
                            )}
                            <button
                              className="icon-btn"
                              onClick={() => reveal(t.folderItemName || t.name)}
                              title="Show in Finder"
                              aria-label="Show in Finder"
                            >
                              <Icon name="folder" />
                            </button>
                            <button
                              className="icon-btn icon-btn-danger"
                              onClick={() => remove(t)}
                              title="Delete from disk"
                              aria-label="Delete from disk"
                            >
                              <Icon name="trash" />
                            </button>
                          </>
                        ) : (
                          <>
                            {!t.done && (
                              <button
                                className="icon-btn"
                                onClick={() => togglePause(t)}
                                title={t.paused ? 'Resume download' : 'Pause download'}
                                aria-label={t.paused ? 'Resume download' : 'Pause download'}
                              >
                                <Icon name={t.paused ? 'play' : 'pause'} />
                              </button>
                            )}
                            <button
                              className="icon-btn"
                              onClick={() => recheckTorrent(t.infoHash, t.name)}
                              title="Force Recheck / Verify local data on disk"
                              aria-label="Force Recheck"
                            >
                              <Icon name="refresh" />
                            </button>
                            {t.playability?.isMedia && (
                              <button
                                className={`icon-btn icon-btn-play ${t.playability.canPlay ? 'is-playable' : 'is-disabled'}`}
                                disabled={!t.playability.canPlay}
                                onClick={() => playMedia(t)}
                                title={t.playability.reason}
                                aria-label={t.playability.reason}
                              >
                                <Icon name="play" />
                              </button>
                            )}
                            <button
                              className="icon-btn"
                              onClick={() => reveal(t.infoHash)}
                              title="Show in Finder"
                              aria-label="Show in Finder"
                            >
                              <Icon name="folder" />
                            </button>
                            <button
                              className="icon-btn"
                              onClick={() => setSwarmTorrent(t)}
                              title="Swarm Topology & Peer Map"
                              aria-label="Swarm Map"
                            >
                              <Icon name="globe" />
                            </button>
                            <button
                              className="icon-btn"
                              onClick={() => setDetailsId(t.infoHash)}
                              title="Details"
                              aria-label="Details"
                            >
                              <Icon name="info" />
                            </button>
                            <button
                              className="icon-btn icon-btn-danger"
                              onClick={() => remove(t)}
                              title="Remove"
                              aria-label="Remove"
                            >
                              <Icon name="trash" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Resume Download with Magnet or InfoHash */}
      {resumeModalOpen && (
        <div className="modal-backdrop" onClick={() => !resuming && setResumeModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="modal-resume-title">
            <div className="modal-head">
              <h2 id="modal-resume-title" className="modal-title">Continue Download from Magnet</h2>
              <button className="icon-btn" onClick={() => setResumeModalOpen(false)} aria-label="Close dialog">
                <Icon name="x" size={14} />
              </button>
            </div>
            <form onSubmit={handleResumeMagnetSubmit} className="modal-body">
              <p className="modal-desc muted">
                Paste a magnet link or 40-character infohash. Svorrent will match any existing files or partial chunks in <span className="mono">~/Downloads/Svorrent</span> and automatically continue downloading the remaining pieces without re-downloading existing data.
              </p>
              <div className="field">
                <input
                  type="text"
                  className="input mono"
                  placeholder="magnet:?xt=urn:btih:..."
                  value={magnetInput}
                  onChange={(e) => setMagnetInput(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setResumeModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={resuming || !magnetInput.trim()}>
                  {resuming ? 'Verifying files…' : 'Continue Download'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Torrent Details Drawer */}
      {detailsId && (
        <TorrentDetails
          torrentId={detailsId}
          onClose={() => setDetailsId(null)}
          onReveal={() => reveal(detailsId)}
        />
      )}

      {/* Swarm Topology & Peer Map Modal */}
      {swarmTorrent && (
        <SwarmModal
          torrent={swarmTorrent}
          onClose={() => setSwarmTorrent(null)}
        />
      )}
    </section>
  );
}
