/**
 * Raw CT log entry as returned by Google's log list API.
 */
export interface RawCtLog {
  description: string;
  log_id: string;
  key: string;
  url: string;
  mmd: number;
  state: Record<string, unknown>;
  temporal_interval?: {
    start_inclusive: string;
    end_exclusive: string;
  };
}

/**
 * Raw CT log operator as returned by Google's log list API.
 */
export interface RawCtOperator {
  name: string;
  logs?: RawCtLog[];
}

/**
 * Raw payload from the Google CT log list API.
 */
export interface CtLogListPayload {
  operators: RawCtOperator[];
}

/**
 * A usable CT log entry after filtering and resolution.
 */
export interface CtLog {
  /** Human-readable unique slug (e.g. `google-venafi`-`xenon2025`) */
  slug: string;
  /** Base64-encoded log ID (key hash) */
  logId: string;
  /** Operator name (e.g. "Google", "Cloudflare") */
  operator: string;
  /** Log description (e.g. "Xenon2025") */
  description: string;
  /** Base URL of the CT log server */
  url: string;
  /** Full get-entries endpoint URL */
  getEntriesEndpoint: string;
  /** Full get-sth endpoint URL */
  getSthEndpoint: string;
  /** Temporal interval start (ISO 8601) */
  temporalStart: string;
  /** Temporal interval end (ISO 8601) */
  temporalEnd: string;
}

/**
 * Options for fetching and filtering the CT log list.
 */
export interface CtLogListOptions {
  /**
   * Only include logs whose temporal interval covers this date.
   * Set to `null` to skip temporal filtering entirely.
   * Default: `new Date()`
   */
  withDate?: Date | null;
  /** Only include logs from these operator names (partial match, case-insensitive). */
  operators?: string[];
  /** Exclude logs from these operator names (partial match, case-insensitive). */
  excludeOperators?: string[];
  /** Only include logs with these exact slugs. */
  includeSlugs?: string[];
  /** Exclude logs with these exact slugs. */
  excludeSlugs?: string[];
  /**
   * If true, skips the "usable" state check and includes all logs.
   * Default: false
   */
  includeNonUsable?: boolean;
}

/**
 * Response from the CT log's get-sth endpoint.
 */
export interface CtSthResponse {
  tree_size: number;
  timestamp: number;
  sha256_root_hash?: string;
  tree_head_signature?: string;
}

/**
 * A single raw entry from the CT log's get-entries endpoint.
 */
export interface CtRawEntry {
  leaf_input: string;
  extra_data: string;
}

/**
 * Response from the CT log's get-entries endpoint.
 */
export interface CtEntriesResponse {
  entries: CtRawEntry[];
}

/**
 * Metadata for a single certificate chain link.
 */
export interface ChainEntry {
  index: number;
  length: number;
  subject: string;
  issuer: string;
}

/**
 * A single parsed domain/IP row from a certificate.
 */
export interface ParsedDomainRow {
  ip_address: string;
  domain_full: string;
  domain_base: string;
  root_domain: string;
  tld: string;
  subdomain: string;
  issuer: string;
  not_before: string;
  not_after: string;
  serial_number: string;
  key_algorithm: string;
  key_size: number;
  signature_algorithm: string;
  ocsp_url: string;
  crl_url: string;
  location: string;
  organization: string;
}

/**
 * A fully parsed CT log entry.
 */
export interface ParsedCtEntry {
  /** CT protocol version (usually 0) */
  version: number;
  /** Leaf type */
  leafType: number;
  /** Entry type: 0 = X.509, 1 = Precertificate */
  entryType: number;
  /** Human-readable entry type label */
  entryTypeLabel: string;
  /** Timestamp in milliseconds since epoch */
  timestampMs: bigint;
  /** Timestamp as ISO 8601 string */
  timestampIso: string;
  /** Length of the leaf certificate or TBS data */
  certLength: number;
  /** Length of CT extensions */
  extensionsLength: number;
  /** Where the leaf cert was sourced from */
  leafCertificateSource: string;
  /** Issuer key hash (precert entries only) */
  issuerKeyHashHex?: string;
  /** Leaf certificate Subject DN */
  leafSubject: string;
  /** Leaf certificate Issuer DN */
  leafIssuer: string;
  /** Parsed domain/IP rows from the certificate */
  domains: ParsedDomainRow[];
  /** Total byte length of the certificate chain */
  chainTotalLength: number;
  /** Parsed chain certificates */
  chainEntries: ChainEntry[];
}

