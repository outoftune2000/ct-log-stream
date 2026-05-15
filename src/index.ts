/**
 * ct-log-stream — Stream Certificate Transparency log entries in real-time.
 *
 * @module
 */

export { fetchCtLogs, resolveLogBySlug } from './logList.js';
export { fetchSth, fetchEntries, buildRanges } from './client.js';
export type { SthResult, EntriesResult } from './client.js';
export { CtStream, streamCtLogs } from './stream.js';
export {
  parseCtEntry,
  extractLeafCertificateDer,
  getLeafCertificateFingerprintSha256,
} from './parser.js';

export type {
  // CT log types
  CtLog,
  CtLogListOptions,
  CtLogListPayload,
  RawCtLog,
  RawCtOperator,

  // Raw API types
  CtSthResponse,
  CtRawEntry,
  CtEntriesResponse,

  // Parsed entry types
  ParsedCtEntry,
  ParsedDomainRow,
  ChainEntry,

  // Stream types
  CtStreamOptions,
  CtStreamEvent,
  CtStreamEntryEvent,
  CtStreamSourceMetaEvent,
  CtStreamRangeCompletedEvent,
  CtStreamMonitorTickEvent,
  CtStreamDiffDetectedEvent,
  CtStreamSourceErrorEvent,
  CtStreamReadyEvent,
  CtStreamFatalErrorEvent,
} from './types.js';
