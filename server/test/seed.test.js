import { describe, expect, it } from 'vitest';
import { parseSeed, normalizeRoomCode } from '../../shared/constants.js';

describe('parseSeed', () => {
  it('accepts integers inside the 32-bit rng domain', () => {
    expect(parseSeed('7').seed).toBe(7);
    expect(parseSeed(777).seed).toBe(777);
    expect(parseSeed(4294967294).seed).toBe(4294967294);
  });

  it('returns null for an empty seed so the server picks one', () => {
    expect(parseSeed(null).seed).toBeNull();
    expect(parseSeed(undefined).seed).toBeNull();
    expect(parseSeed('   ').seed).toBeNull();
  });

  it('rejects values outside 1..2^32-2 with a clear error', () => {
    expect(parseSeed(0).error).toMatch(/integer/i);
    expect(parseSeed(-5).error).toMatch(/integer/i);
    expect(parseSeed('abc').error).toMatch(/integer/i);
    expect(parseSeed(1.5).error).toMatch(/integer/i);
    expect(parseSeed(4294967295).error).toMatch(/integer/i);
    expect(parseSeed(4294967296).error).toMatch(/integer/i);
  });
});

describe('normalizeRoomCode', () => {
  it('keeps only characters the room alphabet actually uses', () => {
    expect(normalizeRoomCode('ab12iO0')).toBe('AB2');
  });

  it('caps at the room code length', () => {
    expect(normalizeRoomCode('23456789')).toBe('234567');
  });

  it('returns an empty string when everything is excluded', () => {
    expect(normalizeRoomCode('Io10')).toBe('');
  });
});

