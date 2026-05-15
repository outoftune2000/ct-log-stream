/**
 * Fetch and filter the Google CT Log List.
 */
import type { CtLog, CtLogListOptions, RawCtLog, RawCtOperator, CtLogListPayload } from './types.js';

const LOG_LIST_URL = 'https://www.gstatic.com/ct/log_list/v3/log_list.json';

/**
 * Default HTTP headers used for CT API requests.
 */
const FETCH_HEADERS: Record<string, string> = {
  'User-Agent': 'ct-log-stream/0.1.0',
  Accept: '*/*',
};

/**
 * Check whether a raw log is in a "usable" state.
 */
function isUsable(log: RawCtLog): boolean {
  return typeof log.state === 'object' && log.state !== null && 'usable' in log.state;
}

/**
 * Check whether a log's temporal interval covers the given date.
 */
function coversDate(log: RawCtLog, date: Date): boolean {
  if (!log.temporal_interval) {
    return false;
  }
  const start = new Date(log.temporal_interval.start_inclusive);
  const end = new Date(log.temporal_interval.end_exclusive);
  return date >= start && date < end;
}

/**
 * Slugify an operator name for use in a unique slug.
 */
function slugifyOperator(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/[,.]?\s*(inc|llc|ltd|gmbh|co|corp|plc)\.?(\b|$)/gi, '')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Extract a machine-friendly log name from the log description.
 */
function extractLogName(description: string): string {
  const quoted = description.match(/'([^']+)'/)?.[1];
  const source = quoted ?? description;
  return source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Build a unique slug from operator name + log description.
 */
function buildSlug(operatorName: string, description: string): string {
  return `${slugifyOperator(operatorName)}-${extractLogName(description)}`;
}

/**
 * Check whether a string includes a query (case-insensitive, partial match).
 */
function nameMatches(name: string, queries: string[]): boolean {
  const lower = name.toLowerCase();
  return queries.some((q) => lower.includes(q.toLowerCase()));
}

/**
 * Fetch the complete Google CT log list, then apply optional filters.
 *
 * Default behaviour: returns only logs that are in "usable" state AND whose
 * temporal interval covers the current date.
 *
 * @param options - Filtering options
 * @returns A sorted array of usable CT log entries
 *
 * @example
 * ```ts
 * // All logs valid for today
 * const logs = await fetchCtLogs();
 *
 * // Only Google and Cloudflare logs, no date filter
 * const logs = await fetchCtLogs({
 *   operators: ['Google', 'Cloudflare'],
 *   withDate: null,
 * });
 *
 * // Exclude certain operators
 * const logs = await fetchCtLogs({ excludeOperators: ['Google'] });
 * ```
 */
export async function fetchCtLogs(options?: CtLogListOptions): Promise<CtLog[]> {
  const response = await fetch(LOG_LIST_URL, {
    headers: FETCH_HEADERS,
    // No caching so we always get the freshest log list
    cache: 'no-store',
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 300);
    throw new Error(`CT log list fetch failed with ${response.status}: ${details}`);
  }

  const payload = (await response.json()) as CtLogListPayload;

  if (!Array.isArray(payload.operators)) {
    throw new Error('CT log list response did not include an operators array.');
  }

  const {
    withDate = new Date(),
    operators,
    excludeOperators,
    includeSlugs,
    excludeSlugs,
    includeNonUsable = false,
  } = options ?? {};

  const dateFilter: Date | null = withDate === undefined ? new Date() : withDate;

  const entries: CtLog[] = [];

  for (const operator of payload.operators) {
    if (!Array.isArray(operator.logs)) {
      continue;
    }

    // Apply operator filters early
    if (operators && operators.length > 0 && !nameMatches(operator.name, operators)) {
      continue;
    }
    if (excludeOperators && excludeOperators.length > 0 && nameMatches(operator.name, excludeOperators)) {
      continue;
    }

    for (const log of operator.logs) {
      // State check
      if (!includeNonUsable && !isUsable(log)) {
        continue;
      }

      // Temporal interval check
      if (dateFilter !== null && !coversDate(log, dateFilter)) {
        continue;
      }

      if (!log.url || !log.temporal_interval) {
        continue;
      }

      const slug = buildSlug(operator.name, log.description);

      // Slug filters
      if (includeSlugs && includeSlugs.length > 0 && !includeSlugs.includes(slug)) {
        continue;
      }
      if (excludeSlugs && excludeSlugs.length > 0 && excludeSlugs.includes(slug)) {
        continue;
      }

      const baseUrl = log.url.endsWith('/') ? log.url : `${log.url}/`;

      entries.push({
        slug,
        logId: log.log_id,
        operator: operator.name,
        description: log.description,
        url: baseUrl,
        getEntriesEndpoint: `${baseUrl}ct/v1/get-entries`,
        getSthEndpoint: `${baseUrl}ct/v1/get-sth`,
        temporalStart: log.temporal_interval.start_inclusive,
        temporalEnd: log.temporal_interval.end_exclusive,
      });
    }
  }

  if (entries.length === 0) {
    throw new Error('No CT logs matched the given filters. The log list may be empty or all logs are outside their temporal intervals.');
  }

  return entries;
}

/**
 * Fetch the CT log list and resolve a single log by slug.
 * Returns `null` if no log matches the slug.
 */
export async function resolveLogBySlug(slug: string, options?: CtLogListOptions): Promise<CtLog | null> {
  const logs = await fetchCtLogs(options);
  return logs.find((l) => l.slug === slug) ?? null;
}
