# ct-log-stream

**Stream Certificate Transparency log entries in real-time.**

Fetch, filter, parse, and tail CT logs from Google's Certificate Transparency log list. Works in Node.js 18+.

## Features

- **Auto-discover** — fetches the official Google CT log list and filters usable servers
- **Temporal filtering** — only use logs whose temporal interval covers a given date
- **Operator & slug filters** — include/exclude specific operators or individual logs
- **Event-based streaming** — `CtStream` class with familiar EventEmitter API
- **Async iterable** — use `for await...of` with the `streamCtLogs()` generator
- **Diff monitoring** — polls each log's STH every N seconds and streams new entries
- **Certificate parsing** — parse raw `leaf_input`/`extra_data` into structured certificate data (subjects, domains, SANs, chain, expiry, fingerprints)
- **Fully typed** — comprehensive TypeScript types for all data structures

## Installation

```bash
npm install ct-log-stream
```

## Quick Start

### 1. Fetch available CT logs

```ts
import { fetchCtLogs } from 'ct-log-stream';

// Default: only usable logs covering the current date
const logs = await fetchCtLogs();
console.log(`Found ${logs.length} active CT logs`);

// Filter by operator
const googleLogs = await fetchCtLogs({ operators: ['Google'] });

// Include all logs regardless of date
const allLogs = await fetchCtLogs({ withDate: null });

// Exclude specific operators
const filtered = await fetchCtLogs({ excludeOperators: ['Google', 'DigiCert'] });
```

### 2. Parse a single CT entry

```ts
import { parseCtEntry } from 'ct-log-stream';

const parsed = parseCtEntry(entry.leaf_input, entry.extra_data);
console.log(`Subject: ${parsed.leafSubject}`);
console.log(`Issuer: ${parsed.leafIssuer}`);
console.log(`Timestamp: ${parsed.timestampIso}`);
for (const domain of parsed.domains) {
  console.log(`  Domain: ${domain.domain_full || domain.ip_address}`);
  console.log(`  Issuer: ${domain.issuer}`);
  console.log(`  Valid: ${domain.not_before} → ${domain.not_after}`);
  console.log(`  Key: ${domain.key_algorithm} ${domain.key_size}bit`);
  console.log(`  Signature: ${domain.signature_algorithm}`);
  console.log(`  OCSP: ${domain.ocsp_url}`);
  console.log(`  CRL: ${domain.crl_url}`);
  console.log(`  Org: ${domain.organization}`);
  console.log(`  Location: ${domain.location}`);
}
```

### 3. Stream CT logs in real-time (EventEmitter)

```ts
import { CtStream } from 'ct-log-stream';

const stream = new CtStream({
  logListOptions: { operators: ['Cloudflare'] },
  pollIntervalMs: 10_000,       // check for new entries every 10s
  initialFetchCount: 1024,       // fetch last 1024 entries on connect
});

stream.on('source-meta', (event) => {
  console.log(`${event.operator}: ${event.treeSize} entries`);
});

stream.on('entry', (event) => {
  console.log(`[${event.operator}] idx=${event.logIndex} cn=${event.parsed.leafSubject}`);
  for (const d of event.parsed.domains) {
    console.log(`  - ${d.domain_full || d.ip_address}`);
  }
});

stream.on('diff-detected', (event) => {
  console.log(`${event.operator}: ${event.diff} new entries detected`);
});

stream.on('source-error', (event) => {
  console.error(`${event.operator} error: ${event.error}`);
});

stream.on('ready', () => {
  console.log('All sources initialized, entering monitoring mode');
});

stream.start();

// Stop after 60 seconds
setTimeout(() => stream.stop(), 60_000);
```

### 4. Stream CT logs using async iteration

```ts
import { streamCtLogs } from 'ct-log-stream';

const ac = new AbortController();

// Auto-stop after 30 seconds
setTimeout(() => ac.abort(), 30_000);

for await (const event of streamCtLogs({
  logListOptions: { operators: ['Google'] },
  signal: ac.signal,
})) {
  switch (event.type) {
    case 'entry':
      console.log(`[${event.operator}] idx=${event.logIndex} ${event.parsed.leafSubject}`);
      break;
    case 'source-meta':
      console.log(`${event.operator}: tree has ${event.treeSize} entries`);
      break;
    case 'fatal-error':
      console.error(`Fatal: ${event.error}`);
      break;
    case 'ready':
      console.log('Monitoring started');
      break;
  }
}
```

