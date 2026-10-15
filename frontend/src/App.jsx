import { useCallback, useEffect, useRef, useState } from 'react';
import { SearchPage } from './SearchPage';
import { DownloadsManager } from './DownloadsManager';
import { SwarmPage } from './SwarmPage';
import { NetworksPage } from './NetworksPage';
import { Icon } from './Icon';
import { apiGet, formatSpeed } from './lib';

const routeFromPath = () => {
  const p = window.location.pathname;
  if (p.startsWith('/downloads')) return 'downloads';
  if (p.startsWith('/swarm')) return 'swarm';
  if (p.startsWith('/networks')) return 'networks';
  return 'search';
};

function App() {
  const [route, setRoute] = useState(routeFromPath);
  const [torrents, setTorrents] = useState([]);
  const [backendUp, setBackendUp] = useState(true);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const refreshTorrents = useCallback(async () => {
    try {
      const list = await apiGet('/torrents');
      setTorrents(Array.isArray(list) ? list : []);
      setBackendUp(true);
    } catch {
      setBackendUp(false);
    }
  }, []);

  useEffect(() => {
    refreshTorrents();
    const id = setInterval(refreshTorrents, 1500);
    return () => clearInterval(id);
  }, [refreshTorrents]);

  useEffect(() => {
    const onPop = () => setRoute(routeFromPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    document.title =
      route === 'downloads'
        ? 'Downloads · Svorrent'
        : route === 'swarm'
        ? 'Swarm Map · Svorrent'
        : route === 'networks'
        ? 'Networks · Svorrent'
        : 'Svorrent';
  }, [route]);

  const navigate = (next) => {
    if (next === route) return;
    const path = next === 'downloads' ? '/downloads' : next === 'swarm' ? '/swarm' : next === 'networks' ? '/networks' : '/';
    window.history.pushState(null, '', path);
    setRoute(next);
  };

  const notify = useCallback((message, tone = 'default') => {
    clearTimeout(toastTimer.current);
    setToast({ message, tone, key: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const downloads = torrents;
  const active = downloads.filter((t) => !t.done && !t.paused).length;
  const down = downloads.reduce((sum, t) => sum + (t.downloadSpeed || 0), 0);
  const up = downloads.reduce((sum, t) => sum + (t.uploadSpeed || 0), 0);
  const totalPeers = downloads.reduce((sum, t) => sum + (t.numPeers || 0), 0);

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
            onClick={(e) => {
              e.preventDefault();
              navigate('search');
            }}
          >
            svorrent
          </a>

          <nav className="tabs" aria-label="Primary">
            <button
              id="nav-search"
              className={`tab ${route === 'search' ? 'is-active' : ''}`}
              onClick={() => navigate('search')}
            >
              Search
            </button>
            <button
              id="nav-downloads"
              className={`tab ${route === 'downloads' ? 'is-active' : ''}`}
              onClick={() => navigate('downloads')}
            >
              Downloads
              {downloads.length > 0 && <span className="tab-count">{downloads.length}</span>}
            </button>
            <button
              id="nav-swarm"
              className={`tab ${route === 'swarm' ? 'is-active' : ''}`}
              onClick={() => navigate('swarm')}
            >
              Swarm
              {totalPeers > 0 && <span className="tab-count">{totalPeers}</span>}
            </button>
            <button
              id="nav-networks"
              className={`tab ${route === 'networks' ? 'is-active' : ''}`}
              onClick={() => navigate('networks')}
            >
              Networks
            </button>
          </nav>

          <div className="topbar-status">
            {!backendUp ? (
              <span className="status-offline">Backend offline</span>
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

      <main className="page">
        <div hidden={route !== 'search'}>
          <SearchPage initialQuery={searchTerm} notify={notify} onDownloadAdded={refreshTorrents} />
        </div>
        {route === 'downloads' && (
          <DownloadsManager
            torrents={downloads}
            setTorrents={setTorrents}
            refresh={refreshTorrents}
            notify={notify}
            onGoSearch={handleGoSearch}
          />
        )}
        {route === 'swarm' && (
          <SwarmPage notify={notify} />
        )}
        {route === 'networks' && (
          <NetworksPage notify={notify} />
        )}
      </main>

      {toast && (
        <div key={toast.key} className={`toast toast-${toast.tone}`} role="status">
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default App;
