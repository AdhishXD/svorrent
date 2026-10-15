# Svorrent

A minimalist, high-speed torrent discovery engine and 1-click launch platform.

## Features

- **Multi-Tracker Aggregation**: Concurrently queries top public indexers (The Pirate Bay, LimeTorrents, TorrentProject) with normalized metadata (seeds, peers, size).
- **Sortable Results Table**: Sort by name, size, seeds, leechers or source; filter by source.
- **Downloads (`/downloads`)**: Filter by state, pause/resume, remove, reveal in Finder/Explorer, open in a desktop player (IINA, VLC, MPC-HC).
- **Torrent Details**: Side panel with files, connected peers, trackers and a piece map.

## Project Structure

```
svorrent/
├── backend/                     # Node.js + Express + WebTorrent
│   ├── server.js                # API endpoints (/api/search, /api/torrents, ...)
│   └── package.json
└── frontend/                    # React + Vite
    ├── src/
    │   ├── App.jsx              # Shell: top bar, routing, shared torrent polling
    │   ├── SearchPage.jsx       # Search + results table
    │   ├── DownloadsManager.jsx # Downloads table (/downloads)
    │   ├── TorrentDetails.jsx   # Files / peers / trackers / pieces panel
    │   ├── Icon.jsx             # Inline SVG icons
    │   ├── lib.js               # API + formatting helpers
    │   └── index.css            # Styles
    └── package.json
```

## Getting Started

### 1. Backend

```bash
cd backend
npm install
node server.js
```

Runs on `http://localhost:3001`. Native downloads save to `~/Downloads/Svorrent/`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:5173`.

## License

MIT

