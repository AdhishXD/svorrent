import { useCallback, useEffect, useRef, useState } from 'react';
import { SearchPage } from './SearchPage';
import { DownloadsManager } from './DownloadsManager';
import { NetworksPage } from './NetworksPage';
import { Icon } from './Icon';
import { apiGet, apiPost, formatSpeed } from './lib';

const routeFromPath = () => {
  const p = window.location.pathname.replace(/\/+$/, '') || '/';
  const h = window.location.hash.replace(/^#\/?/, '').split(/[?&]/)[0];
  if (p === '/downloads' || (p === '/' && h === 'downloads')) return 'downloads';
  if (p === '/networks' || (p === '/' && h === 'networks')) return 'networks';
  return 'search';
};

function App() {
  const [route, setRoute] = useState(routeFromPath);
  const [torrents, setTorrents] = useState([]);
  const [backendUp, setBackendUp] = useState(true);
  const [backendError, setBackendError] = useState('');
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const polling = useRef(null);
  const mainRef = useRef(null);
  const previousRoute = useRef(route);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchUpdateStatus = () => {
      apiGet('/updater/status').then((info) => {
        if (active && info && typeof info === 'object') setUpdateInfo(info);
      }).catch(() => {});
    };
    fetchUpdateStatus();
    const timer = setInterval(fetchUpdateStatus, 30000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const refreshTorrents = useCallback(function refresh() {
    const session = polling.current;
    if (!session?.active) return Promise.resolve();
    clearTimeout(session.timer);
    if (session.promise) {
      // A refresh after a mutation must run after the current snapshot finishes.
      session.queued = true;
      return session.promise;
    }
    session.promise = (async () => {
      do {
        session.queued = false;
        session.controller = new AbortController();
        try {
          const list = await apiGet('/torrents', { signal: session.controller.signal, timeoutMs: 10000 });
          if (!Array.isArray(list) || list.some((t) => !t || typeof t !== 'object' ||
            typeof t.infoHash !== 'string' || typeof t.name !== 'string')) {
            throw new Error('Invalid downloads response');
          }
          if (session.active && !session.queued) {
            setTorrents(list);
            setBackendUp(true);
            setBackendError('');
          }
        } catch (error) {
          if (session.active && !session.queued) {
            setBackendUp(false);
            setBackendError(error instanceof Error ? error.message : 'Request failed');
          }
        }
      } while (session.active && session.queued);
    })().finally(() => {
      session.promise = null;
      if (session.active) session.timer = setTimeout(refresh, 1500);
    });
    return session.promise;
  }, []);

  useEffect(() => {
    const session = { active: true, queued: false, promise: null, controller: null, timer: null };
    polling.current = session;
    refreshTorrents();
    return () => {
      session.active = false;
      session.controller?.abort();
      clearTimeout(session.timer);
      clearTimeout(toastTimer.current);
    };
  }, [refreshTorrents]);

  useEffect(() => {
    const onPop = () => setRoute(routeFromPath());
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, []);

  useEffect(() => {
    document.title =
      route === 'downloads'
        ? 'Downloads · Svorrent'
        : route === 'networks'
        ? 'Networks · Svorrent'
        : 'Svorrent';
    if (previousRoute.current !== route) mainRef.current?.focus();
    previousRoute.current = route;
  }, [route]);

  const navigate = (next) => {
    if (next === route) return;
    const path = next === 'downloads' ? '/downloads' : next === 'networks' ? '/networks' : '/';
    window.history.pushState(null, '', path);
    setRoute(next);
  };

  const followRoute = (event, next) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(next);
  };

  const notify = useCallback((message, tone = 'default') => {
    if (!polling.current?.active) return;
    clearTimeout(toastTimer.current);
    setToast({ message, tone, key: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const downloads = torrents;
  const active = downloads.filter((t) => !t.done && !t.paused).length;
  const speed = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const down = downloads.reduce((sum, t) => sum + speed(t.downloadSpeed), 0);
  const up = downloads.reduce((sum, t) => sum + speed(t.uploadSpeed), 0);

  const [searchTerm, setSearchTerm] = useState('');

  const handleGoSearch = (term) => {
    if (typeof term === 'string') setSearchTerm(term);
    navigate('search');
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <a
            href="/"
            className="wordmark"
            onClick={(e) => followRoute(e, 'search')}
          >
            <img src="/favicon.svg" alt="" className="brand-logo" width="20" height="20" />
            <span>svorrent</span>
          </a>

          <nav className="tabs" aria-label="Primary">
            <a
              id="nav-search"
              href="/"
              aria-current={route === 'search' ? 'page' : undefined}
              className={`tab ${route === 'search' ? 'is-active' : ''}`}
              onClick={(e) => followRoute(e, 'search')}
            >
              Search
            </a>
            <a
              id="nav-downloads"
              href="/downloads"
              aria-current={route === 'downloads' ? 'page' : undefined}
              className={`tab ${route === 'downloads' ? 'is-active' : ''}`}
              onClick={(e) => followRoute(e, 'downloads')}
            >
              Downloads
              {downloads.length > 0 && <span className="tab-count">{downloads.length}</span>}
            </a>
            <a
              id="nav-networks"
              href="/networks"
              aria-current={route === 'networks' ? 'page' : undefined}
              className={`tab ${route === 'networks' ? 'is-active' : ''}`}
              onClick={(e) => followRoute(e, 'networks')}
            >
              Networks
            </a>
          </nav>

          <div className="topbar-status">
            {updateInfo?.readyToInstall && (
              <button
                id="btn-update-available"
                className="btn-update"
                onClick={() => setShowUpdateModal(true)}
                title={`Svorrent ${updateInfo.latestVersion} is downloaded and ready to apply`}
              >
                <Icon name="refresh" size={12} />
                <span>Restart to update ({updateInfo.latestVersion})</span>
              </button>
            )}
            {!backendUp ? (
              <span className="status-offline" role="status" title={backendError}>
                Backend unavailable{backendError ? `: ${backendError}` : ''}
              </span>
            ) : (
              <>
                <span className="rate" title="Total download rate">
                  <Icon name="arrowDown" size={12} />
                  {formatSpeed(down)}
                </span>
                <span className="rate" title="Total upload rate">
                  <Icon name="arrowUp" size={12} />
                  {formatSpeed(up)}
                </span>
                {active > 0 && <span className="rate-meta">{active} active</span>}
              </>
            )}
          </div>
        </div>
      </header>

      <main className="page" ref={mainRef} tabIndex={-1} aria-label={route === 'search' ? 'Search' : route === 'downloads' ? 'Downloads' : 'Networks'}>
        <div style={{ display: route === 'search' ? 'block' : 'none' }}>
          <SearchPage initialQuery={searchTerm} isActive={route === 'search'} notify={notify} onDownloadAdded={refreshTorrents} />
        </div>
        <div style={{ display: route === 'downloads' ? 'block' : 'none' }}>
          <DownloadsManager
            torrents={downloads}
            setTorrents={setTorrents}
            refresh={refreshTorrents}
            notify={notify}
            onGoSearch={handleGoSearch}
          />
        </div>
        <div style={{ display: route === 'networks' ? 'block' : 'none' }}>
          <NetworksPage notify={notify} isActive={route === 'networks'} />
        </div>
      </main>

      {toast && (
        <div key={toast.key} className={`toast toast-${toast.tone}`} role="status">
          {toast.message}
        </div>
      )}

      {showUpdateModal && (
        <div className="modal-backdrop" onClick={() => setShowUpdateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3 className="modal-title">Update Ready ({updateInfo?.latestVersion})</h3>
              <button className="icon-btn" onClick={() => setShowUpdateModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="modal-desc">
                A new version of Svorrent has been silently downloaded in the background and is ready to apply.
              </p>
              <p className="modal-desc muted" style={{ marginTop: 8 }}>
                Restarting will apply the update in-place. Your current downloads, torrents, and settings will remain completely intact.
              </p>
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setShowUpdateModal(false)}>Later</button>
              <button
                id="btn-confirm-restart-update"
                className="btn btn-primary"
                onClick={async () => {
                  setShowUpdateModal(false);
                  notify('Restarting Svorrent to apply update...', 'info');
                  try {
                    await apiPost('/updater/restart');
                  } catch (err) {
                    notify(err.message || 'Failed to trigger restart', 'danger');
                  }
                }}
              >
                Restart & Update Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
