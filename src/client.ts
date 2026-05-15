/**
 * Low-level CT API HTTP client.
 * Provides typed wrappers around the CT log's REST endpoints.
 */
import type { CtLog, CtSthResponse, CtRawEntry, CtEntriesResponse } from './types.js';

/** Default HTTP headers for CT API requests. */
const FETCH_HEADERS: Record<string, string> = {
  'User-Agent': 'ct-log-stream/0.1.0',
  Accept: '*/*',
};

/**
 * Result of fetching a Signed Tree Head (STH).
 */
export interface SthResult {
  treeSize: number;
  latestIndex: number;
  timestamp: number;
  fetchMs: number;
}

/**
 * Result of fetching a range of entries.
 */
export interface EntriesResult {
  entries: CtRawEntry[];
  fetchMs: number;
}

/**
 * Fetch the latest Signed Tree Head from a CT log.
 *
 * @param log - The CT log configuration
 * @param signal - Optional AbortSignal
 * @returns STH data with the tree size, latest index, and timestamp
 */
export async function fetchSth(log: CtLog, signal?: AbortSignal): Promise<SthResult> {
  const started = Date.now();

  const response = await fetch(log.getSthEndpoint, {
    headers: FETCH_HEADERS,
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`${log.operator} get-sth failed with ${response.status}: ${details}`);
  }

  const payload = (await response.json()) as CtSthResponse;

  if (typeof payload.tree_size !== 'number' || !Number.isSafeInteger(payload.tree_size) || payload.tree_size <= 0) {
    throw new Error(`${log.operator} get-sth did not return a valid tree_size`);
  }

  if (typeof payload.timestamp !== 'number' || !Number.isSafeInteger(payload.timestamp) || payload.timestamp <= 0) {
    throw new Error(`${log.operator} get-sth did not return a valid timestamp`);
  }

  return {
    treeSize: payload.tree_size,
    latestIndex: payload.tree_size - 1,
    timestamp: payload.timestamp,
    fetchMs: Date.now() - started,
  };
}

/**
 * Fetch a range of entries from a CT log.
 *
 * The CT API allows up to 1024 entries per request
 * (start and end indices are inclusive).
 *
 * @param log - The CT log configuration
 * @param start - Start index (inclusive)
 * @param end - End index (inclusive)
 * @param signal - Optional AbortSignal
 * @returns An array of raw entries with metadata
 */
export async function fetchEntries(
  log: CtLog,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<EntriesResult> {
  if (end < start) {
    return { entries: [], fetchMs: 0 };
  }

  const windowSize = end - start + 1;
  if (windowSize > 1024) {
    throw new Error(`CT API allows max 1024 entries per request, requested ${windowSize}`);
  }

  const started = Date.now();

  const target = new URL(log.getEntriesEndpoint);
  target.searchParams.set('start', String(start));
  target.searchParams.set('end', String(end));

  const response = await fetch(target.toString(), {
    headers: FETCH_HEADERS,
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`${log.operator} get-entries failed with ${response.status}: ${details}`);
  }

  const payload = (await response.json()) as CtEntriesResponse;

  if (!Array.isArray(payload.entries)) {
    throw new Error(`${log.operator} get-entries did not return entries`);
  }

  const entries = payload.entries.filter(
    (entry): entry is CtRawEntry =>
      typeof entry?.leaf_input === 'string' && typeof entry?.extra_data === 'string',
  );

  return {
    entries,
    fetchMs: Date.now() - started,
  };
}

/**
 * Build an array of non-overlapping ranges covering [start, end],
 * each respecting the max window size (1024).
 */
export function buildRanges(start: number, end: number, maxWindowSize = 1024): Array<{ start: number; end: number }> {
  if (end < start) {
    return [];
  }

  const ranges: Array<{ start: number; end: number }> = [];
  for (let cursor = start; cursor <= end; cursor += maxWindowSize) {
    ranges.push({
      start: cursor,
      end: Math.min(end, cursor + maxWindowSize - 1),
    });
  }
  return ranges;
}
