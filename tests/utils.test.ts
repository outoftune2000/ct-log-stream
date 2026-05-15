import { describe, it, expect } from 'vitest';
import { decodeBase64ToBytes, toHex, readUint24, readUint16, bytesToBigInt } from '../src/utils.js';

describe('utils', () => {
  describe('decodeBase64ToBytes', () => {
    it('should decode standard base64', () => {
      const result = decodeBase64ToBytes('SGVsbG8=');
      expect(new TextDecoder().decode(result)).toBe('Hello');
    });

    it('should decode URL-safe base64 (replacing _ with /)', () => {
      // 'PDw_Pz8-' is URL-safe encoding of 'PDw/Pz8+' which is '<<???>'
      const result = decodeBase64ToBytes('PDw_Pz8-');
      expect(new TextDecoder().decode(result)).toBe('<<???>');
    });

    it('should decode padded base64 with correct bytes', () => {
      // 'AAECAw==' = bytes [0x00, 0x01, 0x02, 0x03]
      const result = decodeBase64ToBytes('AAECAw==');
      expect(result.length).toBe(4);
      expect(result[0]).toBe(0x00);
      expect(result[1]).toBe(0x01);
      expect(result[2]).toBe(0x02);
      expect(result[3]).toBe(0x03);
    });

    it('should throw on empty input', () => {
      expect(() => decodeBase64ToBytes('')).toThrow('Input is empty');
    });
  });

  describe('toHex', () => {
    it('should convert bytes to hex', () => {
      const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      expect(toHex(bytes)).toBe('deadbeef');
    });

    it('should handle empty array', () => {
      expect(toHex(new Uint8Array())).toBe('');
    });
  });

  describe('readUint24', () => {
    it('should read 3-byte big-endian integer', () => {
      const bytes = new Uint8Array([0x01, 0x02, 0x03]);
      expect(readUint24(bytes, 0)).toBe(0x010203);
    });

    it('should throw on insufficient length', () => {
      const bytes = new Uint8Array([0x01, 0x02]);
      expect(() => readUint24(bytes, 0)).toThrow('Unexpected end of data');
    });
  });

  describe('readUint16', () => {
    it('should read 2-byte big-endian integer', () => {
      const bytes = new Uint8Array([0x12, 0x34]);
      expect(readUint16(bytes, 0)).toBe(0x1234);
    });

    it('should throw on insufficient length', () => {
      const bytes = new Uint8Array([0x12]);
      expect(() => readUint16(bytes, 0)).toThrow('Unexpected end of data');
    });
  });

  describe('bytesToBigInt', () => {
    it('should convert bytes to BigInt', () => {
      const bytes = new Uint8Array([0x00, 0x00, 0x01, 0x86, 0xa0]);
      expect(bytesToBigInt(bytes)).toBe(100000n);
    });

    it('should handle single byte', () => {
      expect(bytesToBigInt(new Uint8Array([0xff]))).toBe(255n);
    });

    it('should handle zero', () => {
      expect(bytesToBigInt(new Uint8Array([0x00, 0x00]))).toBe(0n);
    });
  });
});
