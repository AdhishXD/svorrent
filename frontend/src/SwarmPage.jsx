import React, { useEffect, useState, useMemo } from 'react';
import { SwarmWorldMap } from './SwarmWorldMap';
import { countryFlag, countryName } from './countryUtils';
import { Icon } from './Icon';
import { apiGet, formatSpeed, formatBytes } from './lib';

export function SwarmPage({ notify }) {
  const [data, setData] = useState({ peers: [], summary: { totalPeers: 0, countriesCount: 0, countries: [], interfaces: [] } });
  const [loading, setLoading] = useState(true);
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [selectedInterface, setSelectedInterface] = useState('all'); // 'all' | 'en0' | 'feth0'
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('downSpeed'); // 'downSpeed' | 'country' | 'client' | 'progress'

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await apiGet('/swarm');
        if (alive) {
          setData(res || { peers: [], summary: { totalPeers: 0, countriesCount: 0, countries: [], interfaces: [] } });
          setLoading(false);
        }
      } catch (err) {
        if (alive && loading) setLoading(false);
      }
    };

    load();
    const interval = setInterval(load, 1500);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  const peers = data.peers || [];
  const summary = data.summary || { totalPeers: 0, countriesCount: 0, countries: [], interfaces: [] };

  // Filter peers based on active filters
  const filteredPeers = useMemo(() => {
    return peers.filter((p) => {
      // Interface filter
      if (selectedInterface !== 'all') {
        if (p.networkDevice !== selectedInterface && p.networkType !== selectedInterface) {
          return false;
        }
      }

      // Country filter
      if (selectedCountry) {
        const pCountry = p.geo?.countryCode?.toLowerCase();
        if (pCountry !== selectedCountry.toLowerCase()) {
          return false;
        }
      }

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const ip = (p.ip || '').toLowerCase();
        const client = (p.client || '').toLowerCase();
        const cName = countryName(p.geo?.countryCode).toLowerCase();
        const city = (p.geo?.city || '').toLowerCase();
        if (!ip.includes(q) && !client.includes(q) && !cName.includes(q) && !city.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [peers, selectedInterface, selectedCountry, searchQuery]);

  // Sorted peers
  const sortedPeers = useMemo(() => {
    const list = [...filteredPeers];
    list.sort((a, b) => {
      if (sortBy === 'downSpeed') return (b.downloadSpeed || 0) - (a.downloadSpeed || 0);
      if (sortBy === 'progress') return (b.progress || 0) - (a.progress || 0);
      if (sortBy === 'client') return (a.client || '').localeCompare(b.client || '');
      if (sortBy === 'country') {
        const cA = countryName(a.geo?.countryCode);
        const cB = countryName(b.geo?.countryCode);
        return cA.localeCompare(cB);
      }
      return 0;
    });
    return list;
  }, [filteredPeers, sortBy]);

  // Aggregate stats
  const totalDownSpeed = peers.reduce((sum, p) => sum + (p.downloadSpeed || 0), 0);
  const totalUpSpeed = peers.reduce((sum, p) => sum + (p.uploadSpeed || 0), 0);

  const wifiStats = summary.interfaces?.find((i) => i.device === 'en0' || i.type === 'wifi') || { count: 0, downSpeed: 0 };
  const tetherStats = summary.interfaces?.find((i) => i.device === 'feth0' || i.type === 'cellular') || { count: 0, downSpeed: 0 };

  return (
    <div className="swarm-page">
      {/* Header & Controls */}
      <div className="swarm-header">
        <div>
          <h1 className="page-title">Swarm Intelligence</h1>
          <p className="page-subtitle muted">
            Real-time peer distribution and geographic routing across bonded network interfaces
          </p>
        </div>

        <div className="swarm-controls">
          {/* Channel Selector */}
          <div className="segmented-control" role="radiogroup" aria-label="Network Interface Filter">
            <button
              className={`segment-btn ${selectedInterface === 'all' ? 'is-active' : ''}`}
              onClick={() => setSelectedInterface('all')}
            >
              All Channels ({peers.length})
            </button>
            <button
              className={`segment-btn ${selectedInterface === 'en0' ? 'is-active' : ''}`}
              onClick={() => setSelectedInterface('en0')}
            >
              <span className="chan-dot chan-wifi-dot" /> Wi-Fi ({wifiStats.count})
            </button>
            <button
              className={`segment-btn ${selectedInterface === 'feth0' ? 'is-active' : ''}`}
              onClick={() => setSelectedInterface('feth0')}
            >
              <span className="chan-dot chan-tether-dot" /> USB Tether ({tetherStats.count})
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="swarm-kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Connected Swarm</span>
          <div className="kpi-val mono">{peers.length}</div>
          <span className="kpi-sub muted">active peer wires</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Swarm Countries</span>
          <div className="kpi-val mono">{summary.countriesCount || 0}</div>
          <span className="kpi-sub muted">nations contributing</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Wi-Fi (en0) Channel</span>
          <div className="kpi-val mono chan-wifi">{formatSpeed(wifiStats.downSpeed)}</div>
          <span className="kpi-sub muted">{wifiStats.count} peers connected</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Android USB Tether (feth0)</span>
          <div className="kpi-val mono chan-tether">{formatSpeed(tetherStats.downSpeed)}</div>
          <span className="kpi-sub muted">{tetherStats.count} peers connected</span>
        </div>
      </div>

      {/* Main Map + Country Sidebar Layout */}
      <div className="swarm-main-grid">
        {/* World Map Section */}
        <div className="swarm-map-card">
          <div className="card-top-bar">
            <div className="card-heading">
              <span className="card-title">Global Swarm Topology</span>
              {selectedCountry && (
                <span className="selected-filter-badge">
                  Filtered to {countryFlag(selectedCountry)} {countryName(selectedCountry)}
                  <button className="clear-filter-btn" onClick={() => setSelectedCountry(null)} title="Clear filter">
                    <Icon name="x" size={12} />
                  </button>
                </span>
              )}
            </div>

            <div className="map-legend">
              <span className="legend-entry">
                <span className="legend-dot chan-wifi-dot" /> Wi-Fi Peers
              </span>
              <span className="legend-entry">
                <span className="legend-dot chan-tether-dot" /> Android USB Peers
              </span>
              <span className="legend-entry">
                <span className="legend-dot chan-dual-dot" /> Both Channels
              </span>
            </div>
          </div>

          <SwarmWorldMap
            peers={peers}
            selectedCountry={selectedCountry}
            onSelectCountry={setSelectedCountry}
            selectedInterface={selectedInterface}
          />
        </div>

        {/* Countries Breakdown Sidebar */}
        <div className="swarm-countries-card">
          <div className="card-top-bar">
            <span className="card-title">Top Countries</span>
            <span className="mono muted text-xs">{summary.countries.length} total</span>
          </div>

          <div className="countries-list">
            {summary.countries.length === 0 ? (
              <p className="empty-sub">Discovering peers…</p>
            ) : (
              summary.countries.map((c) => {
                const isSelected = selectedCountry === c.code.toLowerCase();
                const pct = peers.length > 0 ? Math.round((c.count / peers.length) * 100) : 0;
                return (
                  <div
                    key={c.code}
                    className={`country-row ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => setSelectedCountry(isSelected ? null : c.code.toLowerCase())}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="country-row-main">
                      <span className="country-flag">{countryFlag(c.code)}</span>
                      <span className="country-name ellipsis">{countryName(c.code)}</span>
                      <span className="country-peers mono">{c.count}</span>
                    </div>

                    <div className="country-row-sub">
                      <div className="country-bar-track">
                        <div className="country-bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="country-speed mono muted">{formatSpeed(c.downSpeed)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Peer Details Inspector Table */}
      <div className="swarm-peers-section">
        <div className="section-head">
          <div className="section-title-wrap">
            <h2 className="section-title">Connected Peer Wires</h2>
            <span className="section-count mono muted">({sortedPeers.length} matching)</span>
          </div>

          <div className="table-filter-bar">
            <div className="input-with-icon">
              <Icon name="search" size={14} />
              <input
                type="text"
                placeholder="Filter by IP, client, or country…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input-search-compact"
              />
              {searchQuery && (
                <button className="input-clear-btn" onClick={() => setSearchQuery('')}>
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>

            <div className="sort-select-wrap">
              <span className="sort-label text-xs muted">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="sort-dropdown"
              >
                <option value="downSpeed">Speed (Fastest)</option>
                <option value="country">Country</option>
                <option value="client">Client</option>
                <option value="progress">Progress</option>
              </select>
            </div>
          </div>
        </div>

        <div className="table-responsive">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Country</th>
                <th>IP Address : Port</th>
                <th>Client Software</th>
                <th>Network Channel</th>
                <th className="col-num">Down Speed</th>
                <th className="col-num">Up Speed</th>
                <th className="col-num">Swarm Progress</th>
                <th className="col-num" title="C = Choking us, I = Interested">Flags</th>
              </tr>
            </thead>
            <tbody>
              {sortedPeers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-table-cell">
                    {peers.length === 0 ? 'Connecting to swarm…' : 'No peers match the current filter.'}
                  </td>
                </tr>
              ) : (
                sortedPeers.map((p, idx) => {
                  const cCode = p.geo?.countryCode;
                  const isTether = p.networkDevice === 'feth0' || p.networkType === 'cellular';
                  return (
                    <tr key={`${p.ip}:${p.port}-${idx}`}>
                      <td className="country-cell">
                        <span className="table-flag">{countryFlag(cCode)}</span>
                        <span className="table-country-name">{countryName(cCode)}</span>
                        {p.geo?.city && <span className="table-city muted">({p.geo.city})</span>}
                      </td>

                      <td className="mono">
                        {p.ip}:{p.port}
                      </td>

                      <td className="ellipsis" title={p.client}>
                        {p.client || 'Unknown'}
                      </td>

                      <td>
                        <span className={`channel-badge ${isTether ? 'badge-tether' : 'badge-wifi'}`}>
                          {isTether ? 'Android USB (feth0)' : 'Wi-Fi (en0)'}
                        </span>
                      </td>

                      <td className="col-num mono">
                        {p.downloadSpeed > 0 ? (
                          <span className="active-down">{formatSpeed(p.downloadSpeed)}</span>
                        ) : (
                          <span className="muted">{formatSpeed(0)}</span>
                        )}
                      </td>

                      <td className="col-num mono muted">
                        {formatSpeed(p.uploadSpeed)}
                      </td>

                      <td className="col-num mono">
                        <div className="table-progress-wrap">
                          <div className="table-progress-bar">
                            <div className="table-progress-fill" style={{ width: `${p.progress || 0}%` }} />
                          </div>
                          <span>{p.progress || 0}%</span>
                        </div>
                      </td>

                      <td className="col-num mono text-xs muted">
                        <span title={p.choked ? 'Peer is choking us' : 'Peer is unchoked'}>
                          {p.choked ? 'C' : 'U'}
                        </span>
                        {p.interested && <span title="Peer is interested"> · I</span>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
