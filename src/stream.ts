/**
 * CT log streaming engine.
 *
 * Provides two APIs:
 * 1. `CtStream` - EventEmitter-based stream controller
 * 2. `streamCtLogs` - AsyncGenerator-based stream for `for await...of`
 */
import type { CtLog, CtStreamOptions, CtStreamEvent, ParsedCtEntry } from './types.js';
import { fetchCtLogs } from './logList.js';
import { fetchSth, fetchEntries, buildRanges } from './client.js';
import { parseCtEntry } from './parser.js';
import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';

// --------------- Stream event name constants ---------------

type StreamEventName = 'entry' | 'source-meta' | 'range-completed' | 'monitor-tick'
  | 'diff-detected' | 'source-error' | 'ready' | 'fatal-error';

/**
 * A controller for streaming CT log entries in real-time.
 *
 * ```ts
 * const stream = new CtStream({ logListOptions: { operators: ['Cloudflare'] } });
 * stream.on('entry', (event) => console.log(event.parsed.leafSubject));
 * stream.start();
 *
 * setTimeout(() => stream.stop(), 30_000);
 * ```
 */
export class CtStream extends EventEmitter<Record<StreamEventName, [CtStreamEvent]>> {
  /** Resolved CT logs to stream from. */
  private logs: CtLog[] = [];

  /** Configuration with defaults applied. */
  private options!: Required<CtStreamOptions>;

  /** Whether the stream has been cancelled. */
  private cancelled = false;

  /** Tracked tree sizes per log slug, used for diff detection. */
  private treeSizeBySource = new Map<string, number>();

  /**
   * @param options - Stream configuration
   */
  constructor(options: CtStreamOptions = {}) {
    super({ captureRejections: true });

    // Apply defaults
    this.options = {
      logs: options.logs ?? undefined as unknown as CtLog[],
      logListOptions: options.logListOptions ?? undefined as unknown as CtLogListOptions,
      pollIntervalMs: options.pollIntervalMs ?? 10_000,
      maxWindowSize: options.maxWindowSize ?? 1024,
      initialFetchCount: options.initialFetchCount ?? 1024,
      signal: options.signal ?? undefined as unknown as AbortSignal,
    };
  }

  /**
   * Start the stream. Must be called after setting up event listeners.
   * Returns a promise that resolves when the stream fully stops.
   */
  async start(): Promise<void> {
    this.cancelled = false;

    try {
      // 1. Resolve logs (either pre-provided or auto-fetched)
      if (this.options.logs && this.options.logs.length > 0) {
        this.logs = this.options.logs;
      } else {
        this.logs = await fetchCtLogs(this.options.logListOptions);
      }

      // 2. Set up abort signal handling
      if (this.options.signal) {
        if (this.options.signal.aborted) {
          this.cancelled = true;
          return;
        }
        this.options.signal.addEventListener('abort', () => {
          this.cancelled = true;
        }, { once: true });
      }

      // 3. Phase 1: Initial fetch from each source
      let totalDecodedEntries = 0;
      let totalDecodeErrors = 0;

      for (const log of this.logs) {
        if (this.cancelled) break;

        try {
          const sth = await fetchSth(log, this.options.signal);
          const rangeEnd = sth.latestIndex;
          const rangeStart = Math.max(0, rangeEnd - (this.options.initialFetchCount - 1));

          this.treeSizeBySource.set(log.slug, sth.treeSize);

          this.emit('source-meta', {
            type: 'source-meta',
            source: log.slug,
            operator: log.operator,
            treeSize: sth.treeSize,
            latestIndex: sth.latestIndex,
            sthTimestamp: sth.timestamp,
          } as CtStreamEvent);

          const initialResult = await this.streamDecodedRange(log, rangeStart, rangeEnd, 'initial');
          totalDecodedEntries += initialResult.decodedCount;
          totalDecodeErrors += initialResult.decodeErrors;

          this.emit('range-completed', {
            type: 'range-completed',
            source: log.slug,
            operator: log.operator,
            phase: 'initial',
            start: rangeStart,
            end: rangeEnd,
            fetchedCount: initialResult.fetchedCount,
            decodedCount: initialResult.decodedCount,
            decodeErrors: initialResult.decodeErrors,
            fetchEntriesMs: initialResult.fetchEntriesMs,
          } as CtStreamEvent);
        } catch (err) {
          this.emit('source-error', {
            type: 'source-error',
            source: log.slug,
            operator: log.operator,
            phase: 'initial',
            error: 'Failed to process source',
            details: err instanceof Error ? err.message : String(err),
          } as CtStreamEvent);
        }
      }

      this.emit('ready', {
        type: 'ready',
        sources: this.logs.map((l) => l.slug),
        totalDecodedEntries,
        totalDecodeErrors,
      } as CtStreamEvent);

      // 4. Phase 2: Continuous polling
      const POLL_CHECK_MS = 250; // check cancellation every 250ms
      while (!this.cancelled) {
        // Poll in small increments so we respond to abort quickly
        for (let elapsed = 0; elapsed < this.options.pollIntervalMs && !this.cancelled; elapsed += POLL_CHECK_MS) {
          await sleep(POLL_CHECK_MS);
        }
        if (this.cancelled) break;

        for (const log of this.logs) {
          if (this.cancelled) break;

          const previousTreeSize = this.treeSizeBySource.get(log.slug);
          if (typeof previousTreeSize !== 'number') continue;

          try {
            const sth = await fetchSth(log, this.options.signal);
            const diff = sth.treeSize - previousTreeSize;

            this.emit('monitor-tick', {
              type: 'monitor-tick',
              source: log.slug,
              operator: log.operator,
              checkedAt: new Date().toISOString(),
              previousTreeSize,
              currentTreeSize: sth.treeSize,
              diff,
            } as CtStreamEvent);

            if (diff > 0) {
              const newStart = previousTreeSize;
              const newEnd = sth.treeSize - 1;

              this.emit('diff-detected', {
                type: 'diff-detected',
                source: log.slug,
                operator: log.operator,
                previousTreeSize,
                currentTreeSize: sth.treeSize,
                diff,
                start: newStart,
                end: newEnd,
              } as CtStreamEvent);

              const diffResult = await this.streamDecodedRange(log, newStart, newEnd, 'diff');
              totalDecodedEntries += diffResult.decodedCount;
              totalDecodeErrors += diffResult.decodeErrors;

              this.emit('range-completed', {
                type: 'range-completed',
                source: log.slug,
                operator: log.operator,
                phase: 'diff',
                start: newStart,
                end: newEnd,
                fetchedCount: diffResult.fetchedCount,
                decodedCount: diffResult.decodedCount,
                decodeErrors: diffResult.decodeErrors,
                fetchEntriesMs: diffResult.fetchEntriesMs,
              } as CtStreamEvent);
            } else if (diff < 0) {
              // Tree rolled back — reset baseline
              this.treeSizeBySource.set(log.slug, sth.treeSize);
            }

            this.treeSizeBySource.set(log.slug, sth.treeSize);
          } catch (err) {
            this.emit('source-error', {
              type: 'source-error',
              source: log.slug,
              operator: log.operator,
              phase: 'monitor',
              error: 'Failed to monitor source',
              details: err instanceof Error ? err.message : String(err),
            } as CtStreamEvent);
          }
        }
      }
    } catch (err) {
      this.emit('fatal-error', {
        type: 'fatal-error',
        error: 'CT stream failed',
        details: err instanceof Error ? err.message : String(err),
      } as CtStreamEvent);
    }
  }

