/**
 * Utility functions for CT log stream.
 * Node.js-native implementations (no browser dependencies).
 */

/**
 * Decode a URL-safe or standard Base64 string to a Uint8Array.
 */
export function decodeBase64ToBytes(input: string): Uint8Array {
  const normalized = sanitizeBase64(input);
  if (!normalized) {
    throw new Error('Input is empty');
  }
  const buf = Buffer.from(normalized, 'base64');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Convert a Uint8Array to a hex string.
 */
export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/**
 * Sanitize a URL-safe Base64 string to standard Base64.
 */
function sanitizeBase64(value: string): string {
  return value.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
}

/**
 * Read a 3-byte big-endian unsigned integer from a buffer.
 */
export function readUint24(bytes: Uint8Array, offset: number): number {
  if (offset + 3 > bytes.length) {
    throw new Error('Unexpected end of data while reading 3-byte length');
  }
  return (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
}

/**
 * Read a 2-byte big-endian unsigned integer from a buffer.
 */
export function readUint16(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) {
    throw new Error('Unexpected end of data while reading 2-byte length');
  }
  return (bytes[offset] << 8) | bytes[offset + 1];
}

/**
 * Build big-endian BigInt from a byte slice.
 */
export function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

/**
 * Compute SHA-256 hash of a Uint8Array, returning hex string.
 */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
  return toHex(new Uint8Array(hash));
}
