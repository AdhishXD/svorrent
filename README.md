# Svorrent

Svorrent is a local BitTorrent client and indexing engine built with Node.js, WebTorrent, and React. It implements sequential piece streaming, multi-network socket bonding across physical interfaces, offline GeoIP swarm visualization, and continuous buffer-free media playback.

---

## Key Features

### 1. Multi-Interface Network Bonding
Svorrent bonds multiple active network interfaces at the OS kernel socket level to aggregate download bandwidth across connections.
- Outgoing peer TCP/uTP connections bind round-robin or proportionally across available network devices (`en0` Wi-Fi, `feth0` USB tether, `en1` Ethernet, etc.).
- An autonomous Android tethering daemon (`scripts/tether-daemon.js`) polls for connected Android handsets via `adb`, configures RNDIS/NCM tethering mode automatically without passwords, assigns local DHCP leases, and establishes multi-path routes.

![Network Bonding Interface](docs/screenshots/networks.png)

### 2. Buffer-Free Streaming & Media Playback
Instead of requiring a torrent to complete before playback, Svorrent calculates an objective buffer threshold and streams growing files directly into VLC or the system default video player.
- The first 25 MB and initial 20 pieces are marked critical to ensure container headers, audio track definitions, and chapter indices download immediately.
- Container runtimes are parsed asynchronously using `ffprobe`.
- Svorrent continuously evaluates the physical streaming condition:
  $$\text{Download ETA} \times 1.20 \le \text{Video Runtime}$$
- The playback button remains disabled while buffering, displaying the exact byte deficit and estimated time remaining on hover. Once the safety margin is reached, the button enables and launches VLC directly against the expanding file on disk.

![Downloads Manager and Streaming Controls](docs/screenshots/downloads.png)

### 3. Swarm Topology & GeoIP Inspector
Every active download includes an integrated swarm inspector accessible from the downloads list.
- Renders an interactive vector SVG map displaying worldwide peer distributions without WebGL dependencies.
- Translates remote peer IPs to physical countries and cities via offline `geoip-lite` databases.
- Categorizes peer wires by physical network interface (Wi-Fi, USB Tether, Ethernet) with individual throughput counters.
- Identifies remote client software signatures (qBittorrent, Transmission, libtorrent, Deluge).

![Swarm Map and Topology Inspector](docs/screenshots/swarm_modal.png)

### 4. Sequential Piece Allocation & Crash Recovery
BitTorrent swarms natively distribute pieces out of order. Svorrent forces strict sequential piece acquisition to support in-progress media playback and predictable disk writes.
- Bitfield verification checkpoints write to `session.json` on every verified piece.
- If the daemon crashes or the system loses power, Svorrent reads existing disk blocks on startup and verifies bitfields against piece hashes, avoiding full re-downloads.
- A local folder scanner detects orphaned or interrupted files in `~/Downloads/Svorrent` and matches them to magnet hashes for one-click resumption.

### 5. Multi-Indexer Search Aggregation
- Concurrently queries public indexers (The Pirate Bay, LimeTorrents, TorrentProject).
- Deduplicates incoming results, normalizes byte representations, and sorts by seeders, leechers, or file size.
- Magnets launch directly into the download pipeline with a single click.

![Search Interface](docs/screenshots/search.png)

---

## Architecture

```
svorrent/
├── backend/
│   ├── server.js                # Express REST API and WebTorrent orchestration
│   ├── lib/
│   │   ├── networks.js          # Kernel-level multi-interface socket routing
│   │   ├── playability.js       # Buffer-free streaming math and ffprobe extraction
│   │   ├── session.js           # Atomic bitfield checkpointing and recovery
│   │   ├── scanner.js           # Directory scanner for orphaned and halfway files
│   │   ├── trackers.js          # Dynamic public tracker fallback lists
│   │   └── archive.js           # Torrent metadata storage
│   └── scripts/
│       ├── tether-daemon.js     # Autonomous Android USB tethering agent
│       ├── install-tetherd.sh   # Launchd service installer for macOS
│       └── uninstall-tetherd.sh # Service uninstaller
└── frontend/
    ├── src/
    │   ├── App.jsx              # Navigation and global polling loop
    │   ├── DownloadsManager.jsx # Download queue, action controls, and VLC triggers
    │   ├── SwarmModal.jsx       # Swarm inspector, country charts, and peer table
    │   ├── SwarmWorldMap.jsx    # SVG vector map with centroid peer plotting
    │   ├── SearchPage.jsx       # Multi-tracker search query interface
    │   ├── NetworksPage.jsx     # Network adapter status and traffic telemetry
    │   └── TorrentDetails.jsx   # Inspector for trackers, files, and bitfield pieces
    └── package.json
```

---

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- Optional: VLC Media Player installed (`/Applications/VLC.app` or `vlc` in PATH)
- Optional: `ffprobe` installed for exact container runtime parsing
- Optional for Android bonding: `adb` installed (`brew install android-platform-tools`)

### 1. Backend Setup

```bash
cd backend
npm install
npm start
```

The backend API initializes on `http://localhost:3001`. Torrents and partial downloads are stored in `~/Downloads/Svorrent/`.

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The web dashboard is accessible at `http://localhost:5173`.

### 3. Optional: Android USB Tether Daemon (macOS)
To automatically bond an Android phone's mobile connection alongside Wi-Fi:

```bash
cd backend
npm run setup:tether
```

This installs a background launchd daemon that detects Android devices connected via USB, enables tethering mode automatically, and exposes the `feth0` network interface to Svorrent.

---

## Technical Specifications

| Component | Implementation |
| :--- | :--- |
| BitTorrent Core | WebTorrent, bittorrent-protocol, bittorrent-dht |
| Network Routing | OS socket binding via local IP assignment |
| Media Analysis | ffprobe metadata extraction + analytic ETA-vs-runtime buffer formula |
| Swarm Map | Native SVG with BBox centroid coordinates (zero WebGL) |
| GeoIP Resolution | Offline MaxMind GeoLite database via geoip-lite |
| UI Framework | React 18, Vite, Vanilla CSS |

---

## License

MIT
