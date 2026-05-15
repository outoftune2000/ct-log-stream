import { describe, it, expect } from 'vitest';
import { parseCtEntry, extractLeafCertificateDer, getLeafCertificateFingerprintSha256 } from '../src/parser.js';

/**
 * Test vectors generated with OpenSSL:
 * - Self-signed ECDSA P-256 cert for CN=example.com, O=TestOrg, C=US
 * - SAN: DNS:example.com, DNS:www.example.com, IP:127.0.0.1
 * - Timestamp: 1718400000000
 *
 * leaf_input: CT X.509 entry with the above cert
 * extra_data (no chain): Just chainTotalLength=0 (3 null bytes)
 * extra_data (with chain): Has one chain cert (same cert, for testing chain parsing)
 */

/** Base64 of the full CT leaf_input for an X.509 entry */
const X509_LEAF_INPUT_B64 = 'AAAAAAGQGJ8gAAAAAAH1MIIB8TCCAZagAwIBAgIUPIfMzE5EimdMrktrdqiCbfcEQVMwCgYIKoZIzj0EAwIwNTEUMBIGA1UEAwwLZXhhbXBsZS5jb20xEDAOBgNVBAoMB1Rlc3RPcmcxCzAJBgNVBAYTAlVTMB4XDTI2MDUxNTEwNDI0MVoXDTI3MDUxNTEwNDI0MVowNTEUMBIGA1UEAwwLZXhhbXBsZS5jb20xEDAOBgNVBAoMB1Rlc3RPcmcxCzAJBgNVBAYTAlVTMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEAA6E/XbQQEyX2B/f39CmKnNaH2Yi15Lec+Xj4aAfbFJiB1Lb3d2dfN7j3Vqd/T0RIui1B8WeBtjjegaVRA4Zi6OBgzCBgDAdBgNVHQ4EFgQU06+mr7F+mGH1Ax/NZpzohuDlwkMwHwYDVR0jBBgwFoAU06+mr7F+mGH1Ax/NZpzohuDlwkMwDwYDVR0TAQH/BAUwAwEB/zAtBgNVHREEJjAkggtleGFtcGxlLmNvbYIPd3d3LmV4YW1wbGUuY29thwR/AAABMAoGCCqGSM49BAMCA0kAMEYCIQDRuEPG7rTXjwWGyHR+tabSm1TrSAFxRXeQUycM3bVf+AIhAMF59I9NETj+tDgYhE0pOaOnczXycnCYZc20FLCt1M01AAA=';

/** Base64 of extra_data with chain total length = 0 (no chain certs) */
const EXTRA_DATA_EMPTY_B64 = 'AAAA';

/** Base64 of extra_data with one chain cert */
const EXTRA_DATA_WITH_CHAIN_B64 = 'AAH4AAH1MIIB8TCCAZagAwIBAgIUPIfMzE5EimdMrktrdqiCbfcEQVMwCgYIKoZIzj0EAwIwNTEUMBIGA1UEAwwLZXhhbXBsZS5jb20xEDAOBgNVBAoMB1Rlc3RPcmcxCzAJBgNVBAYTAlVTMB4XDTI2MDUxNTEwNDI0MVoXDTI3MDUxNTEwNDI0MVowNTEUMBIGA1UEAwwLZXhhbXBsZS5jb20xEDAOBgNVBAoMB1Rlc3RPcmcxCzAJBgNVBAYTAlVTMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEAA6E/XbQQEyX2B/f39CmKnNaH2Yi15Lec+Xj4aAfbFJiB1Lb3d2dfN7j3Vqd/T0RIui1B8WeBtjjegaVRA4Zi6OBgzCBgDAdBgNVHQ4EFgQU06+mr7F+mGH1Ax/NZpzohuDlwkMwHwYDVR0jBBgwFoAU06+mr7F+mGH1Ax/NZpzohuDlwkMwDwYDVR0TAQH/BAUwAwEB/zAtBgNVHREEJjAkggtleGFtcGxlLmNvbYIPd3d3LmV4YW1wbGUuY29thwR/AAABMAoGCCqGSM49BAMCA0kAMEYCIQDRuEPG7rTXjwWGyHR+tabSm1TrSAFxRXeQUycM3bVf+AIhAMF59I9NETj+tDgYhE0pOaOnczXycnCYZc20FLCt1M01';

