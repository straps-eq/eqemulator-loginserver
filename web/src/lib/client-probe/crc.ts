/**
 * CRC32 as used by the EQ reliable UDP protocol (common/net/crc32.cpp).
 *
 * Standard reflected CRC32 (polynomial 0xEDB88320). The session variant feeds
 * the four bytes of the session's encode key (least significant byte first)
 * into the CRC before the packet data.
 */

const TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function update(crc: number, byte: number): number {
  return (TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0;
}

/** Plain CRC32 of `data` (unsigned 32-bit result). */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = update(crc, data[i]);
  return (~crc) >>> 0;
}

/** CRC32 seeded with a session key, as EQ::Crc32(data, size, key). */
export function crc32Keyed(data: Uint8Array, key: number): number {
  let crc = 0xffffffff;
  for (let i = 0; i < 4; i++) crc = update(crc, (key >>> (i * 8)) & 0xff);
  for (let i = 0; i < data.length; i++) crc = update(crc, data[i]);
  return (~crc) >>> 0;
}
