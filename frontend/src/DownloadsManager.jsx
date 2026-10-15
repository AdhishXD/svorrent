import { useState, useEffect, useCallback } from 'react';
import { TorrentDetails } from './TorrentDetails';
import { Icon } from './Icon';
import { apiGet, apiPost, formatBytes, formatEta, formatSpeed, formatDate } from './lib';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'paused', label: 'Paused' },
  { key: 'completed', label: 'Completed' },
  { key: 'folder', label: 'Local Files' },
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
  const [folderData, setFolderData] = useState({
    downloadDir: '',
    items: [],
    totalSizeOnDisk: 0,
    orphanCount: 0,
    recoverableCount: 0,
  });
  const [loadingFolder, setLoadingFolder] = useState(false);
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [magnetInput, setMagnetInput] = useState('');
  const [resuming, setResuming] = useState(false);

  // Scan local folder
  const fetchFolderFiles = useCallback(async () => {
    try {
      setLoadingFolder(true);
      const res = await apiGet('/folder-files');
      if (res && Array.isArray(res.items)) {
        setFolderData(res);
      }
    } catch {
      // Ignored if offline
    } finally {
      setLoadingFolder(false);
    }
  }, []);

  useEffect(() => {
    fetchFolderFiles();
    const id = setInterval(fetchFolderFiles, 3500);
    return () => clearInterval(id);
  }, [fetchFolderFiles]);

  const counts = {
    all: torrents.length,
    active: torrents.filter((t) => !t.done && !t.paused).length,
    paused: torrents.filter((t) => t.paused).length,
    completed: torrents.filter((t) => t.done).length,
    folder: folderData.items.length,
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
      notify(`Removed “${t.name}” (local files retained)`);
      fetchFolderFiles();
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

  // Re-verify local files on disk for an active torrent
  const recheckTorrent = async (infoHash, name) => {
    notify(`Verifying local data for “${name || infoHash}”…`);
    try {
      const res = await apiPost(`/torrent/${infoHash}/recheck`);
      const pct = Math.round((res.progress || 0) * 100);
      notify(`Verified “${name || infoHash}”: ${pct}% complete on disk`);
      refresh();
      fetchFolderFiles();
    } catch (err) {
      notify(err.message || 'Recheck failed', 'error');
    }
  };

  // Resume an incomplete download that matches archived metadata
  const resumeRecoverable = async (item) => {
    const infoHash = item.recoverable?.infoHash;
    if (!infoHash) return;
    try {
      notify(`Resuming “${item.recoverable.name || item.name}” against existing files…`);
      await apiPost('/folder-files/resume', { infoHash });
      notify(`Resumed “${item.recoverable.name || item.name}”! Checking local pieces…`);
      refresh();
      fetchFolderFiles();
      setFilter('all');
    } catch (err) {
      notify(err.message || 'Failed to resume download', 'error');
    }
  };

  // Resume all known recoverable downloads
  const resumeAllRecoverable = async () => {
    const recoverableItems = folderData.items.filter((i) => i.status === 'recoverable');
    if (recoverableItems.length === 0) return;
    notify(`Resuming ${recoverableItems.length} incomplete download(s)…`);
    for (const item of recoverableItems) {
      try {
        await apiPost('/folder-files/resume', { infoHash: item.recoverable.infoHash });
      } catch {}
    }
    notify(`Resumed ${recoverableItems.length} download(s)`);
    refresh();
    fetchFolderFiles();
  };

  // Resume via custom magnet link
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
      fetchFolderFiles();
      setFilter('all');
    } catch (err) {
      notify(err.message || 'Could not resume with magnet', 'error');
    } finally {
      setResuming(false);
    }
  };

  // Delete unwanted file/folder from downloads directory
  const deleteLocalItem = async (item) => {
    if (!window.confirm(`Permanently delete “${item.name}” from disk?\n\nThis will remove the file from ~/Downloads/Svorrent.`)) return;
    try {
      await apiPost('/folder-files/delete', { name: item.name });
      notify(`Deleted “${item.name}” from disk`);
      fetchFolderFiles();
      refresh();
    } catch (err) {
      notify(err.message || 'Failed to delete file', 'error');
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
            onClick={() => setResumeModalOpen(true)}
            title="Resume a halfway download by pasting its magnet link or infohash"
          >
            <Icon name="magnet" size={14} /> Resume with Magnet
          </button>
          <button id="open-downloads-folder" className="btn btn-outline" onClick={() => reveal('root')} title="Open ~/Downloads/Svorrent in Finder">
            <Icon name="folder" size={14} /> Open folder
          </button>
        </div>
      </div>

      {/* Incomplete / Orphan Downloads Alert Banner */}
      {filter !== 'folder' && folderData.orphanCount > 0 && (
        <div className="local-files-banner">
          <div className="banner-icon">
            <Icon name="info" size={16} />
          </div>
          <div className="banner-content">
            <span className="banner-title">
              Found {folderData.orphanCount} file{folderData.orphanCount !== 1 ? 's' : ''} ({formatBytes(folderData.totalSizeOnDisk)}) in your downloads folder not currently running in Svorrent.
            </span>
            <span className="banner-sub muted">
              {folderData.recoverableCount > 0
                ? `${folderData.recoverableCount} incomplete download(s) can be resumed halfway without starting from scratch.`
                : 'Files may be partial downloads from a previous session.'}
            </span>
          </div>
          <div className="banner-actions">
            {folderData.recoverableCount > 0 && (
              <button className="btn btn-sm btn-primary" onClick={resumeAllRecoverable}>
                Resume {folderData.recoverableCount} Known
              </button>
            )}
            <button className="btn btn-sm btn-outline" onClick={() => setFilter('folder')}>
              Inspect Local Files
            </button>
          </div>
        </div>
      )}

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
              {f.key === 'folder' && folderData.orphanCount > 0 && (
                <span className="segment-dot-orphan" title={`${folderData.orphanCount} untracked/halfway files on disk`} />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* View 1: Local Folder Files View */}
      {filter === 'folder' ? (
        <div className="folder-files-view">
          <div className="folder-meta-bar">
            <div>
              <span className="folder-meta-label">On-Disk Storage:</span>
              <span className="mono folder-meta-value">{formatBytes(folderData.totalSizeOnDisk)}</span>
              <span className="muted dot-sep" />
              <span className="muted">{folderData.items.length} item{folderData.items.length !== 1 ? 's' : ''} on disk</span>
              {folderData.orphanCount > 0 && (
                <>
                  <span className="muted dot-sep" />
                  <span className="tag tag-warn-sm">{folderData.orphanCount} not in active downloads</span>
                </>
              )}
            </div>
            <button className="btn btn-sm btn-outline" onClick={fetchFolderFiles} disabled={loadingFolder} title="Rescan downloads folder">
              <Icon name="refresh" size={13} /> {loadingFolder ? 'Scanning…' : 'Rescan Folder'}
            </button>
          </div>

          {folderData.items.length === 0 ? (
            <div className="empty-block">
              <p>Your downloads folder is empty.</p>
              <button className="btn btn-outline" onClick={() => onGoSearch('')}>
                Search for something
              </button>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table folder-table">
                <thead>
                  <tr>
                    <th className="col-name">File / Folder Name</th>
                    <th className="col-num">Size on Disk</th>
                    <th>Status</th>
                    <th className="col-num col-hide-sm">Last Modified</th>
                    <th className="col-actions">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {folderData.items.map((item) => {
                    const isRecoverable = item.status === 'recoverable';
                    const isActive = item.status === 'active';
                    return (
                      <tr key={item.path} className={`folder-row is-${item.status}`}>
                        <td className="col-name">
                          <div className="folder-item-name">
                            <Icon name={item.isDirectory ? 'folder' : 'file'} size={15} className="folder-item-icon" />
                            <span className="item-title" title={item.name}>
                              {item.name}
                            </span>
                            {item.isDirectory && item.innerFileCount > 1 && (
                              <span className="muted mono item-inner-count">({item.innerFileCount} files)</span>
                            )}
                          </div>
                          {isRecoverable && item.recoverable && (
                            <div className="recoverable-meta">
                              <span className="mono">Known Torrent: {item.recoverable.name}</span>
                              <span className="dot-sep" />
                              <span className="mono">Total size: {formatBytes(item.recoverable.totalLength)} (~{item.recoverable.estimatedProgress}% complete)</span>
                            </div>
                          )}
                          {isActive && item.torrent && (
                            <div className="active-item-progress">
                              <div className="bar bar-sm">
                                <div className="bar-fill" style={{ width: `${Math.round((item.torrent.progress || 0) * 100)}%` }} />
                              </div>
                              <span className="mono muted text-xs">
                                {Math.round((item.torrent.progress || 0) * 100)}% done · {item.torrent.paused ? 'Paused' : item.torrent.done ? 'Completed' : 'Downloading'}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="col-num mono">{formatBytes(item.sizeOnDisk)}</td>
                        <td>
                          {isActive && (
                            <span className="tag tag-status-active">
                              ACTIVE TORRENT
                            </span>
                          )}
                          {isRecoverable && (
                            <span className="tag tag-status-recoverable" title="Matches metadata in torrent archive. Can be resumed halfway.">
                              HALFWAY · RECOVERABLE
                            </span>
                          )}
                          {!isActive && !isRecoverable && (
                            <span className="tag tag-status-untracked" title="File on disk with no active torrent.">
                              UNTRACKED FILE
                            </span>
                          )}
                        </td>
                        <td className="col-num mono muted col-hide-sm">
                          {formatDate(item.mtime)}
                        </td>
                        <td className="col-actions">
                          <div className="row-actions">
                            {isRecoverable && (
                              <button
                                className="btn btn-sm btn-primary btn-action-resume"
                                onClick={() => resumeRecoverable(item)}
                                title="Continue download from where it was left"
                              >
                                <Icon name="play" size={12} /> Continue
                              </button>
                            )}
                            {item.status === 'untracked' && (
                              <>
                                <button
                                  className="icon-btn"
                                  onClick={() => onGoSearch(item.name.replace(/\.[^/.]+$/, ''))}
                                  title="Search swarm for matching torrent to continue"
                                >
                                  <Icon name="search" />
                                </button>
                                <button
                                  className="icon-btn"
                                  onClick={() => {
                                    setMagnetInput('');
                                    setResumeModalOpen(true);
                                  }}
                                  title="Resume by pasting magnet link"
                                >
                                  <Icon name="magnet" />
                                </button>
                              </>
                            )}
                            {isActive && item.torrent && (
                              <>
                                <button
                                  className="icon-btn"
                                  onClick={() => setDetailsId(item.torrent.infoHash)}
                                  title="View details"
                                >
                                  <Icon name="info" />
                                </button>
                                <button
                                  className="icon-btn"
                                  onClick={() => recheckTorrent(item.torrent.infoHash, item.name)}
                                  title="Force Recheck Local Data on disk"
                                >
                                  <Icon name="refresh" />
                                </button>
                              </>
                            )}
                            <button
                              className="icon-btn"
                              onClick={() => reveal(item.name)}
                              title="Show in Finder"
                            >
                              <Icon name="folder" />
                            </button>
                            {!isActive && (
                              <button
                                className="icon-btn icon-btn-danger"
                                onClick={() => deleteLocalItem(item)}
                                title="Delete from disk"
                              >
                                <Icon name="trash" />
                              </button>
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
        </div>
      ) : (
        /* View 2: Active Torrents List */
        visible.length === 0 ? (
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
                            <button
                              className="icon-btn"
                              onClick={() => togglePause(t)}
                              title={t.paused ? 'Resume' : 'Pause'}
                              aria-label={t.paused ? 'Resume' : 'Pause'}
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
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
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
    </section>
  );
}
