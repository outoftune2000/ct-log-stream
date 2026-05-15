import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchCtLogs, resolveLogBySlug } from '../src/logList.js';
import type { CtLogListPayload } from '../src/types.js';

// Sample payload mimicking the Google CT log list v3 format
const MOCK_PAYLOAD: CtLogListPayload = {
  operators: [
    {
      name: 'Google',
      logs: [
        {
          description: "'Argon2025'",
          log_id: 'abc123',
          key: 'AAAA',
          url: 'https://ct.googleapis.com/logs/argon2025/',
          mmd: 86400,
          state: { usable: {} },
          temporal_interval: {
            start_inclusive: '2025-01-01T00:00:00Z',
            end_exclusive: '2026-01-01T00:00:00Z',
          },
        },
        {
          description: "'Xenon2025'",
          log_id: 'def456',
          key: 'BBBB',
          url: 'https://ct.googleapis.com/logs/xenon2025/',
          mmd: 86400,
          state: { usable: {} },
          temporal_interval: {
            start_inclusive: '2024-01-01T00:00:00Z',
            end_exclusive: '2025-01-01T00:00:00Z',
          },
        },
      ],
    },
    {
      name: 'Cloudflare',
      logs: [
        {
          description: "'Nimbus2025'",
          log_id: 'ghi789',
          key: 'CCCC',
          url: 'https://ct.cloudflare.com/logs/nimbus2025/',
          mmd: 86400,
          state: { usable: {} },
          temporal_interval: {
            start_inclusive: '2025-03-01T00:00:00Z',
            end_exclusive: '2026-03-01T00:00:00Z',
          },
        },
        {
          description: 'ReadOnly',
          log_id: 'jkl012',
          key: 'DDDD',
          url: 'https://ct.cloudflare.com/logs/readonly/',
          mmd: 86400,
          state: { readonly: {} },
          temporal_interval: {
            start_inclusive: '2025-01-01T00:00:00Z',
            end_exclusive: '2026-01-01T00:00:00Z',
          },
        },
      ],
    },
  ],
};

describe('logList', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set "now" to mid-2025 so temporal intervals covering 2025 are valid
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));

    // Mock global fetch
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_PAYLOAD,
      text: async () => JSON.stringify(MOCK_PAYLOAD),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('should fetch and filter usable logs with valid temporal intervals', async () => {
    const logs = await fetchCtLogs();

    // Should include Google Argon2025 (usable + covers June 2025)
    const argon = logs.find((l) => l.slug.includes('argon'));
    expect(argon).toBeDefined();
    expect(argon?.operator).toBe('Google');
    expect(argon?.getEntriesEndpoint).toBe('https://ct.googleapis.com/logs/argon2025/ct/v1/get-entries');
    expect(argon?.getSthEndpoint).toBe('https://ct.googleapis.com/logs/argon2025/ct/v1/get-sth');

    // Should include Cloudflare Nimbus2025 (usable + covers June 2025)
    const nimbus = logs.find((l) => l.slug.includes('nimbus'));
    expect(nimbus).toBeDefined();

    // Should exclude Xenon2025 (temporal interval ends 2025-01-01 — before June 2025)
    const xenon = logs.find((l) => l.slug.includes('xenon'));
    expect(xenon).toBeUndefined();

    // Should exclude ReadOnly (state doesn't contain 'usable')
    const readonly = logs.find((l) => l.slug.includes('readonly'));
    expect(readonly).toBeUndefined();
  });

  it('should filter by operator name', async () => {
    const logs = await fetchCtLogs({ operators: ['Cloudflare'] });
    expect(logs.every((l) => l.operator === 'Cloudflare')).toBe(true);
    expect(logs.length).toBe(1); // Nimbus2025 should be the only match
  });

  it('should exclude operators', async () => {
    const logs = await fetchCtLogs({ excludeOperators: ['Google'] });
    expect(logs.every((l) => l.operator !== 'Google')).toBe(true);
  });

  it('should include non-usable logs when asked', async () => {
    const logs = await fetchCtLogs({ includeNonUsable: true });
    const readonly = logs.find((l) => l.slug.includes('readonly'));
    expect(readonly).toBeDefined();
  });

  it('should skip date filter when withDate is null', async () => {
    const logs = await fetchCtLogs({ withDate: null });
    // Both Argon2025 and Xenon2025 should be included
    expect(logs.find((l) => l.slug.includes('argon'))).toBeDefined();
    expect(logs.find((l) => l.slug.includes('xenon'))).toBeDefined();
  });

  it('should filter by includeSlugs', async () => {
    const logs = await fetchCtLogs({ includeSlugs: ['google-argon2025'] });
    expect(logs.length).toBe(1);
    expect(logs[0].slug).toBe('google-argon2025');
  });

  it('should filter by excludeSlugs', async () => {
    const logs = await fetchCtLogs({ excludeSlugs: ['cloudflare-nimbus2025'] });
    expect(logs.find((l) => l.slug.includes('nimbus'))).toBeUndefined();
  });

  it('should resolve a log by slug', async () => {
    const log = await resolveLogBySlug('google-argon2025');
    expect(log).not.toBeNull();
    expect(log!.operator).toBe('Google');
  });

  it('should return null for unknown slug', async () => {
    const log = await resolveLogBySlug('nonexistent-log');
    expect(log).toBeNull();
  });

  it('should throw on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Server Error',
    }));

    await expect(fetchCtLogs()).rejects.toThrow('CT log list fetch failed with 500');
  });

  it('should throw when no logs match', async () => {
    // Set date to year 2099 — no logs cover that
    vi.setSystemTime(new Date('2099-01-01T00:00:00Z'));

    await expect(fetchCtLogs()).rejects.toThrow('No CT logs matched');
  });

  it('should generate correct slugs', async () => {
    const logs = await fetchCtLogs();
    const argon = logs.find((l) => l.slug.includes('argon'));
    expect(argon?.slug).toBe('google-argon2025');

    const nimbus = logs.find((l) => l.slug.includes('nimbus'));
    expect(nimbus?.slug).toBe('cloudflare-nimbus2025');
  });
});
