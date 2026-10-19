// The API has local-file and network controls but no user authentication.
// Only the bundled UI and a local development server should reach it.
export function isLocalHttpUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]') &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

export function localAccess(req, res, next) {
  if (!isLocalHttpUrl(`http://${req.headers.host || ''}`) ||
      (req.headers.origin && !isLocalHttpUrl(req.headers.origin)) ||
      req.headers['sec-fetch-site'] === 'cross-site') {
    return res.status(403).json({ error: 'Local requests only' });
  }
  next();
}
