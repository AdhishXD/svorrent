import React, { useEffect, useRef, useState, useMemo } from 'react';
import worldMapRawSvg from './assets/world-map.svg?raw';
import { countryFlag, countryName } from './countryUtils';
import { formatSpeed } from './lib';

export function SwarmWorldMap({
  peers = [],
  selectedCountry = null,
  onSelectCountry = () => {},
  selectedInterface = 'all',
}) {
  const containerRef = useRef(null);
  const [centroids, setCentroids] = useState({});
  const [hoveredCountry, setHoveredCountry] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Filter peers by selected interface if applicable
  const filteredPeers = useMemo(() => {
    if (selectedInterface === 'all') return peers;
    return peers.filter((p) => p.networkDevice === selectedInterface || p.networkType === selectedInterface);
  }, [peers, selectedInterface]);

  // Group peers by ISO country code
  const countryPeerMap = useMemo(() => {
    const map = new Map();
    for (const p of filteredPeers) {
      const code = p.geo?.countryCode?.toLowerCase();
      if (!code || code === '??' || code === 'unknown') continue;

      if (!map.has(code)) {
        map.set(code, {
          code,
          countryCode: p.geo.countryCode,
          name: countryName(code),
          flag: countryFlag(code),
          peers: [],
          downSpeed: 0,
          upSpeed: 0,
          wifiCount: 0,
          tetherCount: 0,
          cities: new Set(),
          clients: new Set(),
        });
      }

      const item = map.get(code);
      item.peers.push(p);
      item.downSpeed += p.downloadSpeed || 0;
      item.upSpeed += p.uploadSpeed || 0;
      if (p.networkDevice === 'feth0' || p.networkType === 'cellular') {
        item.tetherCount++;
      } else {
        item.wifiCount++;
      }
      if (p.geo.city) item.cities.add(p.geo.city);
      if (p.client && p.client !== 'Unknown') item.clients.add(p.client);
    }
    return map;
  }, [filteredPeers]);

  // Compute SVG element centroids for each country directly from browser geometry
  useEffect(() => {
    if (!containerRef.current) return;
    const svgEl = containerRef.current.querySelector('svg');
    if (!svgEl) return;

    const computed = {};
    const elements = svgEl.querySelectorAll('path[id], g[id]');
    elements.forEach((el) => {
      const id = el.id?.toLowerCase();
      if (!id || id.startsWith('_') || id.length !== 2) return;
      try {
        const bbox = el.getBBox();
        if (bbox && bbox.width > 0 && bbox.height > 0) {
          computed[id] = {
            x: bbox.x + bbox.width / 2,
            y: bbox.y + bbox.height / 2,
          };
        }
      } catch {}
    });

    // Special visual adjustments for countries with distant islands or expansive polygons
    if (computed['us']) computed['us'] = { x: 235, y: 395 };
    if (computed['fr']) computed['fr'] = { x: 415, y: 395 };
    if (computed['ru']) computed['ru'] = { x: 575, y: 350 };
    if (computed['ca']) computed['ca'] = { x: 210, y: 340 };
    if (computed['no']) computed['no'] = { x: 435, y: 335 };

    setCentroids(computed);
  }, []);

  // Update country fill and stroke styles directly in the SVG DOM
  useEffect(() => {
    if (!containerRef.current) return;
    const svgEl = containerRef.current.querySelector('svg');
    if (!svgEl) return;

    const allCountryEls = svgEl.querySelectorAll('path[id], g[id]');
    allCountryEls.forEach((el) => {
      const code = el.id?.toLowerCase();
      if (!code || code.startsWith('_') || code.length !== 2) return;

      const hasPeers = countryPeerMap.has(code);
      const isSelected = selectedCountry && selectedCountry.toLowerCase() === code;
      const isHovered = hoveredCountry && hoveredCountry.toLowerCase() === code;

      el.classList.remove('swarm-active-country', 'swarm-selected-country', 'swarm-hovered-country');

      if (isSelected) {
        el.classList.add('swarm-selected-country');
      } else if (isHovered) {
        el.classList.add('swarm-hovered-country');
      } else if (hasPeers) {
        el.classList.add('swarm-active-country');
      }
    });
  }, [countryPeerMap, selectedCountry, hoveredCountry]);

  // Extract inner SVG markup from worldMapRawSvg
  const innerSvgMarkup = useMemo(() => {
    const start = worldMapRawSvg.indexOf('<g>');
    const end = worldMapRawSvg.lastIndexOf('</g>') + 4;
    if (start !== -1 && end !== -1) {
      return worldMapRawSvg.slice(start, end);
    }
    return '';
  }, []);

  const handleMouseMove = (e) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setMousePos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  };

  const hoveredData = hoveredCountry ? countryPeerMap.get(hoveredCountry.toLowerCase()) : null;

  return (
    <div
      className="swarm-map-container"
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoveredCountry(null)}
    >
      <svg
        viewBox="30.767 241.591 784.077 458.627"
        className="swarm-map-svg"
        preserveAspectRatio="xMidYMid meet"
        onClick={(e) => {
          // If clicking background, deselect
          if (e.target.tagName === 'svg' || e.target.classList.contains('swarm-map-bg')) {
            onSelectCountry(null);
          }
        }}
      >
        {/* Ocean Background */}
        <rect
          x="30.767"
          y="241.591"
          width="784.077"
          height="458.627"
          className="swarm-map-bg"
        />

        {/* Subtle Lat/Lon Reference Lines */}
        <g className="swarm-grid-lines" stroke="rgba(255, 255, 255, 0.035)" strokeDasharray="3 4">
          {/* Equator */}
          <line x1="30.767" y1="470.9" x2="814.844" y2="470.9" strokeWidth="0.8" />
          {/* Prime Meridian */}
          <line x1="422.8" y1="241.591" x2="422.8" y2="700.218" strokeWidth="0.8" />
          {/* Tropic of Cancer (23.5 N) */}
          <line x1="30.767" y1="410" x2="814.844" y2="410" strokeWidth="0.5" />
          {/* Tropic of Capricorn (23.5 S) */}
          <line x1="30.767" y1="530" x2="814.844" y2="530" strokeWidth="0.5" />
        </g>

        {/* Continents Base SVG */}
        <g
          className="swarm-continents-group"
          dangerouslySetInnerHTML={{ __html: innerSvgMarkup }}
          onClick={(e) => {
            const countryEl = e.target.closest('[id]');
            if (countryEl && countryEl.id && countryEl.id.length === 2) {
              const code = countryEl.id.toLowerCase();
              if (countryPeerMap.has(code)) {
                onSelectCountry(selectedCountry === code ? null : code);
              }
            }
          }}
          onMouseOver={(e) => {
            const countryEl = e.target.closest('[id]');
            if (countryEl && countryEl.id && countryEl.id.length === 2) {
              const code = countryEl.id.toLowerCase();
              if (countryPeerMap.has(code)) {
                setHoveredCountry(code);
              }
            }
          }}
        />

        {/* Peer Markers Overlay */}
        <g className="swarm-pins-layer">
          {Array.from(countryPeerMap.values()).map((data) => {
            const pos = centroids[data.code];
            if (!pos) return null;

            const isSelected = selectedCountry === data.code;
            const isHovered = hoveredCountry === data.code;
            const hasWifi = data.wifiCount > 0;
            const hasTether = data.tetherCount > 0;
            const isDualChannel = hasWifi && hasTether;

            // Marker sizing scaled subtly by peer count
            const radius = Math.min(10, Math.max(5, 4 + Math.log2(data.peers.length + 1) * 2.2));

            // Pin coloring based on interface
            let strokeColor = '#38bdf8'; // Cyan for Wi-Fi
            let fillColor = 'rgba(56, 189, 248, 0.85)';
            if (isDualChannel) {
              strokeColor = '#38bdf8';
              fillColor = '#10b981'; // Green core for Tether + Cyan ring for Wi-Fi
            } else if (hasTether) {
              strokeColor = '#10b981'; // Emerald for Android Tether
              fillColor = 'rgba(16, 185, 129, 0.85)';
            }

            return (
              <g
                key={data.code}
                transform={`translate(${pos.x}, ${pos.y})`}
                className={`swarm-pin ${isSelected ? 'is-selected' : ''} ${isHovered ? 'is-hovered' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectCountry(selectedCountry === data.code ? null : data.code);
                }}
                onMouseEnter={() => setHoveredCountry(data.code)}
                style={{ cursor: 'pointer' }}
              >
                {/* Subtle pulse ring on active download */}
                {data.downSpeed > 0 && (
                  <circle
                    r={radius + 4}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth="0.75"
                    strokeOpacity="0.35"
                  />
                )}

                {/* Base Marker Circle */}
                <circle
                  r={radius}
                  fill={fillColor}
                  stroke="#0b0f17"
                  strokeWidth="1.2"
                />

                {/* Dual Channel Indicator Ring */}
                {isDualChannel && (
                  <circle
                    r={radius - 2}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="0.8"
                    strokeOpacity="0.8"
                  />
                )}

                {/* Peer Count Label inside marker if large enough */}
                {radius >= 6.5 && (
                  <text
                    textAnchor="middle"
                    dy="1.6"
                    fontSize="4.8"
                    fontWeight="700"
                    fill="#0a0e17"
                    fontFamily="monospace"
                  >
                    {data.peers.length}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Floating Precision Tooltip */}
      {hoveredData && (
        <div
          className="swarm-tooltip"
          style={{
            left: `${Math.min(window.innerWidth - 260, Math.max(16, mousePos.x + 14))}px`,
            top: `${Math.max(16, mousePos.y - 70)}px`,
          }}
        >
          <div className="tooltip-header">
            <span className="tooltip-flag">{hoveredData.flag}</span>
            <span className="tooltip-country">{hoveredData.name}</span>
            <span className="tooltip-badge mono">{hoveredData.peers.length} peer{hoveredData.peers.length !== 1 ? 's' : ''}</span>
          </div>

          <div className="tooltip-body">
            {hoveredData.cities.size > 0 && (
              <div className="tooltip-row">
                <span className="tooltip-label">Location</span>
                <span className="tooltip-val ellipsis">
                  {Array.from(hoveredData.cities).slice(0, 2).join(', ')}
                </span>
              </div>
            )}
            <div className="tooltip-row">
              <span className="tooltip-label">Speed</span>
              <span className="tooltip-val mono">
                ↓ {formatSpeed(hoveredData.downSpeed)}
                {hoveredData.upSpeed > 0 && ` · ↑ ${formatSpeed(hoveredData.upSpeed)}`}
              </span>
            </div>
            <div className="tooltip-row">
              <span className="tooltip-label">Interfaces</span>
              <span className="tooltip-val mono">
                {hoveredData.wifiCount > 0 && <span className="chan-wifi">Wi-Fi ({hoveredData.wifiCount})</span>}
                {hoveredData.wifiCount > 0 && hoveredData.tetherCount > 0 && ' · '}
                {hoveredData.tetherCount > 0 && <span className="chan-tether">USB ({hoveredData.tetherCount})</span>}
              </span>
            </div>
            {hoveredData.clients.size > 0 && (
              <div className="tooltip-row">
                <span className="tooltip-label">Clients</span>
                <span className="tooltip-val ellipsis">
                  {Array.from(hoveredData.clients).slice(0, 2).join(', ')}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
