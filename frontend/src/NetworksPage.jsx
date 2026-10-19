import { useState, useEffect, useRef } from 'react';
import { Icon } from './Icon';
import { apiGet, apiPost, formatBytes, formatSpeed } from './lib';

// Color map for distinct interface types in infographics
const TYPE_COLORS = {
  wifi: '#5b8dee',       // Steel blue
  cellular: '#57ab72',   // Muted green
  ethernet: '#c9a24a',   // Muted amber
  bridge: '#a3a4a8',     // Gray
  other: '#a3a4a8',      // Gray
};

function MiniSparkline({ data = [], color = '#5b8dee', height = 24, width = 80 }) {
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className="sparkline-placeholder" />;
  }

  const max = Math.max(...data, 1024);
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
        <span className="muted mono">Collecting traffic data…</span>
      </div>
    );
  }

  const width = 640;
  // The chart scale has a floor; the reported peak uses measured traffic only.
  const measuredPeak = Math.max(peakSpeed, ...data, 0);
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
        <span className="chart-label">Total download speed (last 24 samples)</span>
        <span className="chart-peak mono">Peak: {measuredPeak > 0 ? formatSpeed(measuredPeak) : '0 B/s'}</span>
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
        <span className="mono muted">Earlier</span>
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
    connectedCount: 0,
    aggregateHistory: [],
  });
  const [loading, setLoading] = useState(true);
  const [peakSpeed, setPeakSpeed] = useState(0);
  const [pendingAction, setPendingAction] = useState(null);
  const [error, setError] = useState('');
  const requestRef = useRef(null);
  const notifyRef = useRef(notify);

  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  useEffect(() => {
    let disposed = false;
    let timer;
    let currentRequest = null;

    const requestNetworks = async (kind = 'poll', iface) => {
      // Serialize user actions, including clicks before React renders disabled controls.
      if (disposed || (currentRequest && (kind === 'poll' || currentRequest.kind !== 'poll'))) return;
      clearTimeout(timer);
      currentRequest?.controller.abort();
      const request = { kind, controller: new AbortController() };
      currentRequest = request;
      const isCurrent = () => !disposed && currentRequest === request;
      const options = { signal: request.controller.signal, timeoutMs: 15000 };
      setPendingAction(kind === 'poll' ? null : kind);

      try {
        const snap = kind === 'toggle'
          ? await apiPost(`/networks/${encodeURIComponent(iface.id)}/toggle`, { enabled: !iface.enabled }, options)
          : await apiGet(kind === 'refresh' ? '/networks?rescan=true' : '/networks', options);
        if (!isCurrent()) return;
        if (!snap || !Array.isArray(snap.interfaces)) throw new Error('The server returned invalid network data.');
        setData(snap);
        setPeakSpeed((previous) => Math.max(previous, Number(snap.totalDownSpeed) || 0));
        setError('');
        if (kind === 'toggle') {
          notifyRef.current?.(`${iface.name} (${iface.device}) ${iface.enabled ? 'disabled' : 'enabled'}`);
        }
      } catch (err) {
        if (!isCurrent()) return;
        const message = err.message || 'Unable to load network data.';
        setError(message);
        if (kind === 'toggle') notifyRef.current?.(message, 'error');
      } finally {
        if (isCurrent()) {
          currentRequest = null;
          setLoading(false);
          setPendingAction(null);
          // Start the next poll only after the current request settles.
          timer = setTimeout(() => requestNetworks(), 1200);
        }
      }
    };

    requestRef.current = requestNetworks;
    requestNetworks();
    return () => {
      disposed = true;
      clearTimeout(timer);
      currentRequest?.controller.abort();
      requestRef.current = null;
    };
  }, []);

  const isRefreshing = pendingAction === 'refresh';

  const {
    interfaces = [],
    totalDownSpeed = 0,
    totalUpSpeed = 0,
    totalDownloaded = 0,
    totalUploaded = 0,
    bondedCount = 0,
    connectedCount = 0,
    aggregateHistory = [],
  } = data;

  const connectedInterfaces = interfaces.filter((i) => i.connected);
  const activeInterfaces = interfaces.filter((i) => i.connected && i.enabled);
  const hasMultiple = bondedCount > 1;
  const downloadShare = (iface) => totalDownSpeed > 0 && iface.connected && iface.enabled
    ? Math.max(0, Math.min(100, Number(iface.sharePercent) || 0))
    : 0;

  return (
    <section className="networks-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Networks</h1>
          <p className="page-sub">
            Peer connections can use enabled network adapters. Speeds depend on each connection and available peers.
          </p>
        </div>
        <div className="page-actions">
          <button
            id="refresh-networks"
            className={`btn btn-outline ${isRefreshing ? 'is-refreshing' : ''}`}
            onClick={() => requestRef.current?.('refresh')}
            disabled={pendingAction !== null}
            title="Rescan network adapters"
          >
            <Icon name="refresh" size={14} className={isRefreshing ? 'icon-spin' : ''} />
            <span>{isRefreshing ? 'Scanning…' : 'Refresh adapters'}</span>
          </button>
        </div>
      </div>

      {error && <p className="muted" role="alert">Network update failed: {error} Retrying automatically.</p>}

      {data?.usbTether?.detected && !data?.usbTether?.interfaceActive && (
        <div className="usb-tether-banner">
          <div className="usb-tether-dot" />
          <div className="usb-tether-content">
            <span className="usb-tether-title">
              {data.usbTether.name || 'Android device'} detected via USB
            </span>
            <span className="usb-tether-hint muted">
              To set up automatic USB tethering, run: <code>sudo ./backend/scripts/install-tetherd.sh</code>
            </span>
          </div>
        </div>
      )}

      {/* Top Telemetry KPI Cards */}
      <div className="stat-grid network-kpi-grid">
        <div>
          <span className="stat-label">Download speed</span>
          <span className="stat-value mono">
            {formatSpeed(totalDownSpeed)}
          </span>
          <span className="stat-meta mono muted">
            ↑ {formatSpeed(totalUpSpeed)}
          </span>
        </div>

        <div>
          <span className="stat-label">Active adapters</span>
          <span className="stat-value">
            {bondedCount} <span className="stat-unit">of {connectedCount} connected</span>
          </span>
          <span className="stat-meta">
            <span className={`status-indicator ${bondedCount > 0 ? 'online' : 'offline'}`} />
            {bondedCount === 0 ? 'No active adapters' : hasMultiple ? 'Multiple adapters enabled' : 'One adapter enabled'}
          </span>
        </div>

        <div>
          <span className="stat-label">Download distribution</span>
          <span className="stat-value mono">
            {bondedCount === 0 ? 'No active adapters' : totalDownSpeed > 0
              ? activeInterfaces.map((i) => `${downloadShare(i)}%`).join(' / ')
              : 'No download traffic'}
          </span>
          <span className="stat-meta muted">
            Share of current download traffic
          </span>
        </div>

        <div>
          <span className="stat-label">Session data transferred</span>
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
            <span className="infographic-title">Download traffic distribution</span>
            <span className="infographic-badge mono">
              {bondedCount} active adapter{bondedCount !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Proportional Bandwidth Split Bar */}
          <div className="distribution-bar" role="img" aria-label={bondedCount === 0 ? 'No active adapters' : totalDownSpeed > 0 ? 'Download traffic distribution across adapters; shares listed below' : 'No download traffic'}>
            {connectedInterfaces.map((iface) => {
              const color = TYPE_COLORS[iface.type] || TYPE_COLORS.other;
              const pct = downloadShare(iface);

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
          {(bondedCount === 0 || totalDownSpeed <= 0) && (
            <p className="muted">{bondedCount === 0 ? 'No active adapters.' : 'No download traffic.'}</p>
          )}

          {/* Distribution Legend */}
          <div className="distribution-legend">
            {connectedInterfaces.map((iface) => {
              const color = TYPE_COLORS[iface.type] || TYPE_COLORS.other;
              const pct = downloadShare(iface);

              return (
                <div key={iface.id} className={`legend-item ${iface.enabled ? '' : 'is-disabled'}`}>
                  <span className="legend-swatch" style={{ backgroundColor: iface.enabled ? color : 'var(--border)' }} />
                  <span className="legend-name">{iface.name}</span>
                  <span className="legend-device mono muted">({iface.device})</span>
                  <span className="legend-share mono">{iface.enabled ? `${pct}%` : 'disabled'}</span>
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
          <h2 className="section-title">Network adapters</h2>
          <span className="section-sub muted">
            Enable or disable adapters for peer connections. Disconnected adapters cannot route traffic.
          </span>
        </div>

        {loading ? (
          <div className="empty">Loading network adapters…</div>
        ) : interfaces.length === 0 ? (
          <div className="empty">{error ? 'Network adapters are unavailable.' : 'No network adapters detected.'}</div>
        ) : (
          <div className="table-wrap">
            <table className="table table-compact adapters-table">
              <thead>
                <tr>
                  <th className="col-status">Status</th>
                  <th>Interface</th>
                  <th>Type</th>
                  <th>IPv4 address</th>
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
                  const isOnline = iface.connected && iface.enabled;
                  return (
                    <tr key={iface.id} className={iface.enabled ? '' : 'row-disabled'}>
                      <td className="col-status">
                        <span
                          className={`status-dot ${isOnline ? 'is-online' : 'is-offline'}`}
                          style={{ backgroundColor: isOnline ? color : undefined }}
                          title={!iface.connected ? 'Disconnected' : iface.enabled ? 'Routing enabled' : 'Routing disabled'}
                        />
                      </td>
                      <td>
                        <div className="iface-cell">
                          <span className="iface-name">{iface.name}</span>
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
                          onClick={() => requestRef.current?.('toggle', iface)}
                          disabled={pendingAction !== null || !iface.connected}
                          aria-pressed={!!iface.enabled}
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
          </div>
        )}
      </div>
    </section>
  );
}
