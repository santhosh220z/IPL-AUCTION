import { describe, expect, it } from 'vitest';
import { bestLanAddress, deriveBaseUrl, lanAddresses } from '../lan.js';

const iface = (address, family = 'IPv4', internal = false) => ({ address, family, internal });

describe('lanAddresses', () => {
  it('keeps usable IPv4 addresses with their interface name', () => {
    const list = lanAddresses({
      'Wi-Fi': [iface('192.168.1.35')],
      Ethernet: [iface('10.0.0.4')],
    });
    expect(list).toEqual([
      { name: 'Wi-Fi', address: '192.168.1.35' },
      { name: 'Ethernet', address: '10.0.0.4' },
    ]);
  });

  it('drops loopback, link-local, IPv6, and virtual adapters', () => {
    const list = lanAddresses({
      Lo: [iface('127.0.0.1', 'IPv4', true)],
      'vEthernet (WSL (Hyper-V firewall))': [iface('172.27.128.1')],
      'Local Area Connection* 2': [iface('169.254.166.180')],
      Docker: [iface('172.17.0.1')],
      'Wi-Fi 2': [iface('fe80::1', 'IPv6')],
    });
    expect(list).toEqual([]);
  });

  it('returns empty for missing or empty interface maps', () => {
    expect(lanAddresses({})).toEqual([]);
    expect(lanAddresses()).toEqual([]);
  });
});

describe('bestLanAddress', () => {
  it('returns the first usable address and null when none exist', () => {
    const list = [
      { name: 'Wi-Fi', address: '192.168.1.35' },
      { name: 'Ethernet', address: '10.0.0.4' },
    ];
    expect(bestLanAddress(list)).toEqual({ name: 'Wi-Fi', address: '192.168.1.35' });
    expect(bestLanAddress([])).toBeNull();
  });
});

describe('deriveBaseUrl', () => {
  it('prefers an explicit PUBLIC_URL override', () => {
    expect(
      deriveBaseUrl({ publicUrl: 'https://game.example.com', protocol: 'http', host: '10.2.3.4:3001' }),
    ).toBe('https://game.example.com');
  });

  it('derives the request origin when behind a proxy', () => {
    expect(
      deriveBaseUrl({ protocol: 'https', host: 'ipl-auction.onrender.com' }),
    ).toBe('https://ipl-auction.onrender.com');
  });

  it('keeps the LAN host that the visitor actually typed', () => {
    expect(
      deriveBaseUrl({ protocol: 'http', host: '192.168.1.35:3001' }),
    ).toBe('http://192.168.1.35:3001');
    expect(
      deriveBaseUrl({ protocol: 'http', host: 'localhost:3001' }),
    ).toBe('http://localhost:3001');
  });

  it('returns null without a host and never mangles garbage', () => {
    expect(deriveBaseUrl({ protocol: 'https', host: '' })).toBeNull();
    expect(deriveBaseUrl({ protocol: 'ftp', host: 'x' })).toBeNull();
    expect(deriveBaseUrl({ publicUrl: 'not a url', protocol: 'http', host: '192.168.1.35' })).toBe(
      'http://192.168.1.35',
    );
  });
});
