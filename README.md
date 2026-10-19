<p align="center">
  <img src="docs/logo.svg" width="96" height="96" alt="Svorrent Logo" />
</p>

<h1 align="center">Svorrent</h1>

<p align="center">
  <b>A desktop BitTorrent client with search, downloads, local media playback, and network and peer diagnostics.</b>
</p>

<p align="center">
  <a href="https://github.com/sovopr/svorrent/releases/latest"><img src="https://img.shields.io/github/v/release/sovopr/svorrent?style=flat-square&color=0284c7" alt="Latest Release" /></a>
  <a href="https://github.com/sovopr/svorrent/releases"><img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-0284c7?style=flat-square" alt="Platform" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0284c7?style=flat-square" alt="MIT License" /></a>
</p>

---

## Downloads (v1.0.1)

Svorrent uses a local web interface. Desktop launchers start the backend and open the interface in your default browser. Node.js 18 or newer is required; the current packages do not bundle it.

| Platform | Package | Size | Description |
| :--- | :--- | :--- | :--- |
| **Windows (x64)** | [**`Svorrent-Setup.exe`**](https://github.com/sovopr/svorrent/releases/download/v1.0.1/Svorrent-Setup.exe) | **9.9 MB** | Installer with Desktop & Start Menu shortcuts. |
| **Windows (x64)** | [**`Svorrent-Windows-x64-Portable.zip`**](https://github.com/sovopr/svorrent/releases/download/v1.0.1/Svorrent-Windows-x64-Portable.zip) | **20.3 MB** | Standalone portable archive. Unzip anywhere and launch `Svorrent.exe`. |
| **macOS (Apple Silicon)** | [**`Svorrent.dmg`**](https://github.com/sovopr/svorrent/releases/download/v1.0.1/Svorrent.dmg) | **19.6 MB** | Native Apple Silicon disk image. Drag `Svorrent.app` into `/Applications`. |

The macOS package is arm64-only; an Intel Mac build is not currently available.

---

## Features & Interface Workflow

### 1. Torrent Search
The search interface currently uses The Pirate Bay provider with a bounded request timeout.
- Queries are deduplicated, normalized, and sortable by seeds, leechers, file size, or indexer source.
- Magnets launch directly into the download pipeline with a single click.

![Search Interface](docs/screenshots/search.webp)

### 2. Downloads Manager & Streaming Controls
The downloads dashboard manages active transfers and can open a playable local video in an installed media player.

![Downloads Manager](docs/screenshots/downloads.webp)

#### 2.1 Sequential Piece Scheduling & Crash Recovery
- Forces sequential piece acquisition (from piece 0 to piece N) to enable immediate streaming instead of random piece distribution.
- Prioritizes container headers and initial chapters (first 25 MB and initial 20 pieces) with critical queue weighting.
- Atomic session snapshots store torrent metadata and verified-piece bitfields in `~/.svorrent/session.json` to accelerate resumption. Saves are batched; a crash can lose recent progress, and missing or changed files may require verification or re-downloading.
- Scans `~/Downloads/Svorrent` to detect orphaned files and halfway downloads, matching them to magnet hashes for one-click resumption.

#### 2.2 In-App Storage & File Deletion
- Custom in-app confirmation modal prevents accidental deletions.
- Option to remove torrent metadata only or permanently delete all associated files and downloaded folders from disk (`~/Downloads/Svorrent/`).
- Invalidation hooks immediately clear file scanner caches and purge persisted session checkpoints.

#### 2.3 Playback Readiness & Estimated Time to Play
Before enabling playback of an incomplete file, Svorrent continuously evaluates whether the remaining download can finish ahead of playback consumption:
$$\text{SafeDownloadedTarget} = \text{TotalLength} - \frac{\text{EffectiveSpeed} \times \text{Duration}}{\text{SafetyMargin}}$$

- **Dynamic Buffer Evaluation**: Computes the exact buffer required so playback never starves before the video finishes, incorporating container header validation and a 20% safety margin against connection fluctuations.
- **Estimated Time to Play on Hover**: Hovering over the Play button or buffering hint displays the estimated time until safe streaming begins (e.g. `Estimated time to play: ~35m (need 4.2 GB more buffer to stream smoothly)`).
- **Throughput Smoothing (EMA)**: Exponential moving average smoothing stabilizes the playability timer against momentary 1-second BitTorrent chunk writing dips.
- **Media Player Integration**: Once the buffer threshold passes, one-click launches the growing file in VLC or your system's default media player.

#### 2.4 Swarm Telemetry Matrix & Peer Inspector
Every download row includes an isolated Swarm button opening a per-torrent inspector with a dual-view switcher:

![Swarm Telemetry Matrix and Peer Inspector](docs/screenshots/swarm_modal.webp)

- **Piece Bitfield & Sequential Streaming Frontier**: Renders verified chunk blocks on disk alongside real-time download blocks and the sequential playback frontier cursor.
- **Swarm Piece Availability Heatmap**: Visualizes piece availability rarity across all connected peers from rare (<25%) to abundant (100%).
- **Multi-Interface Breakdown & Protocol Badging**: Inspects remote peer connections broken down by local physical adapter (Wi-Fi, USB Tether, Ethernet) with clear TCP vs. uTP (Micro Transport Protocol) and WebRTC badges.
- **Dynamic Interface Filtering**: Automatically collapses interface filter tabs to the active connection when only 1 adapter exists, surfacing multi-interface tabs only when $\ge 2$ physical interfaces are bonded.
- **Structured Peer Table with Clean Formatting**: IPv6 addresses are properly truncated with tooltips, preventing column collisions, while independent modal scrolling allows fluid inspection of large swarms.
- **Global GeoIP Topology (Secondary View)**: Toggle over to the interactive vector SVG world map plotting remote peer coordinates and country contributions via offline `geoip-lite`.

### 3. Multi-Network Pooling & Bandwidth Bonding
Svorrent can distribute outgoing peer connections across multiple local interfaces. Additional throughput depends on routing, independent uplinks, peer availability, and network conditions.

![Network Bonding Interface](docs/screenshots/networks.webp)

- **Combined Speed Pooling**: Wi-Fi, cellular tethering, Ethernet, and secondary USB adapters can contribute separate peer connections. Their nominal speeds describe potential capacity; actual torrent speed is not guaranteed to equal their sum.
- **Per-Connection Routing**: Svorrent binds outgoing TCP peer sockets to enabled adapters' local IP addresses. This spreads peer traffic across available interfaces to maximize aggregate throughput.
- **Harmonized Upload Telemetry**: Outgoing BitTorrent protocol messages (piece requests, HAVE notifications, keepalives) are attributed across active interfaces, keeping upload speeds and session counters synchronized with physical adapter egress.
- **iOS Hotspot UDP Keepalive**: Proactive background UDP heartbeats prevent iOS cellular hotspots from dropping during active peer connections.
- **Android USB Tethering (macOS)**: Native `svorrent-tetherd` service automatically manages RNDIS virtual interface binding and DHCP configuration.
- **Per-Adapter Controls & Live Telemetry**: Any interface in the pool can be enabled or disabled on the fly from the Networks dashboard, which displays real-time bandwidth balancing percentages, per-adapter sparklines, and session data counters.

---

## Architecture

```
svorrent/
├── backend/
│   ├── server.js                # Express REST API and WebTorrent orchestration
│   ├── bin/                     # Native compiled daemons and shared libraries
│   │   ├── svorrent-tetherd     # Native background tethering daemon
│   │   ├── libtetherkit*.dylib  # TetherKit C ABI library and symlinks
│   │   └── libusb-1.0.0.dylib  # USB dependency
│   ├── tether/                  # C++ tether daemon source (RNDIS / libusb)
│   ├── lib/
│   │   ├── networks.js          # Multi-interface socket routing & upload attribution
│   │   ├── playability.js       # Buffer-free streaming math, EMA smoothing & ffprobe extraction
│   │   ├── session.js           # Atomic bitfield checkpointing and recovery
│   │   ├── scanner.js           # Directory scanner for orphaned and halfway files
│   │   ├── local-access.js      # Host firewall & loopback origin protection
│   │   ├── safe-path.js         # Directory traversal containment & path validation
│   │   ├── doh.js               # DNS-over-HTTPS anti-censorship lookup
│   │   ├── trackers.js          # Dynamic public tracker fallback lists
│   │   ├── archive.js           # Torrent metadata storage
│   │   └── torrents.js          # Shared lifecycle synchronization and magnet parsing
│   └── scripts/
│       ├── install-tetherd.sh   # Launchd service installer for macOS
│       ├── uninstall-tetherd.sh # Service uninstaller
│       └── e2e-local.js         # Loopback synthetic end-to-end integration test
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # Navigation and global polling loop
│   │   ├── SearchPage.jsx       # Multi-tracker search query interface
│   │   ├── DownloadsManager.jsx # Download queue, action controls, and VLC triggers
│   │   ├── SwarmModal.jsx       # Swarm inspector, country charts, and peer table
│   │   ├── SwarmWorldMap.jsx    # SVG vector map with centroid peer plotting
│   │   ├── NetworksPage.jsx     # Network adapter status and traffic telemetry
│   │   ├── TorrentDetails.jsx   # Inspector for trackers, files, and bitfield pieces
│   │   ├── Icon.jsx             # Accessible vector icon rendering component
│   │   ├── countryUtils.js      # GeoIP country codes, names, and flag emojis
│   │   ├── useDialog.js         # Accessible modal dialog state hook
│   │   └── lib.js               # API client, units formatting, and speed calculations
│   └── package.json
└── scripts/
    ├── build-dmg.sh             # macOS .app bundle and compressed DMG builder
    ├── build-windows.sh         # Windows Win32 launcher, NSIS installer, and portable ZIP builder
    ├── launcher.c               # Native Win32 background daemon launcher (C/MinGW)
    ├── launcher.rc              # Windows icon resource & manifest definition
    ├── manifest.xml             # Windows DPI awareness and security application manifest
    └── installer.nsi            # Nullsoft NSIS installer configuration (LZMA solid compression)
```

---

## Getting Started from Source

### Prerequisites
- Node.js (v18 or higher, recommended v22+)
- Optional: VLC Media Player (`/Applications/VLC.app` or `vlc` in PATH)
- Optional: `ffprobe` for container runtime extraction

### 1. Backend Setup

```bash
cd backend
npm ci
npm start
```

The API service runs on `http://localhost:3001`. Downloads are written to `~/Downloads/Svorrent/`.
For isolated local testing, `SVORRENT_DOWNLOAD_DIR` and `SVORRENT_DATA_DIR` can override those paths. Set `SVORRENT_DISABLE_PUBLIC_DISCOVERY=1` to disable DHT and bundled public trackers while retaining trackers supplied by a magnet link.
With `ffmpeg` installed, run `cd backend && npm run test:e2e` for a synthetic, loopback-only torrent transfer, player launch, and cleanup check. The test uses a temporary download folder and does not touch `~/Downloads/Svorrent`.

### 2. Frontend Setup

```bash
cd frontend
npm ci
npm run dev
```

The interface runs on `http://localhost:5173`.

### 3. Packaging Releases

To build the production desktop distributions (approximately 10–21 MB):

```bash
# Build macOS .dmg (outputs to dist-app/Svorrent.dmg)
cd backend
npm run build:dmg

# Build Windows installer & portable zip (outputs to dist-win/)
cd backend
npm run build:win
```

---

## System Architecture

The following diagram details the interconnectivity between the client interface, backend coordination subsystems, kernel-level network binding, and external peer connections:

```mermaid
flowchart TD
    subgraph Client["Frontend Client (React :5173)"]
        UI_Search["Search Engine<br/>(Query dispatch & tracker deduplication)"]
        UI_Queue["Downloads Manager<br/>(Progress, playability tooltips & VLC triggers)"]
        UI_Details["Torrent Details<br/>(Tracker list, piece map, file tree)"]
        UI_Swarm["Swarm Modal<br/>(SVG vector map, piece availability & peer table)"]
        UI_Net["Network Monitor<br/>(Adapter status & traffic sparklines)"]
    end

    subgraph Server["Backend Core (Express :3001)"]
        API["REST API Router<br/>(/api/search, /api/torrents, /api/networks, /api/play)"]
        
        subgraph SecLayer["Security & Sandboxing"]
            Firewall["Loopback Firewall<br/>(Origin & host header validation)"]
            SafePath["SafePath Sandbox<br/>(Directory traversal containment)"]
            DoH["DoH Resolver<br/>(Anti-censorship tracker resolution)"]
        end

        subgraph TorrentEngine["Torrent Engine"]
            WT["WebTorrent Client<br/>(Sequential piece priority & chunk assembly)"]
            Bitfield["Bitfield Analyzer<br/>(8-bit popcount table & completion state)"]
            Session["Session Manager<br/>(Fast-resume checkpoints & disk reconciliation)"]
        end

        subgraph MediaEngine["Buffer-Free Playability Engine"]
            Probe["ffprobe Metadata Extractor<br/>(Container runtime & bitrate inspection)"]
            Calc["Dynamic Buffer & ETA Evaluator<br/>(Throughput EMA & streaming gate)"]
            Launcher["Player Spawn Controller<br/>(Native VLC execution via OS process)"]
        end

        subgraph NetLayer["Multi-Network Bonding Layer"]
            NetMgr["Interface Coordinator<br/>(Adapter discovery & IP binding registry)"]
            SocketHook["Socket Interceptor<br/>(net.connect localAddress striping)"]
            Keepalive["iOS Hotspot Keepalive<br/>(Proactive UDP heartbeats)"]
            Telemetry["Traffic Accounting<br/>(Per-adapter upload & download distribution)"]
        end
    end

    subgraph OS["Operating System & Local Resources"]
        IF_WiFi["Wi-Fi Adapter (en0)"]
        IF_Tether["Android USB Tether (feth)<br/>(svorrent-tetherd / RNDIS)"]
        IF_Eth["Ethernet / Secondary (en1)"]
        Disk["Filesystem Storage<br/>(~/Downloads/Svorrent/)"]
        VLC["VLC Media Player"]
    end

    subgraph Remote["External Network & Swarm"]
        Trackers["Public Trackers & DHT"]
        Peers["Distributed Peer Swarm"]
    end

    %% Frontend to Backend interactions
    UI_Search -->|Dispatch search query| API
    UI_Queue -->|Poll torrent telemetry| API
    UI_Queue -->|Trigger safe playback| API
    UI_Details -->|Fetch file tree & trackers| API
    UI_Swarm -->|Request peer & GeoIP metrics| API
    UI_Net -->|Fetch adapter throughput| API

    %% Backend internal orchestration
    API --> Firewall
    Firewall --> SafePath
    API --> WT
    API --> NetMgr
    API --> MediaEngine
    
    WT --> Bitfield
    WT --> Session
    Session <--> Disk
    WT --> Disk

    %% Playability flow
    MediaEngine --> Probe
    Probe --> Disk
    Probe --> Calc
    Calc -->|Threshold satisfied| Launcher
    Launcher -->|Spawn process| VLC

    %% Multi-network socket routing
    NetMgr --> SocketHook
    NetMgr --> Telemetry
    SocketHook --> Keepalive
    SocketHook -->|Bind socket IP| IF_WiFi
    SocketHook -->|Bind socket IP| IF_Tether
    SocketHook -->|Bind socket IP| IF_Eth

    %% Uplinks to Remote Swarm
    IF_WiFi -->|TCP Peer Wire| Peers
    IF_Tether -->|TCP Peer Wire| Peers
    IF_Eth -->|TCP Peer Wire| Peers
    WT -->|Announce & scrape via DoH| Trackers
```

---

## Technical Specifications

| Component | Implementation |
| :--- | :--- |
| Core Protocol & Swarm | WebTorrent, P2P Wire Protocol, DHT |
| Desktop Architecture | Native Win32 / macOS browser-client launchers (~10–20 MB packages, zero Electron overhead) |
| Search Engine | Multi-provider aggregation with bounded timeouts & DoH anti-censorship shield |
| Network Routing & Bonding | Multi-interface OS socket binding, iOS hotspot UDP keepalive, and harmonized adapter upload attribution |
| Streaming Readiness Engine | ffprobe metadata extraction + dynamic buffer equation with EMA smoothing and hover ETA |
| Swarm Telemetry | Piece bitfield availability heatmap, interface breakdown, and interactive vector SVG map |
| Security & Sandboxing | Host loopback origin firewall, path traversal containment, and safe directory sandboxing |
| GeoIP Resolution | Offline MaxMind GeoLite database via geoip-lite |
| UI Framework | React 19, Vite, Vanilla CSS |

---

## License

MIT
