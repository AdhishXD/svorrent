// DNS-over-HTTPS (DoH) Anti-Censorship Resolver
// Resolves hostnames via Cloudflare (1.1.1.1) and Google DoH JSON APIs
// to bypass local ISP DNS poisoning and SNI filtering on public torrent indexers on the fly.

export async function resolveDoH(hostname) {
  try {
    const dohUrl = `https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`;
    const res = await fetch(dohUrl, {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const json = await res.json();
      const answer = json?.Answer?.find((a) => a.type === 1);
      if (answer?.data) {
        return answer.data;
      }
    }
  } catch {}

  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const json = await res.json();
      const answer = json?.Answer?.find((a) => a.type === 1);
      if (answer?.data) {
        return answer.data;
      }
    }
  } catch {}

  return null;
}
