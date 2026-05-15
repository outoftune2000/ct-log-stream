import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchSth, fetchEntries, buildRanges } from '../src/client.js';
import type { CtLog } from '../src/types.js';

const MOCK_LOG: CtLog = {
  slug: 'test-log',
  logId: 'abc123',
  operator: 'TestOperator',
  description: 'TestLog',
  url: 'https://ct.test.com/logs/test/',
  getEntriesEndpoint: 'https://ct.test.com/logs/test/ct/v1/get-entries',
  getSthEndpoint: 'https://ct.test.com/logs/test/ct/v1/get-sth',
  temporalStart: '2025-01-01T00:00:00Z',
  temporalEnd: '2026-01-01T00:00:00Z',
};

describe('client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('fetchSth', () => {
    it('should fetch and parse STH response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tree_size: 1000, timestamp: 1718400000000 }),
      } as any);

      const result = await fetchSth(MOCK_LOG);
      expect(result.treeSize).toBe(1000);
      expect(result.latestIndex).toBe(999);
      expect(result.timestamp).toBe(1718400000000);
      expect(result.fetchMs).toBeGreaterThanOrEqual(0);
    });

    it('should throw on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      } as any);

      await expect(fetchSth(MOCK_LOG)).rejects.toThrow('TestOperator get-sth failed with 503');
    });

    it('should throw on missing tree_size', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ timestamp: 1718400000000 }),
      } as any);

      await expect(fetchSth(MOCK_LOG)).rejects.toThrow('did not return a valid tree_size');
    });

    it('should throw on missing timestamp', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tree_size: 1000 }),
      } as any);

      await expect(fetchSth(MOCK_LOG)).rejects.toThrow('did not return a valid timestamp');
    });
  });

  describe('fetchEntries', () => {
    it('should fetch and parse entries', async () => {
      const mockEntries = [
        { leaf_input: 'AAAA', extra_data: 'BBBB' },
        { leaf_input: 'CCCC', extra_data: 'DDDD' },
      ];

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ entries: mockEntries }),
      } as any);

      const result = await fetchEntries(MOCK_LOG, 0, 1);
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].leaf_input).toBe('AAAA');
      expect(result.fetchMs).toBeGreaterThanOrEqual(0);
    });

    it('should filter out entries with missing fields', async () => {
      const mockEntries = [
        { leaf_input: 'AAAA', extra_data: 'BBBB' },
        { leaf_input: 'CCCC' }, // missing extra_data
        { extra_data: 'DDDD' }, // missing leaf_input
        {}, // empty
      ];

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ entries: mockEntries }),
      } as any);

      const result = await fetchEntries(MOCK_LOG, 0, 3);
      expect(result.entries).toHaveLength(1);
    });

    it('should make the correct URL', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ entries: [] }),
      } as any);

      await fetchEntries(MOCK_LOG, 5, 10);

      expect(fetch).toHaveBeenCalledWith(
        'https://ct.test.com/logs/test/ct/v1/get-entries?start=5&end=10',
        expect.any(Object),
      );
    });

    it('should return empty for invalid range', async () => {
      const result = await fetchEntries(MOCK_LOG, 10, 5);
      expect(result.entries).toHaveLength(0);
      expect(result.fetchMs).toBe(0);
    });

    it('should throw on non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as any);

      await expect(fetchEntries(MOCK_LOG, 0, 10)).rejects.toThrow('TestOperator get-entries failed with 500');
    });

    it('should throw when entries field is missing', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as any);

      await expect(fetchEntries(MOCK_LOG, 0, 10)).rejects.toThrow('did not return entries');
    });
  });

  describe('buildRanges', () => {
    it('should split into ranges of maxWindowSize', () => {
      const ranges = buildRanges(0, 3071, 1024);
      expect(ranges).toHaveLength(3);
      expect(ranges[0]).toEqual({ start: 0, end: 1023 });
      expect(ranges[1]).toEqual({ start: 1024, end: 2047 });
      expect(ranges[2]).toEqual({ start: 2048, end: 3071 });
    });

    it('should return single range when within window', () => {
      const ranges = buildRanges(0, 100, 1024);
      expect(ranges).toHaveLength(1);
      expect(ranges[0]).toEqual({ start: 0, end: 100 });
    });

    it('should handle end < start gracefully', () => {
      const ranges = buildRanges(100, 50, 1024);
      expect(ranges).toHaveLength(0);
    });
  });
});
