import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { apiGet, apiPost, parseSize } from './lib';

const COLUMNS = [
  { key: 'title', label: 'Name', className: 'col-name' },
  { key: 'size', label: 'Size', className: 'col-num' },
  { key: 'seeds', label: 'Seeds', className: 'col-num' },
  { key: 'peers', label: 'Leech', className: 'col-num' },
  { key: 'provider', label: 'Source', className: 'col-source' },
];

function seedClass(seeds) {
  if (seeds >= 50) return 'seeds-good';
  if (seeds >= 5) return 'seeds-ok';
  return 'seeds-low';
}

export function SearchPage({ notify, onDownloadAdded, initialQuery }) {
  const [query, setQuery] = useState(initialQuery || '');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchedTerm, setSearchedTerm] = useState('');
  const [error, setError] = useState('');
  const [sort, setSort] = useState({ key: 'seeds', dir: 'desc' });
  const [source, setSource] = useState('all');
  const [rowState, setRowState] = useState({});

  const inputRef = useRef(null);
  const activeTerm = useRef('');
  const debounce = useRef(null);

  const runSearch = async (raw) => {
    const term = raw.trim();
    clearTimeout(debounce.current);
    if (!term) return;

    activeTerm.current = term;
    setLoading(true);
    setError('');

    try {
      const data = await apiGet(`/search?q=${encodeURIComponent(term)}`);
      if (activeTerm.current !== term) return;
      setResults(Array.isArray(data) ? data : []);
      setRowState({});
      setSource('all');
      setSearchedTerm(term);
    } catch {
      if (activeTerm.current === term) setError('Could not reach the search backend. Is the server running on port 3001?');
    } finally {
      if (activeTerm.current === term) setLoading(false);
    }
  };

  const [prevInitial, setPrevInitial] = useState(initialQuery);
  if (initialQuery !== prevInitial) {
    setPrevInitial(initialQuery);
    if (initialQuery && initialQuery.trim()) {
      setQuery(initialQuery.trim());
    }
  }

  // Search after user stops typing
  useEffect(() => {
    const term = query.trim();
    clearTimeout(debounce.current);
    if (term.length < 2) return;
    debounce.current = setTimeout(() => runSearch(term), 450);
    return () => clearTimeout(debounce.current);
  }, [query]);

  // "/" focuses search field from anywhere on the page
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && inputRef.current?.offsetParent && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const sources = useMemo(() => [...new Set(results.map((r) => r.provider).filter(Boolean))].sort(), [results]);

  const rows = useMemo(() => {
    const list = results
      .map((r, i) => ({ ...r, _id: i, _bytes: parseSize(r.size) }))
      .filter((r) => source === 'all' || r.provider === source);

    const dir = sort.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (sort.key === 'size') return (a._bytes - b._bytes) * dir;
      if (sort.key === 'seeds' || sort.key === 'peers') return ((a[sort.key] || 0) - (b[sort.key] || 0)) * dir;
      return String(a[sort.key] || '').localeCompare(String(b[sort.key] || '')) * dir;
    });
    return list;
  }, [results, sort, source]);

  const toggleSort = (key) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'title' || key === 'provider' ? 'asc' : 'desc' }
    );
  };

  const setRow = (id, value) => setRowState((prev) => ({ ...prev, [id]: value }));

  const resolveMagnet = async (t) => {
    if (t.magnet) return t.magnet;
    const params = new URLSearchParams({ provider: t.provider, desc: t.desc || '', link: t.link || '' });
    const data = await apiGet(`/magnet?${params}`);
    setResults((prev) => prev.map((r, i) => (i === t._id ? { ...r, magnet: data.magnet } : r)));
    return data.magnet;
  };

  const handleDownload = async (t) => {
    setRow(t._id, 'adding');
    try {
      await apiPost('/torrent/download', { magnet: t.magnet, provider: t.provider, desc: t.desc, link: t.link });
      setRow(t._id, 'added');
      notify('Added to downloads. Saving to ~/Downloads/Svorrent');
      onDownloadAdded?.();
    } catch (err) {
      setRow(t._id, null);
      notify(err.message || 'Could not start download', 'error');
    }
  };

  const handleOpenMagnet = async (t) => {
    try {
      window.location.href = await resolveMagnet(t);
    } catch {
      notify('Could not resolve magnet link', 'error');
    }
  };

  const handleCopyMagnet = async (t) => {
    try {
      await navigator.clipboard.writeText(await resolveMagnet(t));
      notify('Magnet link copied');
    } catch {
      notify('Could not copy magnet link', 'error');
    }
  };

  const clear = () => {
    setQuery('');
    setResults([]);
    setSearchedTerm('');
    setError('');
    activeTerm.current = '';
    setLoading(false);
    inputRef.current?.focus();
  };

  const hasResults = results.length > 0;

  return (
    <section className="search-page">
      <form
        className="searchbar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(query);
        }}
      >
        <div className="searchbar-field">
          <Icon name="search" className="searchbar-icon" />
          <input
            id="search-input"
            ref={inputRef}
            type="search"
            placeholder="Search torrents across public indexes..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck="false"
          />
          {query ? (
            <button type="button" className="icon-btn" onClick={clear} aria-label="Clear search">
              <Icon name="x" size={14} />
            </button>
          ) : (
            <kbd className="kbd">/</kbd>
          )}
        </div>

        <button id="search-submit" type="submit" className="btn btn-primary" disabled={!query.trim() || loading}>
          Search
        </button>
      </form>

      {error && <div className="notice notice-error">{error}</div>}

      {hasResults && (
        <div className="toolbar">
          <span className="toolbar-summary">
            {loading ? 'Searching…' : `${rows.length} result${rows.length === 1 ? '' : 's'} for “${searchedTerm}”`}
          </span>
          {sources.length > 1 && (
            <label className="select-wrap">
              <span className="sr-only">Filter by source</span>
              <select id="source-filter" value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="all">All sources ({sources.length})</option>
                {sources.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {hasResults ? (
        <div className={`table-wrap ${loading ? 'is-stale' : ''}`}>
          <table className="table results-table">
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} className={c.className} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button className="th-btn" onClick={() => toggleSort(c.key)}>
                      {c.label}
                      <span className={`sort-caret ${sort.key === c.key ? 'is-on' : ''}`}>{sort.key === c.key && sort.dir === 'asc' ? '▴' : '▾'}</span>
                    </button>
                  </th>
                ))}
                <th className="col-actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const state = rowState[t._id];
                return (
                  <tr key={t._id}>
                    <td className="col-name">
                      <span className="cell-title" title={t.title}>
                        {t.title}
                      </span>
                    </td>
                    <td className="col-num mono">{t.size || '—'}</td>
                    <td className={`col-num mono ${seedClass(t.seeds || 0)}`}>{t.seeds ?? 0}</td>
                    <td className="col-num mono muted">{t.peers ?? 0}</td>
                    <td className="col-source">
                      <span className="provider-pill">{t.provider}</span>
                    </td>
                    <td className="col-actions">
                      <div className="row-actions">
                        <button
                          className={`btn btn-sm ${state === 'added' ? 'btn-done' : 'btn-outline'}`}
                          onClick={() => handleDownload(t)}
                          disabled={state === 'adding' || state === 'added'}
                        >
                          {state === 'added' ? (
                            <>
                              <Icon name="check" size={14} /> Added
                            </>
                          ) : state === 'adding' ? (
                            'Adding…'
                          ) : (
                            <>
                              <Icon name="download" size={14} /> Download
                            </>
                          )}
                        </button>
                        <button className="icon-btn" onClick={() => handleOpenMagnet(t)} title="Open magnet in desktop client" aria-label="Open magnet">
                          <Icon name="magnet" />
                        </button>
                        <button className="icon-btn" onClick={() => handleCopyMagnet(t)} title="Copy magnet link" aria-label="Copy magnet link">
                          <Icon name="copy" />
                        </button>
                        {t.link ? (
                          <a className="icon-btn" href={t.link} target="_blank" rel="noreferrer" download title="Download .torrent file" aria-label="Download .torrent file">
                            <Icon name="file" />
                          </a>
                        ) : (
                          <span className="icon-btn is-placeholder" />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="empty">No results match the current source filter.</p>}
        </div>
      ) : loading ? (
        <p className="empty">Searching The Pirate Bay, LimeTorrents and TorrentProject…</p>
      ) : searchedTerm && query.trim() ? (
        <p className="empty">Nothing found for “{searchedTerm}”. Try fewer or different keywords.</p>
      ) : (
        !error && (
          <p className="empty">
            Results from The Pirate Bay, LimeTorrents and TorrentProject show up here. Downloads save to{' '}
            <span className="mono">~/Downloads/Svorrent</span>.
          </p>
        )
      )}
    </section>
  );
}