  /**
   * Stop the stream gracefully. Already-emitted entries will complete,
   * but no new fetches will be initiated.
   */
  stop(): void {
    this.cancelled = true;
  }

  /** Whether the stream has been cancelled. */
  get isCancelled(): boolean {
    return this.cancelled;
  }

  // --------------- Internal helpers ---------------

  /**
   * Fetch and decode a range of entries, emitting them as 'entry' events.
   */
  private async streamDecodedRange(
    log: CtLog,
    start: number,
    end: number,
    phase: 'initial' | 'diff',
  ): Promise<{ fetchedCount: number; decodedCount: number; decodeErrors: number; fetchEntriesMs: number }> {
    let fetchedCount = 0;
    let decodedCount = 0;
    let decodeErrors = 0;
    let fetchEntriesMs = 0;

    const ranges = buildRanges(start, end, this.options.maxWindowSize);

    for (const range of ranges) {
      if (this.cancelled) break;

      const result = await fetchEntries(log, range.start, range.end, this.options.signal);
      fetchEntriesMs += result.fetchMs;
      fetchedCount += result.entries.length;

      for (let offset = 0; offset < result.entries.length; offset++) {
        if (this.cancelled) break;

        const entry = result.entries[offset];
        const logIndex = range.start + offset;

        try {
          const parsed = parseCtEntry(entry.leaf_input, entry.extra_data);
          this.emit('entry', {
            type: 'entry',
            source: log.slug,
            operator: log.operator,
            phase,
            logIndex,
            logId: log.logId,
            parsed,
          } as CtStreamEvent);
          decodedCount += 1;
        } catch {
          decodeErrors += 1;
        }
      }
    }

    return { fetchedCount, decodedCount, decodeErrors, fetchEntriesMs };
  }
}

/**
 * Create an async generator that yields CT log events.
 *
 * This is the simplest API for consuming the stream. The generator cleans up
 * automatically when you break out of the loop or the AbortSignal fires.
 *
 * @param options - Stream configuration
 * @yields {@link CtStreamEvent} objects
 *
 * @example
 * ```ts
 * import { streamCtLogs } from 'ct-log-stream';
 *
 * for await (const event of streamCtLogs({
 *   logListOptions: { operators: ['Cloudflare'] },
 *   signal: AbortSignal.timeout(30_000),
 * })) {
 *   if (event.type === 'entry') {
 *     console.log(event.parsed.leafSubject);
 *   }
 * }
 * ```
 */
export async function* streamCtLogs(options: CtStreamOptions = {}): AsyncGenerator<CtStreamEvent, void, void> {
  const stream = new CtStream(options);
  const queue: CtStreamEvent[] = [];
  let done = false;
  let streamError: Error | null = null;
  let waiter: ((value: void) => void) | null = null;

  // Wire up all events to the queue
  const onEntry = (e: CtStreamEvent) => {
    queue.push(e);
    waiter?.();
  };

  stream.on('entry', onEntry);
  stream.on('source-meta', onEntry);
  stream.on('range-completed', onEntry);
  stream.on('monitor-tick', onEntry);
  stream.on('diff-detected', onEntry);
  stream.on('source-error', onEntry);
  stream.on('ready', onEntry);

  stream.on('fatal-error', (e) => {
    queue.push(e);
    done = true;
    waiter?.();
  });

  // Start stream in background
  const streamPromise = stream.start().then(
    () => { done = true; waiter?.(); },
    (err) => { streamError = err; done = true; waiter?.(); },
  );

  try {
    while (!done || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      if (done) break;
      if (streamError) throw streamError;

      // Wait for next event
      await new Promise<void>((resolve) => {
        waiter = resolve;
      });
    }
  } finally {
    stream.stop();
    // Ensure stream fully shuts down (don't await indefinitely)
    await Promise.race([streamPromise, sleep(5000)]);
  }
}

// Import needed for the options type after defaults
import type { CtLogListOptions } from './types.js';
