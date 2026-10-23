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
