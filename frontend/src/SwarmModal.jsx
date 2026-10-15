import React, { useEffect, useState, useMemo } from 'react';
import { SwarmWorldMap } from './SwarmWorldMap';
import { countryFlag, countryName } from './countryUtils';
import { Icon } from './Icon';
import { apiGet, formatSpeed, formatBytes } from './lib';

// Color map for diverse network interfaces
const INTERFACE_COLORS = {
  wifi: '#38bdf8',       // Cyan
  cellular: '#10b981',   // Emerald
  ethernet: '#a855f7',   // Purple
  bridge: '#f59e0b',     // Amber
  other: '#94a3b8',      // Slate
};

function getIfaceColor(type) {
  return INTERFACE_COLORS[type] || INTERFACE_COLORS.other;
}

export function SwarmModal({ torrent, onClose, notify }) {
  const [data, setData] = useState({
    peers: [],
    summary: { totalPeers: 0, countriesCount: 0, countries: [], interfaces: [] },
  });
  const [loading, setLoading] = useState(true);
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [selectedInterface, setSelectedInterface] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('downSpeed');

  const torrentId = torrent?.infoHash;

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!torrentId) return;
    let alive = true;

    const load = async () => {
      try {
        const res = await apiGet(`/swarm?id=${torrentId}`);
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
  }, [torrentId]);

  const peers = data.peers || [];
  const summary = data.summary || { totalPeers: 0, countriesCount: 0, countries: [], interfaces: [] };

  // Filter peers based on interface, country, and search query
  const filteredPeers = useMemo(() => {
    return peers.filter((p) => {
      if (selectedInterface !== 'all') {
        if (p.networkDevice !== selectedInterface && p.networkType !== selectedInterface) {
          return false;
        }
      }

      if (selectedCountry) {
        const pCountry = p.geo?.countryCode?.toLowerCase();
        if (pCountry !== selectedCountry.toLowerCase()) {
          return false;
        }
      }

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

  // Sort peers
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

  return (
    <div className="modal-backdrop swarm-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal swarm-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="swarm-modal-title">
        {/* Modal Header */}
        <div className="swarm-modal-head">
          <div className="swarm-modal-title-wrap">
            <div className="swarm-modal-icon-badge">
              <Icon name="globe" size={16} />
            </div>
            <div>
              <h2 id="swarm-modal-title" className="swarm-modal-title ellipsis" title={torrent?.name || torrent?.fileName}>
                Swarm Map · {torrent?.name || torrent?.fileName || torrentId}
              </h2>
              <div className="swarm-modal-sub mono text-xs muted">
                <span>{formatBytes(torrent?.length || 0)}</span>
                <span className="dot-sep">•</span>
                <span>{((torrent?.progress || 0) * 100).toFixed(1)}% done</span>
                <span className="dot-sep">•</span>
                <span className="active-down">↓ {formatSpeed(torrent?.downloadSpeed || 0)}</span>
                <span className="dot-sep">•</span>
                <span>{peers.length} peer{peers.length !== 1 ? 's' : ''} across {summary.countriesCount || 0} countr{summary.countriesCount === 1 ? 'y' : 'ies'}</span>
              </div>
            </div>
          </div>

          <button className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="swarm-modal-body">
          {/* Controls Bar: Scalable Network Channels Segmented Control */}
          <div className="swarm-modal-toolbar">
            <div className="segmented-control" role="radiogroup" aria-label="Channel filter">
              <button
                className={`segment-btn ${selectedInterface === 'all' ? 'is-active' : ''}`}
                onClick={() => setSelectedInterface('all')}
              >
                All Channels ({peers.length})
              </button>

              {/* Dynamically scale to ANY number of network interfaces */}
              {(summary.interfaces || []).map((iface) => {
                const color = getIfaceColor(iface.type);
                const isSelected = selectedInterface === iface.device;
                return (
                  <button
                    key={iface.device}
                    className={`segment-btn ${isSelected ? 'is-active' : ''}`}
                    onClick={() => setSelectedInterface(iface.device)}
                  >
                    <span className="chan-dot" style={{ backgroundColor: color }} />
                    <span className="chan-label">{iface.name}</span>
                    <span className="chan-count mono">({iface.count})</span>
                  </button>
                );
              })}
            </div>

            <div className="map-legend">
              {(summary.interfaces || []).map((iface) => {
                const color = getIfaceColor(iface.type);
                return (
                  <span key={iface.device} className="legend-entry">
                    <span className="legend-dot" style={{ backgroundColor: color }} />
                    <span>{iface.name} ({formatSpeed(iface.downSpeed)})</span>
                  </span>
                );
              })}
            </div>
          </div>

          {/* Map + Country Ranking Section */}
          <div className="swarm-main-grid">
            {/* World Map */}
            <div className="swarm-map-card">
              <div className="card-top-bar">
                <div className="card-heading">
                  <span className="card-title">Global Peer Topology</span>
                  {selectedCountry && (
                    <span className="selected-filter-badge">
                      Filtered: {countryFlag(selectedCountry)} {countryName(selectedCountry)}
                      <button className="clear-filter-btn" onClick={() => setSelectedCountry(null)} title="Clear country filter">
                        <Icon name="x" size={12} />
                      </button>
                    </span>
                  )}
                </div>
                <span className="text-xs muted">Click a country to filter</span>
              </div>

              <SwarmWorldMap
                peers={peers}
                selectedCountry={selectedCountry}
                onSelectCountry={setSelectedCountry}
                selectedInterface={selectedInterface}
              />
            </div>

            {/* Countries Ranked List */}
            <div className="swarm-countries-card">
              <div className="card-top-bar">
                <span className="card-title">Contributing Countries</span>
                <span className="mono muted text-xs">{summary.countries?.length || 0} total</span>
              </div>

              <div className="countries-list">
                {(!summary.countries || summary.countries.length === 0) ? (
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
                <h3 className="section-title">Connected Peer Wires</h3>
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
                    <th>Channel Interface</th>
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
                              {p.networkInterface || p.networkDevice || 'en0'}
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
      </div>
    </div>
  );
}
