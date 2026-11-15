// Live Cloudflare Worker + Durable Object relay (bypasses strict hotel/corporate Wi-Fi)
export const DEFAULT_RELAY_URL = 'wss://ttop-party.jaredgoolsby.workers.dev/ws';

const RELAY_STORAGE_KEY = 'tabletop_ar_relay_url';

export function isLocalNodeHost() {
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return true;
  // Private LAN IPv4 ranges (10.x, 192.168.x, 172.16-31.x)
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return true;
  return false;
}

export function getSavedRelayUrl() {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get('relay');
  if (fromQuery) {
    localStorage.setItem(RELAY_STORAGE_KEY, fromQuery);
    return fromQuery;
  }
  return localStorage.getItem(RELAY_STORAGE_KEY) || DEFAULT_RELAY_URL;
}

export function setSavedRelayUrl(url) {
  const clean = String(url || '').trim();
  if (!clean) {
    localStorage.removeItem(RELAY_STORAGE_KEY);
    return '';
  }
  const normalized = normalizeRelayUrl(clean);
  localStorage.setItem(RELAY_STORAGE_KEY, normalized);
  return normalized;
}

export function normalizeRelayUrl(raw) {
  let u = raw.trim();
  if (u.startsWith('https://')) u = 'wss://' + u.slice('https://'.length);
  else if (u.startsWith('http://')) u = 'ws://' + u.slice('http://'.length);
  else if (!u.startsWith('wss://') && !u.startsWith('ws://')) u = 'wss://' + u;
  const parsed = new URL(u);
  if (!parsed.pathname || parsed.pathname === '/') parsed.pathname = '/ws';
  return parsed.toString();
}

export function resolveRelayWebSocketUrl() {
  if (isLocalNodeHost() && !new URLSearchParams(location.search).get('relay')) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }
  const saved = getSavedRelayUrl();
  return saved ? normalizeRelayUrl(saved) : '';
}