/**
 * Options for creating a CT log stream.
 */
export interface CtStreamOptions {
  /**
   * Pre-resolved list of CT logs to stream from.
   * If not provided, logs are auto-fetched using `logListOptions`.
   */
  logs?: CtLog[];
  /**
   * Options for auto-fetching the log list (used when `logs` is not provided).
   */
  logListOptions?: CtLogListOptions;
  /**
   * How often to poll for new entries, in milliseconds.
   * Default: 10_000
   */
  pollIntervalMs?: number;
  /**
   * Maximum number of entries per get-entries request.
   * CT API allows up to 1024. Default: 1024
   */
  maxWindowSize?: number;
  /**
   * How many of the latest entries to fetch on initial connect.
   * Default: 1024 (one window)
   */
  initialFetchCount?: number;
  /**
   * AbortSignal to cancel the stream.
   */
  signal?: AbortSignal;
}

// ---- Event types emitted by the stream ----

/**
 * Base event common to all stream events.
 */
interface CtStreamEventBase {
  /** The log slug that produced this event */
  source: string;
  /** Human-readable operator name */
  operator: string;
}

/**
 * Emitted when a new entry is fetched and parsed.
 */
export interface CtStreamEntryEvent extends CtStreamEventBase {
  type: 'entry';
  phase: 'initial' | 'diff';
  logIndex: number;
  logId: string;
  parsed: ParsedCtEntry;
}

/**
 * Emitted when source metadata (STH result) is obtained.
 */
export interface CtStreamSourceMetaEvent extends CtStreamEventBase {
  type: 'source-meta';
  treeSize: number;
  latestIndex: number;
  sthTimestamp: number;
}

/**
 * Emitted when a single source finishes its initial range.
 */
export interface CtStreamRangeCompletedEvent extends CtStreamEventBase {
  type: 'range-completed';
  phase: 'initial' | 'diff';
  start: number;
  end: number;
  fetchedCount: number;
  decodedCount: number;
  decodeErrors: number;
  fetchEntriesMs: number;
}

/**
 * Emitted on each monitor poll tick.
 */
export interface CtStreamMonitorTickEvent extends CtStreamEventBase {
  type: 'monitor-tick';
  checkedAt: string;
  previousTreeSize: number;
  currentTreeSize: number;
  diff: number;
}

/**
 * Emitted when new entries are detected.
 */
export interface CtStreamDiffDetectedEvent extends CtStreamEventBase {
  type: 'diff-detected';
  previousTreeSize: number;
  currentTreeSize: number;
  diff: number;
  start: number;
  end: number;
}

/**
 * Emitted when an error occurs for a specific source.
 */
export interface CtStreamSourceErrorEvent extends CtStreamEventBase {
  type: 'source-error';
  phase: 'initial' | 'monitor';
  error: string;
  details?: string;
}

/**
 * Emitted when the stream has fully initialized and is monitoring.
 */
export interface CtStreamReadyEvent {
  type: 'ready';
  sources: string[];
  totalDecodedEntries: number;
  totalDecodeErrors: number;
}

/**
 * Emitted on fatal stream errors.
 */
export interface CtStreamFatalErrorEvent {
  type: 'fatal-error';
  error: string;
  details?: string;
}

/**
 * All possible stream event types.
 */
export type CtStreamEvent =
  | CtStreamEntryEvent
  | CtStreamSourceMetaEvent
  | CtStreamRangeCompletedEvent
  | CtStreamMonitorTickEvent
  | CtStreamDiffDetectedEvent
  | CtStreamSourceErrorEvent
  | CtStreamReadyEvent
  | CtStreamFatalErrorEvent;