describe('parser', () => {
  describe('parseCtEntry (X.509 entry)', () => {
    it('should parse a valid X.509 entry', () => {
      const parsed = parseCtEntry(X509_LEAF_INPUT_B64, EXTRA_DATA_EMPTY_B64);

      // CT header fields
      expect(parsed.version).toBe(0);
      expect(parsed.leafType).toBe(0);
      expect(parsed.entryType).toBe(0);
      expect(parsed.entryTypeLabel).toBe('x509_entry');
      expect(parsed.timestampMs).toBe(1718400000000n);
      expect(parsed.timestampIso).toBe(new Date(1718400000000).toISOString());
      expect(parsed.leafCertificateSource).toBe('leaf_input');

      // Leaf cert details
      expect(parsed.leafSubject).toContain('CN=example.com');
      expect(parsed.leafSubject).toContain('O=TestOrg');
      expect(parsed.leafSubject).toContain('C=US');
      expect(parsed.leafIssuer).toContain('CN=example.com');
      expect(parsed.leafIssuer).toContain('O=TestOrg');

      // Domains from SAN
      const domains = parsed.domains.filter((d) => d.domain_full).map((d) => d.domain_full);
      expect(domains).toContain('example.com');
      expect(domains).toContain('www.example.com');

      // IP addresses from SAN
      const ips = parsed.domains.filter((d) => d.ip_address !== '::').map((d) => d.ip_address);
      expect(ips).toContain('::ffff:127.0.0.1');

      // Domain decomposition
      const exampleRow = parsed.domains.find((d) => d.domain_full === 'example.com');
      expect(exampleRow).toBeDefined();
      expect(exampleRow!.domain_base).toBe('example.com');
      expect(exampleRow!.root_domain).toBe('example');
      expect(exampleRow!.tld).toBe('com');
      expect(exampleRow!.subdomain).toBe('');

      const wwwRow = parsed.domains.find((d) => d.domain_full === 'www.example.com');
      expect(wwwRow).toBeDefined();
      expect(wwwRow!.domain_base).toBe('example.com');
      expect(wwwRow!.root_domain).toBe('example');
      expect(wwwRow!.tld).toBe('com');
      expect(wwwRow!.subdomain).toBe('www');

      // Certificate meta fields
      const row = parsed.domains[0];
      expect(row.key_algorithm).toBe('ECDSA');
      expect(row.key_size).toBe(256);
      expect(row.serial_number).toBeTruthy(); // OpenSSL generates a random serial
      expect(row.organization).toBe('TestOrg');
      expect(row.location).toContain('US');
    });

    it('should parse a valid X.509 entry with chain certificates', () => {
      const parsed = parseCtEntry(X509_LEAF_INPUT_B64, EXTRA_DATA_WITH_CHAIN_B64);

      expect(parsed.chainEntries.length).toBe(1);
      expect(parsed.chainEntries[0].index).toBe(1);
      expect(parsed.chainEntries[0].subject).toContain('CN=example.com');
      expect(parsed.chainEntries[0].length).toBeGreaterThan(0);
    });

    it('should throw on too-short leaf_input', () => {
      expect(() => parseCtEntry('AA==', 'AAAA')).toThrow('too short');
    });

    it('should throw on unsupported entry type', () => {
      const bytes = new Uint8Array(20);
      bytes[10] = 0;
      bytes[11] = 2; // unsupported entry type
      const b64 = Buffer.from(bytes).toString('base64');
      expect(() => parseCtEntry(b64, 'AAAA')).toThrow('Unsupported entry type: 2');
    });

    it('should handle missing extra_data chain gracefully', () => {
      expect(() => parseCtEntry(X509_LEAF_INPUT_B64, 'AA==')).toThrow();
    });
  });

  describe('extractLeafCertificateDer', () => {
    it('should extract leaf cert from X.509 entry', () => {
      const extracted = extractLeafCertificateDer(X509_LEAF_INPUT_B64, EXTRA_DATA_EMPTY_B64);
      expect(extracted.length).toBeGreaterThan(0);

      // Verify the extracted DER contains expected ASN.1 structure
      // 3082 = SEQUENCE tag + long form length
      expect(extracted[0]).toBe(0x30);
      expect(extracted[1]).toBe(0x82);

      // Verify it's a valid X.509 cert by reading subject/issuer info later
      const hex = Buffer.from(extracted).toString('hex').toLowerCase();
      expect(hex).toContain('6578616d706c652e636f6d'); // hex of "example.com"
    });
  });

  describe('getLeafCertificateFingerprintSha256', () => {
    it('should compute SHA-256 fingerprint consistently', async () => {
      const fingerprint = await getLeafCertificateFingerprintSha256(X509_LEAF_INPUT_B64, EXTRA_DATA_EMPTY_B64);
      expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);

      // Verify by extracting the DER and computing fingerprint ourselves
      const extractedDer = extractLeafCertificateDer(X509_LEAF_INPUT_B64, EXTRA_DATA_EMPTY_B64);
      const { createHash } = await import('node:crypto');
      const expected = createHash('sha256').update(Buffer.from(extractedDer)).digest('hex');
      expect(fingerprint).toBe(expected);
    });
  });
});
