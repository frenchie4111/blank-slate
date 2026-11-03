// Base64 <-> bytes without relying on atob/btoa, which JSC builds of React
// Native don't all provide. Image data URLs run to a few MB, so this works on
// typed arrays and joins output in chunks.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256).fill(255);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;
LOOKUP['-'.charCodeAt(0)] = 62;
LOOKUP['_'.charCodeAt(0)] = 63;

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/\-_]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | LOOKUP[clean.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return o === out.length ? out : out.subarray(0, o);
}

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const CHUNK = 3 * 4096;
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.length);
    let s = '';
    for (let i = start; i < end; i += 3) {
      const n = (bytes[i] << 16) | ((i + 1 < end ? bytes[i + 1] : 0) << 8) | (i + 2 < end ? bytes[i + 2] : 0);
      s += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
      s += i + 1 < end ? ALPHABET[(n >> 6) & 63] : '=';
      s += i + 2 < end ? ALPHABET[n & 63] : '=';
    }
    parts.push(s);
  }
  return parts.join('');
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}