## API Reference

### `fetchCtLogs(options?)`

Fetches the [Google CT Log List v3](https://www.gstatic.com/ct/log_list/v3/log_list.json) and returns filtered, usable log entries.

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `withDate` | `Date \| null` | `new Date()` | Filter logs whose temporal interval covers this date. `null` = skip filtering. |
| `operators` | `string[]` | — | Only include logs from these operators (case-insensitive partial match). |
| `excludeOperators` | `string[]` | — | Exclude logs from these operators. |
| `includeSlugs` | `string[]` | — | Only include logs with these exact slugs. |
| `excludeSlugs` | `string[]` | — | Exclude logs with these slugs. |
| `includeNonUsable` | `boolean` | `false` | Include logs with non-"usable" state. |

**Returns:** `Promise<CtLog[]>`

---

### `CtStream` class

EventEmitter-based stream controller.

**Constructor options (`CtStreamOptions`):**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `logs` | `CtLog[]` | — | Pre-resolved log list. If omitted, auto-fetched via `logListOptions`. |
| `logListOptions` | `CtLogListOptions` | — | Options for auto-fetching logs. |
| `pollIntervalMs` | `number` | `10000` | How often to check for new entries (ms). |
| `maxWindowSize` | `number` | `1024` | Max entries per `get-entries` request. |
| `initialFetchCount` | `number` | `1024` | How many recent entries to fetch initially. |
| `signal` | `AbortSignal` | — | AbortSignal to cancel the stream. |

**Methods:**

| Method | Description |
|--------|-------------|
| `start()` | Begin streaming. Returns promise that resolves when fully stopped. |
| `stop()` | Gracefully stop the stream. |

**Events:**

| Event | Payload Shape | Description |
|-------|---------------|-------------|
| `entry` | `CtStreamEntryEvent` | A new entry was fetched and parsed. |
| `source-meta` | `CtStreamSourceMetaEvent` | STH metadata for a log (tree size, timestamp). |
| `range-completed` | `CtStreamRangeCompletedEvent` | A batch of entries finished fetching. |
| `monitor-tick` | `CtStreamMonitorTickEvent` | A poll check completed (no new entries). |
| `diff-detected` | `CtStreamDiffDetectedEvent` | New entries were detected on poll. |
| `source-error` | `CtStreamSourceErrorEvent` | An error occurred for a specific log. |
| `ready` | `CtStreamReadyEvent` | All sources initialized, monitoring started. |
| `fatal-error` | `CtStreamFatalErrorEvent` | A non-recoverable error occurred. |

---

### `streamCtLogs(options?)`

Async generator that yields `CtStreamEvent` objects. Cleans up automatically on abort/break.

**Options:** Same as `CtStreamOptions`.

**Yields:** `CtStreamEvent` — union of all event types (discriminated by `type` field).

---

### `parseCtEntry(leafInputB64, extraDataB64)`

Parse a raw CT log entry into structured certificate data.

**Parameters:**
- `leafInputB64` (string) — Base64-encoded leaf input from the CT log
- `extraDataB64` (string) — Base64-encoded extra data

**Returns:** `ParsedCtEntry` with all certificate fields.

### `extractLeafCertificateDer(leafInputB64, extraDataB64)`

Extract just the raw DER bytes of the leaf certificate.

**Returns:** `Uint8Array`

### `getLeafCertificateFingerprintSha256(leafInputB64, extraDataB64)`

Compute the SHA-256 fingerprint of the leaf certificate.

**Returns:** `Promise<string>` — hex-encoded SHA-256 hash.

### `fetchSth(log, signal?)`

Fetch the Signed Tree Head from a specific CT log.

**Returns:** `Promise<SthResult>` with `treeSize`, `latestIndex`, `timestamp`, `fetchMs`.

### `fetchEntries(log, start, end, signal?)`

Fetch a range of entries from a specific CT log (max 1024 at a time).

**Returns:** `Promise<EntriesResult>` with `entries` and `fetchMs`.

---

## `CtLog` fields

| Field | Type | Description |
|-------|------|-------------|
| `slug` | `string` | Unique human-readable identifier (e.g. `google-argon2025`). |
| `logId` | `string` | Base64-encoded log ID (key hash). |
| `operator` | `string` | Operator name (e.g. "Google", "Cloudflare"). |
| `description` | `string` | Log description (e.g. "Argon2025"). |
| `url` | `string` | Base URL of the CT log server. |
| `getEntriesEndpoint` | `string` | Full URL for `/ct/v1/get-entries`. |
| `getSthEndpoint` | `string` | Full URL for `/ct/v1/get-sth`. |
| `temporalStart` | `string` | Temporal interval start (ISO 8601). |
| `temporalEnd` | `string` | Temporal interval end (ISO 8601). |

## `ParsedCtEntry` fields

| Field | Type | Description |
|-------|------|-------------|
| `version` | `number` | CT protocol version (usually 0). |
| `leafType` | `number` | Leaf certificate type. |
| `entryType` | `number` | `0` = X.509 entry, `1` = precertificate entry. |
| `entryTypeLabel` | `string` | `"x509_entry"` or `"precert_entry"`. |
| `timestampMs` | `bigint` | Certificate timestamp (ms since epoch). |
| `timestampIso` | `string` | Timestamp as ISO 8601 UTC string. |
| `certLength` | `number` | Length of leaf cert / TBS data in bytes. |
| `extensionsLength` | `number` | Length of CT extensions. |
| `leafCertificateSource` | `string` | Source of leaf cert. |
| `issuerKeyHashHex` | `string?` | Issuer key hash (precert only). |
| `leafSubject` | `string` | Leaf certificate Subject DN. |
| `leafIssuer` | `string` | Leaf certificate Issuer DN. |
| `domains` | `ParsedDomainRow[]` | Parsed domains, IPs, and cert metadata. |
| `chainTotalLength` | `number` | Total chain byte length. |
| `chainEntries` | `ChainEntry[]` | Parsed chain certificates. |

### `ParsedDomainRow` fields (per entry in `domains[]`)

| Field | Type | Description |
|-------|------|-------------|
| `ip_address` | `string` | IPv6-normalized IP (e.g. `::ffff:1.2.3.4`). |
| `domain_full` | `string` | Full DNS name (e.g. `www.example.com`). |
| `domain_base` | `string` | Base domain (e.g. `example.com`). |
| `root_domain` | `string` | Second-level domain label (e.g. `example`). |
| `tld` | `string` | TLD (e.g. `com`, `co.uk`). |
| `subdomain` | `string` | Subdomain portion. |
| `issuer` | `string` | Certificate issuer DN. |
| `not_before` | `string` | Validity start (UTC). |
| `not_after` | `string` | Validity end (UTC). |
| `serial_number` | `string` | Certificate serial number. |
| `key_algorithm` | `string` | Key algorithm (e.g. `ECDSA`, `RSA`). |
| `key_size` | `number` | Key size in bits. |
| `signature_algorithm` | `string` | Signature algorithm. |
| `ocsp_url` | `string` | OCSP responder URL. |
| `crl_url` | `string` | CRL distribution point URL. |
| `location` | `string` | Locality/State/Country. |
| `organization` | `string` | Organization name. |

## Advanced Examples

### One-shot: fetch entries without streaming

```ts
import { fetchCtLogs, fetchSth, fetchEntries } from 'ct-log-stream';

const [log] = await fetchCtLogs({ operators: ['Cloudflare'] });
const sth = await fetchSth(log);
const range = await fetchEntries(log, sth.latestIndex - 10, sth.latestIndex);

for (const entry of range.entries) {
  const parsed = parseCtEntry(entry.leaf_input, entry.extra_data);
  console.log(parsed.leafSubject);
}
```

### Query specific logs by slug

```ts
import { fetchCtLogs } from 'ct-log-stream';

const logs = await fetchCtLogs({
  includeSlugs: ['google-argon2025', 'cloudflare-nimbus2025'],
  withDate: null,
});
```

### Filter logs by date range

```ts
import { fetchCtLogs } from 'ct-log-stream';

// Only logs active in June 2025
const logs = await fetchCtLogs({
  withDate: new Date('2025-06-01'),
});
```

## Development

```bash
# Install
npm install

# Build
npm run build

# Test
npm test

# Watch mode
npm run test:watch

# Type-check
npm run typecheck
```

## License

MIT
