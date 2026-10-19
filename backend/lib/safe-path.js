import path from 'node:path';
import fs from 'node:fs';

// Torrent names and file paths are untrusted metadata. Never let them escape
// the directory selected for that torrent.
export function childPath(base, name) {
  if (typeof base !== 'string' || !base || typeof name !== 'string' || !name ||
      name.includes('\0') || path.isAbsolute(name)) return null;
  const root = path.resolve(base);
  const candidate = path.resolve(root, name);
  const relative = path.relative(root, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  return candidate;
}

export function hasSafeParent(base, candidate) {
  try {
    const root = fs.realpathSync(base);
    const parent = fs.realpathSync(path.dirname(candidate));
    const relative = path.relative(root, parent);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative));
  } catch {
    return false;
  }
}
