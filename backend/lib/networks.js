// Multi-Network Traffic Aggregation & Interface Bonding Engine
// Inspired by Plexo: binds discrete peer connections to specific local
// network interfaces (Wi-Fi, Ethernet, Mobile Hotspot) to aggregate bandwidth.

import os from 'node:os';
import net from 'node:net';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

function classifyInterface(name, device) {
  const s = `${name} ${device}`.toLowerCase();
  if (/wi-?fi|wireless|wlan|airport|802\.11/.test(s)) return 'wifi';
  if (/ethernet|lan|gigabit/.test(s)) return 'ethernet';
  if (/iphone|ipad|tether|hotspot|cellular|mobile|usb|rndis/.test(s)) return 'cellular';
  if (/bridge|thunderbolt bridge/.test(s)) return 'bridge';
  return 'other';
}

async function getMacHardwarePortNames() {
  const map = new Map();
  if (process.platform !== 'darwin') return map;
  try {
    const { stdout } = await execAsync('networksetup -listallhardwareports');
    const blocks = stdout.split(/\n\s*\n/);
    for (const block of blocks) {
      const lines = block.split('\n');
      let port = null;
      let device = null;
      for (const line of lines) {
        if (line.startsWith('Hardware Port:')) {
          port = line.replace('Hardware Port:', '').trim();
        } else if (line.startsWith('Device:')) {
          device = line.replace('Device:', '').trim();
        }
      }
      if (device && port) {
        map.set(device, port);
      }
    }
  } catch (e) {
    // networksetup unavailable or non-macOS
  }
  return map;
}

export class NetworkManager {
  constructor(clientProvider) {
    this.getClient = clientProvider;
    this.disabledIds = new Set();
    this.simulatedEnabled = false;
    this.hardwarePorts = new Map();
    this.roundRobinIndex = 0;
    this.wireToInterface = new WeakMap();
    this.stats = new Map(); // id -> { downloaded: 0, uploaded: 0, currentDown: 0, currentUp: 0, peers: 0, history: [] }

    // Start background scanner
    this.refreshHardwarePorts();
    this.intervalId = setInterval(() => this.tick(), 1000);
    this.intervalId.unref?.();

    // Hook net.connect to bind outgoing peer sockets to local interfaces
    this.hookNetConnect();
  }

  async refreshHardwarePorts() {
    this.hardwarePorts = await getMacHardwarePortNames();
  }

  hookNetConnect() {
    const originalConnect = net.connect;
    const self = this;

    net.connect = function (...args) {
      let opts = args[0];
      let cb = args[1];

      if (typeof opts === 'number') {
        const port = opts;
        const host = typeof args[1] === 'string' ? args[1] : 'localhost';
        cb = typeof args[1] === 'function' ? args[1] : args[2];
        const chosen = self.pickInterface();
        opts = { port, host };
        if (chosen && chosen.ip && !chosen.isSimulated) {
          opts.localAddress = chosen.ip;
        }
        return originalConnect.call(this, opts, cb);
      } else if (opts && typeof opts === 'object' && opts.host && opts.port && !opts.localAddress) {
        const chosen = self.pickInterface();
        if (chosen && chosen.ip && !chosen.isSimulated) {
          opts.localAddress = chosen.ip;
        }
      }
      return originalConnect.apply(this, args);
    };
  }

  getRealInterfaces() {
    const ifaces = os.networkInterfaces();
    const list = [];

    for (const [device, addrs] of Object.entries(ifaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        // We focus on external IPv4 interfaces for multi-network binding
        if (addr.family === 'IPv4' && !addr.internal) {
          const humanName = this.hardwarePorts.get(device) || (device.startsWith('en') ? `Interface (${device})` : device);
          const type = classifyInterface(humanName, device);
          list.push({
            id: device,
            device,
            name: humanName,
            ip: addr.address,
            netmask: addr.netmask,
            mac: addr.mac,
            type,
            isSimulated: false,
          });
        }
      }
    }

    return list;
  }

  getAvailableInterfaces() {
    const list = this.getRealInterfaces();

    // If simulation is active (for testing multi-adapter bonding on a single network),
    // inject an auxiliary secondary interface
    if (this.simulatedEnabled) {
      list.push({
        id: 'sim0',
        device: 'sim0',
        name: 'Cellular Hotspot (Bonded)',
        ip: '172.20.10.2',
        netmask: '255.255.255.240',
        mac: '02:00:00:11:22:33',
        type: 'cellular',
        isSimulated: true,
      });
    }

    return list;
  }

  pickInterface() {
    const available = this.getAvailableInterfaces().filter((iface) => !this.disabledIds.has(iface.id));
    if (available.length === 0) return null;
    const chosen = available[this.roundRobinIndex % available.length];
    this.roundRobinIndex++;
    return chosen;
  }

  getWireInterface(wire) {
    if (!wire) return null;
    const ifaceId = this.wireToInterface.get(wire);
    if (!ifaceId) return null;
    const ifaces = this.getAvailableInterfaces();
    return ifaces.find((i) => i.id === ifaceId) || null;
  }

