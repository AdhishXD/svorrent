import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SETTINGS = {
  autoStopSeeding: false,
};

export function createSettingsManager(dataDir) {
  const settingsPath = path.join(dataDir, 'settings.json');

  const load = () => {
    try {
      if (fs.existsSync(settingsPath)) {
        const raw = fs.readFileSync(settingsPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return { ...DEFAULT_SETTINGS, ...parsed };
        }
      }
    } catch (err) {
      console.warn('[settings] failed to read settings.json:', err.message);
    }
    return { ...DEFAULT_SETTINGS };
  };

  let current = load();

  const get = () => ({ ...current });

  const update = (partial) => {
    if (!partial || typeof partial !== 'object') return get();
    current = { ...current, ...partial };
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const tmp = `${settingsPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(current, null, 2), 'utf8');
      fs.renameSync(tmp, settingsPath);
    } catch (err) {
      console.warn('[settings] failed to write settings.json:', err.message);
    }
    return get();
  };

  return { get, update };
}
