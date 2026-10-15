import { useState, useEffect, useCallback } from 'react';
import { Icon } from './Icon';
import { apiGet, apiPost, formatBytes, formatSpeed } from './lib';

// Color map for distinct interface types in infographics
const TYPE_COLORS = {
  wifi: '#5b8dee',       // Steel blue
  cellular: '#34d399',   // Emerald green
  ethernet: '#f59e0b',   // Amber
  bridge: '#a78bfa',     // Iris purple
  other: '#9ca3af',      // Slate gray
};

function MiniSparkline({ data = [], color = '#5b8dee', height = 24, width = 80 }) {
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className="sparkline-placeholder" />;
  }

  const max = Math.max(...data, 1024); // at least 1 KB scale
  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - (Math.min(val, max) / max) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="mini-sparkline" aria-hidden="true">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function BandwidthAreaChart({ data = [], height = 72, peakSpeed = 0 }) {
  if (!data || data.length < 2) {
    return (
      <div className="bandwidth-chart-empty" style={{ height }}>
        <span className="muted mono">Collecting telemetry...</span>
      </div>
    );
  }

  const width = 640;
  const max = Math.max(...data, 1024);
  const coords = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - (Math.min(val, max) / max) * (height - 8) - 4;
    return { x, y };
  });

  const linePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const areaPoints = `${coords[0].x.toFixed(1)},${height} ${linePoints} ${coords[coords.length - 1].x.toFixed(1)},${height}`;

  return (
    <div className="bandwidth-chart-wrap">
      <div className="chart-header">
        <span className="chart-label">Total Bonded Throughput (Last 24s)</span>
        <span className="chart-peak mono">Peak: {formatSpeed(peakSpeed > 0 ? peakSpeed : max)}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="bandwidth-chart-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5b8dee" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#5b8dee" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="var(--border)" strokeWidth="1" />
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="var(--border)" strokeDasharray="3 3" strokeWidth="1" opacity="0.6" />
        <polygon points={areaPoints} fill="url(#chartGradient)" />
        <polyline
          fill="none"
          stroke="#5b8dee"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={linePoints}
        />
      </svg>
      <div className="chart-footer">
        <span className="mono muted">24s ago</span>
        <span className="mono muted">Now</span>
      </div>
    </div>
  );
}