  toggleInterface(id, enabled) {
    if (enabled) {
      this.disabledIds.delete(id);
    } else {
      this.disabledIds.add(id);
      // Choke or drop wires currently bound to this interface to avoid traffic leakage
      const client = this.getClient();
      if (client?.torrents) {
        for (const t of client.torrents) {
          if (t.wires) {
            for (const wire of t.wires) {
              const ifaceId = this.wireToInterface.get(wire);
              if (ifaceId === id) {
                try { wire.destroy(); } catch (e) {}
              }
            }
          }
        }
      }
    }
  }

  toggleSimulation(enabled) {
    this.simulatedEnabled = !!enabled;
  }

  // Ticks every 1s to record live speeds and moving history per network adapter
  tick() {
    const client = this.getClient();
    if (!client) return;

    const ifaces = this.getAvailableInterfaces();
    const speedMap = new Map();
    const upMap = new Map();
    const peerMap = new Map();

    for (const iface of ifaces) {
      speedMap.set(iface.id, 0);
      upMap.set(iface.id, 0);
      peerMap.set(iface.id, 0);
    }

    const availableIds = ifaces.filter((i) => !this.disabledIds.has(i.id)).map((i) => i.id);

    // Collect throughput directly from all active torrent wires
    let wireIdx = 0;
    if (client.torrents && availableIds.length > 0) {
      for (const t of client.torrents) {
        if (!t.wires) continue;
        for (const wire of t.wires) {
          let ifaceId = this.wireToInterface.get(wire);
          if (!ifaceId || this.disabledIds.has(ifaceId)) {
            const localAddr = wire.conn?.localAddress || wire.remoteAddress;
            const match = ifaces.find((i) => i.ip === localAddr && !this.disabledIds.has(i.id));
            ifaceId = match ? match.id : availableIds[wireIdx % availableIds.length];
            this.wireToInterface.set(wire, ifaceId);
          }
          wireIdx++;

          const downSpeed = typeof wire.downloadSpeed === 'function' ? wire.downloadSpeed() : 0;
          const upSpeed = typeof wire.uploadSpeed === 'function' ? wire.uploadSpeed() : 0;

          if (speedMap.has(ifaceId)) {
            speedMap.set(ifaceId, speedMap.get(ifaceId) + downSpeed);
            upMap.set(ifaceId, upMap.get(ifaceId) + upSpeed);
            peerMap.set(ifaceId, peerMap.get(ifaceId) + 1);
          }
        }
      }
    }

    // Update cumulative counters and sparkline history (last 24 seconds)
    for (const iface of ifaces) {
      const id = iface.id;
      if (!this.stats.has(id)) {
        this.stats.set(id, {
          downloaded: 0,
          uploaded: 0,
          currentDown: 0,
          currentUp: 0,
          peers: 0,
          history: Array(24).fill(0),
        });
      }
      const st = this.stats.get(id);
      const isEnabled = !this.disabledIds.has(id);
      const currentDown = isEnabled ? (speedMap.get(id) || 0) : 0;
      const currentUp = isEnabled ? (upMap.get(id) || 0) : 0;
      const peers = isEnabled ? (peerMap.get(id) || 0) : 0;

      st.currentDown = currentDown;
      st.currentUp = currentUp;
      st.peers = peers;
      st.downloaded += currentDown;
      st.uploaded += currentUp;

      st.history.push(currentDown);
      if (st.history.length > 24) {
        st.history.shift();
      }
    }
  }

  getSnapshot() {
    const ifaces = this.getAvailableInterfaces();
    let totalDown = 0;
    let totalUp = 0;

    const list = ifaces.map((iface) => {
      const id = iface.id;
      const isEnabled = !this.disabledIds.has(id);
      const st = this.stats.get(id) || {
        downloaded: 0,
        uploaded: 0,
        currentDown: 0,
        currentUp: 0,
        peers: 0,
        history: Array(24).fill(0),
      };
      const currentDown = isEnabled ? (st.currentDown || 0) : 0;
      const currentUp = isEnabled ? (st.currentUp || 0) : 0;

      totalDown += currentDown;
      totalUp += currentUp;

      return {
        id,
        device: iface.device,
        name: iface.name,
        ip: iface.ip,
        type: iface.type,
        isSimulated: !!iface.isSimulated,
        enabled: isEnabled,
        downSpeed: currentDown,
        upSpeed: currentUp,
        downloaded: st.downloaded,
        uploaded: st.uploaded,
        peers: st.peers || 0,
        history: [...st.history],
      };
    });

    const enriched = list.map((item) => ({
      ...item,
      sharePercent: totalDown > 0 ? Math.round((item.downSpeed / totalDown) * 100) : 0,
    }));

    // Aggregate throughput history over time (last 24 data points)
    const historyLength = 24;
    const aggregateHistory = [];
    for (let t = 0; t < historyLength; t++) {
      let tSum = 0;
      for (const item of list) {
        if (item.enabled && item.history) {
          const val = item.history[item.history.length - historyLength + t];
          if (typeof val === 'number') tSum += val;
        }
      }
      aggregateHistory.push(tSum);
    }

    return {
      interfaces: enriched,
      totalDownSpeed: totalDown,
      totalUpSpeed: totalUp,
      totalDownloaded: enriched.reduce((s, i) => s + i.downloaded, 0),
      totalUploaded: enriched.reduce((s, i) => s + i.uploaded, 0),
      bondedCount: enriched.filter((i) => i.enabled).length,
      simulatedActive: this.simulatedEnabled,
      aggregateHistory,
    };
  }
}
