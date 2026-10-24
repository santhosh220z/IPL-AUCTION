const VIRTUAL_NAME = /veth|wsl|hyper|docker|vmware|virtual/i;

export function lanAddresses(interfaces) {
  const found = [];
  for (const [name, entries] of Object.entries(interfaces ?? {})) {
    for (const entry of entries ?? []) {
      if (!entry || entry.internal || entry.family !== 'IPv4') continue;
      if (entry.address.startsWith('169.254.')) continue;
      if (VIRTUAL_NAME.test(name)) continue;
      found.push({ name, address: entry.address });
    }
  }
  return found;
}

export function bestLanAddress(list) {
  return list[0] ?? null;
}

// The invite-link base must match how the visitor actually reached the server:
// a LAN teammate's request says http://192.168.x.x:3001, a public host behind a
// TLS proxy says https://<app>.onrender.com. PUBLIC_URL only wins when it parses.
export function deriveBaseUrl({ publicUrl, protocol, host }) {
  if (publicUrl && URL.canParse(publicUrl) && /^https?:$/.test(new URL(publicUrl).protocol)) {
    return publicUrl.replace(/\/+$/, '');
  }
  if (!host || !protocol) return null;
  if (protocol !== 'http' && protocol !== 'https') return null;
  return `${protocol}://${host}`;
}
