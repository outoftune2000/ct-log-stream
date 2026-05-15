import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CtStream } from '../src/stream.js';
import type { CtLog } from '../src/types.js';

const MOCK_LOG: CtLog = {
  slug: 'test-log',
  logId: 'abc123',
  operator: 'TestOp',
  description: 'TestLog',
  url: 'https://ct.test.com/logs/test/',
  getEntriesEndpoint: 'https://ct.test.com/logs/test/ct/v1/get-entries',
  getSthEndpoint: 'https://ct.test.com/logs/test/ct/v1/get-sth',
  temporalStart: '2025-01-01T00:00:00Z',
  temporalEnd: '2026-01-01T00:00:00Z',
};

const MOCK_STH = { tree_size: 5, timestamp: 1718400000000 };

const MOCK_ENTRY = {
  leaf_input: 'AAAAAAGQGJ8gAAAAAAH1MIIB8TCCAZagAwIBAgIUPIfMzE5EimdMrktrdqiCbfcEQVMwCgYIKoZIzj0EAwIwNTEUMBIGA1UEAwwLZXhhbXBsZS5jb20xEDAOBgNVBAoMB1Rlc3RPcmcxCzAJBgNVBAYTAlVTMB4XDTI2MDUxNTEwNDI0MVoXDTI3MDUxNTEwNDI0MVowNTEUMBIGA1UEAwwLZXhhbXBsZS5jb20xEDAOBgNVBAoMB1Rlc3RPcmcxCzAJBgNVBAYTAlVTMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEAA6E/XbQQEyX2B/f39CmKnNaH2Yi15Lec+Xj4aAfbFJiB1Lb3d2dfN7j3Vqd/T0RIui1B8WeBtjjegaVRA4Zi6OBgzCBgDAdBgNVHQ4EFgQU06+mr7F+mGH1Ax/NZpzohuDlwkMwHwYDVR0jBBgwFoAU06+mr7F+mGH1Ax/NZpzohuDlwkMwDwYDVR0TAQH/BAUwAwEB/zAtBgNVHREEJjAkggtleGFtcGxlLmNvbYIPd3d3LmV4YW1wbGUuY29thwR/AAABMAoGCCqGSM49BAMCA0kAMEYCIQDRuEPG7rTXjwWGyHR+tabSm1TrSAFxRXeQUycM3bVf+AIhAMF59I9NETj+tDgYhE0pOaOnczXycnCYZc20FLCt1M01AAA=',
  extra_data: 'AAAA',
};

describe('CtStream (EventEmitter)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should emit source-meta, entry, range-completed, and ready events', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_STH } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ entries: [MOCK_ENTRY] }) } as any);

    const ac = new AbortController();

    const stream = new CtStream({
      logs: [MOCK_LOG],
      pollIntervalMs: 500_000, // way out, won't fire
      initialFetchCount: 5,
      signal: ac.signal,
    });

    const emitted: string[] = [];
    stream.on('source-meta', () => emitted.push('source-meta'));
    stream.on('entry', () => emitted.push('entry'));
    stream.on('range-completed', () => emitted.push('range-completed'));
    stream.on('ready', () => emitted.push('ready'));

    // Start stream and wait for initial phase
    const startPromise = stream.start();
    await new Promise((r) => setTimeout(r, 300));

    // Abort — this triggers cancelled=true and start() exits the while loop
    ac.abort();
    await startPromise;

    expect(emitted).toContain('source-meta');
    expect(emitted).toContain('entry');
    expect(emitted).toContain('range-completed');
    expect(emitted).toContain('ready');
  });

  it('should stop cleanly with pre-aborted signal', async () => {
    const ac = new AbortController();
    ac.abort(); // pre-aborted

    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => MOCK_STH } as any);

    const stream = new CtStream({ logs: [MOCK_LOG], signal: ac.signal });
    await stream.start();

    expect(stream.isCancelled).toBe(true);
  });

  it('should emit source-error on failed source', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    const ac = new AbortController();
    const stream = new CtStream({
      logs: [MOCK_LOG],
      pollIntervalMs: 500_000,
      signal: ac.signal,
    });

    const errors: any[] = [];
    stream.on('source-error', (e: any) => errors.push(e));

    const startPromise = stream.start();
    await new Promise((r) => setTimeout(r, 200));
    ac.abort();
    await startPromise;

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toBe('Failed to process source');
  });

  it('should detect diffs (new entries) on poll', async () => {
    // Two STH calls: first with tree_size=5, second with tree_size=7 (diff=2)
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tree_size: 5, timestamp: 1718400000000 }) } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ entries: [MOCK_ENTRY, MOCK_ENTRY] }) } as any)
      .mockResolvedValue({ ok: true, json: async () => ({ tree_size: 7, timestamp: 1718400001000 }) } as any);

    const ac = new AbortController();

    const stream = new CtStream({
      logs: [MOCK_LOG],
      pollIntervalMs: 200, // short interval for quick poll
      initialFetchCount: 5,
      signal: ac.signal,
    });

    const diffs: any[] = [];
    stream.on('diff-detected', (e: any) => diffs.push(e));

    // Auto-abort after 1.5s, enough for at least one poll cycle
    setTimeout(() => ac.abort(), 1500);

    await stream.start();

    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs[0].diff).toBe(2);
  });
});

describe('streamCtLogs (async generator)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should create an async iterable that can be aborted', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_STH } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ entries: [MOCK_ENTRY] }) } as any);

    const ac = new AbortController();

    const { streamCtLogs } = await import('../src/stream.js');
    const gen = streamCtLogs({
      logs: [MOCK_LOG],
      pollIntervalMs: 500_000,
      signal: ac.signal,
    });

    expect(gen[Symbol.asyncIterator]).toBeDefined();

    // Collect a few events then abort
    setTimeout(() => ac.abort(), 300);

    const events: string[] = [];
    for await (const event of gen) {
      events.push(event.type);
      if (events.length >= 4) break;
    }

    expect(events.length).toBeGreaterThan(0);
  });
});
