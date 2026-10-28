# Dependency security

CI runs a production-dependency audit on both npm lockfiles and uploads the JSON reports. The audit is currently non-gating: on 2026-10-28 the backend had 26 inherited advisories after applying npm's non-breaking fixes (13 high, 2 critical). The frontend had none. A clean CI result therefore means the audit completed, not that the backend has no advisories.

Most unresolved backend advisories enter through the legacy `torrent-search-api` / `request` scraper tree, which has dependencies without maintained fixes. Others enter through WebTorrent's tracker dependency. Do not use `npm audit fix --force`: npm proposes an incompatible tracker downgrade that would break torrent behavior. Replace or isolate the search provider implementation and update the tracker stack with integration tests before making the audit a required clean check.

Dependabot opens weekly pull requests for backend, frontend, and GitHub Actions dependency updates. Review the attached audit report after each change and keep the loopback torrent, browser-download, and media-decoding tests green.