export function NetworksPage({ notify }) {
  const [data, setData] = useState({
    interfaces: [],
    totalDownSpeed: 0,
    totalUpSpeed: 0,
    totalDownloaded: 0,
    totalUploaded: 0,
    bondedCount: 0,
    simulatedActive: false,
    aggregateHistory: [],
  });
  const [loading, setLoading] = useState(true);
  const [peakSpeed, setPeakSpeed] = useState(0);

  const fetchNetworks = useCallback(async () => {
    try {
      const snap = await apiGet('/networks');
      if (snap && Array.isArray(snap.interfaces)) {
        setData(snap);
        if (snap.totalDownSpeed > peakSpeed) {
          setPeakSpeed(snap.totalDownSpeed);
        }
      }
      setLoading(false);
    } catch {
      // Backend may be momentarily restarting
    }
  }, [peakSpeed]);

  useEffect(() => {
    fetchNetworks();
    const id = setInterval(fetchNetworks, 1200);
    return () => clearInterval(id);
  }, [fetchNetworks]);

  const toggleAdapter = async (iface) => {
    const nextState = !iface.enabled;
    try {
      const res = await apiPost(`/networks/${iface.id}/toggle`, { enabled: nextState });
      setData(res);
      notify(`${iface.name} (${iface.device}) ${nextState ? 'enabled' : 'disabled'}`);
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const toggleSimulation = async () => {
    const next = !data.simulatedActive;
    try {
      const res = await apiPost('/networks/simulate', { enabled: next });
      setData(res);
      notify(next ? 'Simulated Cellular Tether enabled' : 'Simulated Cellular Tether disabled');
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const {
    interfaces = [],
    totalDownSpeed = 0,
    totalUpSpeed = 0,
    totalDownloaded = 0,
    totalUploaded = 0,
    bondedCount = 0,
    simulatedActive = false,
    aggregateHistory = [],
  } = data;

  const activeInterfaces = interfaces.filter((i) => i.enabled);
  const hasMultiple = bondedCount > 1;

  return (
    <section className="networks-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Network Aggregation</h1>
          <p className="page-sub">
            Multi-interface bonding inspired by Plexo · Aggregating download throughput across physical & tethered adapters
          </p>
        </div>
        <div className="page-actions">
          <button
            id="toggle-simulation"
            className={`btn ${simulatedActive ? 'btn-sim-active' : 'btn-outline'}`}
            onClick={toggleSimulation}
            title="Toggle auxiliary simulated tether adapter for multi-network testing"
          >
            <Icon name="network" size={14} />
            {simulatedActive ? 'Simulated Tether (Active)' : 'Simulate Secondary Adapter'}
          </button>
          <button
            id="refresh-networks"
            className="btn btn-outline"
            onClick={fetchNetworks}
            title="Refresh network adapters"
          >
            <Icon name="refresh" size={14} />
          </button>
        </div>
      </div>

      {/* Top Telemetry KPI Cards */}
      <div className="stat-grid network-kpi-grid">
        <div>
          <span className="stat-label">Bonded Bandwidth</span>
          <span className="stat-value mono">
            {formatSpeed(totalDownSpeed)}
          </span>
          <span className="stat-meta mono muted">
            ↑ {formatSpeed(totalUpSpeed)}
          </span>
        </div>

        <div>
          <span className="stat-label">Active Adapters</span>
          <span className="stat-value">
            {bondedCount} <span className="stat-unit">of {interfaces.length}</span>
          </span>
          <span className="stat-meta">
            <span className={`status-indicator ${bondedCount > 0 ? 'online' : 'offline'}`} />
            {hasMultiple ? 'Multi-network bonded' : 'Single interface active'}
          </span>
        </div>

        <div>
          <span className="stat-label">Bandwidth Balancing</span>
          <span className="stat-value mono">
            {hasMultiple && totalDownSpeed > 0
              ? activeInterfaces.map((i) => `${i.sharePercent}%`).join(' / ')
              : hasMultiple ? 'Ready' : '100%'}
          </span>
          <span className="stat-meta muted">
            {hasMultiple ? 'Dynamic socket striping' : 'Plug secondary adapter to bond'}
          </span>
        </div>

        <div>
          <span className="stat-label">Session Data Transferred</span>
          <span className="stat-value mono">
            {formatBytes(totalDownloaded)}
          </span>
          <span className="stat-meta mono muted">
            {formatBytes(totalUploaded)} uploaded
          </span>
        </div>
      </div>

      {/* Infographics Section */}
      <div className="infographics-panel">
        <div className="infographic-box">
          <div className="infographic-head">
            <span className="infographic-title">Traffic Distribution</span>
            <span className="infographic-badge mono">
              {bondedCount} bonded channel{bondedCount !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Proportional Bandwidth Split Bar */}
          <div className="distribution-bar" role="progressbar" aria-label="Bandwidth distribution across adapters">
            {interfaces.map((iface) => {
              const color = TYPE_COLORS[iface.type] || TYPE_COLORS.other;
              // If total down speed is 0, give each enabled interface equal representation
              const pct = totalDownSpeed > 0
                ? (iface.enabled ? iface.sharePercent : 0)
                : (iface.enabled ? Math.round(100 / Math.max(bondedCount, 1)) : 0);

              if (pct <= 0) return null;

              return (
                <div
                  key={iface.id}
                  className="distribution-segment"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: iface.enabled ? color : 'var(--border)',
                  }}
                  title={`${iface.name} (${iface.device}): ${pct}% share`}
                />
              );
            })}
          </div>

          {/* Distribution Legend */}
          <div className="distribution-legend">
            {interfaces.map((iface) => {
              const color = TYPE_COLORS[iface.type] || TYPE_COLORS.other;
              const pct = totalDownSpeed > 0
                ? (iface.enabled ? iface.sharePercent : 0)
                : (iface.enabled ? Math.round(100 / Math.max(bondedCount, 1)) : 0);

              return (
                <div key={iface.id} className={`legend-item ${iface.enabled ? '' : 'is-disabled'}`}>
                  <span className="legend-swatch" style={{ backgroundColor: iface.enabled ? color : 'var(--border)' }} />
                  <span className="legend-name">{iface.name}</span>
                  <span className="legend-device mono muted">({iface.device})</span>
                  <span className="legend-share mono">{iface.enabled ? `${pct}%` : 'off'}</span>
                  <span className="legend-speed mono muted">{formatSpeed(iface.downSpeed)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Bandwidth Sparkline Chart */}
        <div className="infographic-box chart-box">
          <BandwidthAreaChart data={aggregateHistory} peakSpeed={peakSpeed} />
        </div>
      </div>

      {/* Adapters Management Table */}
      <div className="adapters-section">
        <div className="section-head">
          <h2 className="section-title">Network Adapters</h2>
          <span className="section-sub muted">
            Incoming and outgoing BitTorrent peer sockets are round-robin striped across enabled interfaces.
          </span>
        </div>

        {loading ? (
          <div className="empty">Detecting network hardware interfaces…</div>
        ) : interfaces.length === 0 ? (
          <div className="empty">No network interfaces detected.</div>
        ) : (
          <table className="table table-compact adapters-table">
            <thead>
              <tr>
                <th className="col-status">Status</th>
                <th>Interface</th>
                <th>Type</th>
                <th>IPv4 Address</th>
                <th className="col-num">Download</th>
                <th className="col-num">Upload</th>
                <th className="col-num">Data</th>
                <th className="col-num">Peers</th>
                <th className="col-actions">Routing</th>
              </tr>
            </thead>
            <tbody>
              {interfaces.map((iface) => {
                const color = TYPE_COLORS[iface.type] || TYPE_COLORS.other;
                return (
                  <tr key={iface.id} className={iface.enabled ? '' : 'row-disabled'}>
                    <td className="col-status">
                      <span
                        className={`status-dot ${iface.enabled ? 'is-online' : 'is-offline'}`}
                        style={{ backgroundColor: iface.enabled ? color : undefined }}
                        title={iface.enabled ? 'Bonded & Routing' : 'Disabled'}
                      />
                    </td>
                    <td>
                      <div className="iface-cell">
                        <span className="iface-name">{iface.name}</span>
                        {iface.isSimulated && <span className="tag tag-sim">Simulated</span>}
                      </div>
                      <span className="mono muted iface-device">{iface.device}</span>
                    </td>
                    <td>
                      <span className={`tag tag-iface tag-${iface.type}`}>
                        {iface.type.toUpperCase()}
                      </span>
                    </td>
                    <td className="mono">{iface.ip}</td>
                    <td className="col-num">
                      <div className="speed-with-sparkline">
                        <span className="mono">{formatSpeed(iface.downSpeed)}</span>
                        <MiniSparkline data={iface.history} color={color} width={64} height={18} />
                      </div>
                    </td>
                    <td className="col-num mono muted">{formatSpeed(iface.upSpeed)}</td>
                    <td className="col-num mono">{formatBytes(iface.downloaded)}</td>
                    <td className="col-num mono">{iface.peers ?? 0}</td>
                    <td className="col-actions">
                      <button
                        className={`btn-toggle ${iface.enabled ? 'is-active' : ''}`}
                        onClick={() => toggleAdapter(iface)}
                        aria-label={`Toggle routing on ${iface.name}`}
                        title={iface.enabled ? 'Disable adapter' : 'Enable adapter'}
                      >
                        <span className="toggle-thumb" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Technical Architecture Note */}
      <div className="architecture-note">
        <div className="arch-icon">
          <Icon name="info" size={16} />
        </div>
        <div className="arch-text">
          <strong>How Svorrent aggregates multiple networks (inspired by Plexo):</strong> Standard operating systems route all outbound traffic through the default gateway (e.g. Wi-Fi). Svorrent bypasses this bottleneck by binding each peer TCP connection directly to specific adapter IPs (<code className="code-inline">opts.localAddress</code>). Connecting simultaneously to Wi-Fi and mobile tethering stripes pieces across multiple physical gateways, aggregating your total bandwidth without requiring special router hardware or Link Aggregation (LACP).
        </div>
      </div>
    </section>
  );
}
