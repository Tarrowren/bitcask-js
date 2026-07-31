import type { Readable } from "node:stream";
import {
  read_byte,
  read_uint,
  read_utf8,
  write_byte,
  write_uint,
  write_utf8,
} from "./buffer";
import crc32 from "./crc32";
import {
  crc_sz,
  epoch_sz,
  key_sz_sz,
  max_key_sz,
  max_record_sz,
  max_value_sz,
  TOMBSTONE,
  value_sz_sz,
} from "./def";
import type { Dir } from "./dir";

export interface BitcaskRecord {
  readonly key: string;
  readonly value: Buffer;
  readonly epoch: bigint;
}

export function record_write(
  key: string,
  value: Buffer,
  epoch: bigint,
): Buffer {
  const key_sz = Buffer.byteLength(key, "utf8");
  const value_sz = value.byteLength;

  if (key_sz > max_key_sz) {
    throw new Error(`the key size exceeds ${max_key_sz}.`);
  }
  if (value_sz > max_value_sz) {
    throw new Error(`the value size exceeds ${max_value_sz}.`);
  }

  const sz = crc_sz + epoch_sz + key_sz_sz + value_sz_sz + key_sz + value_sz;
  if (sz > max_record_sz) {
    throw new Error(`the record size exceeds ${max_record_sz}.`);
  }

  let pos = 0;

  const buf = Buffer.allocUnsafeSlow(sz);
  // prettier-ignore
  write_uint(buf, epoch_sz,    epoch,    pos += crc_sz);
  // prettier-ignore
  write_uint(buf, key_sz_sz,   key_sz,   pos += epoch_sz);
  // prettier-ignore
  write_uint(buf, value_sz_sz, value_sz, pos += key_sz_sz);
  // prettier-ignore
  write_utf8(buf,              key,      pos += value_sz_sz);
  // prettier-ignore
  write_byte(buf,              value,    pos += key_sz);

  const crc = crc32(buf.subarray(crc_sz));
  // prettier-ignore
  write_uint(buf, crc_sz,      crc,      0);

  return buf;
}

export function record_delete(key: string, epoch: bigint): Buffer {
  const key_sz = Buffer.byteLength(key, "utf8");

  if (key_sz > max_key_sz) {
    throw new Error(`the key size exceeds ${max_key_sz}.`);
  }

  const sz = crc_sz + epoch_sz + key_sz_sz + value_sz_sz + key_sz;
  if (sz > max_record_sz) {
    throw new Error(`the record size exceeds ${max_record_sz}.`);
  }

  let pos = 0;

  const buf = Buffer.allocUnsafe(sz);
  // prettier-ignore
  write_uint(buf, epoch_sz,    epoch,       pos += crc_sz);
  // prettier-ignore
  write_uint(buf, key_sz_sz,   key_sz,      pos += epoch_sz);
  // prettier-ignore
  write_uint(buf, value_sz_sz, TOMBSTONE,   pos += key_sz_sz);
  // prettier-ignore
  write_utf8(buf,              key,         pos += value_sz_sz);

  const crc = crc32(buf.subarray(crc_sz));
  // prettier-ignore
  write_uint(buf, crc_sz,      crc,         0);

  return buf;
}

export function record_read(buf: Buffer): BitcaskRecord | undefined {
  let pos = 0;

  // prettier-ignore
  const crc      = read_uint(buf, crc_sz,      pos);
  // prettier-ignore
  const epoch    = read_uint(buf, epoch_sz,    pos += crc_sz);
  // prettier-ignore
  const key_sz   = read_uint(buf, key_sz_sz,   pos += epoch_sz);
  // prettier-ignore
  const value_sz = read_uint(buf, value_sz_sz, pos += key_sz_sz);
  // prettier-ignore
  const key      = read_utf8(buf,              pos += value_sz_sz, key_sz);

  const check_crc = crc32(buf.subarray(crc_sz));
  if (crc !== check_crc) {
    console.warn(`crc error. key(${key}).`);
    return;
  }

  if (value_sz === TOMBSTONE) {
    return;
  }

  // prettier-ignore
  const value    = read_byte(buf,              pos += key_sz, value_sz);

  return { key, value, epoch };
}

export async function* load_older_data_file(
  stream: Readable,
): AsyncGenerator<Dir> {
  let file_pos = 0;
  let check_crc = 0;

  let crc: number | null = null;
  let epoch: bigint | null = null;
  let key_sz: number | null = null;
  let value_sz: number | null = null;
  let key: string | null = null;
  let value_crc_pos: number = 0;

  let prev: Buffer | null | undefined;

  for await (const chunk of stream) {
    const buf: Buffer = prev ? Buffer.concat([prev, chunk]) : chunk;
    prev = null;

    const sz = buf.byteLength;

    let start_pos = 0;
    let end_pos = 0;

    do {
      if (crc === null) {
        start_pos = end_pos;
        end_pos = start_pos + crc_sz;
        if (end_pos > sz) {
          break;
        }
        crc = read_uint(buf, crc_sz, start_pos);
        check_crc = 0;
      }

      if (epoch === null) {
        start_pos = end_pos;
        end_pos = start_pos + epoch_sz;
        if (end_pos > sz) {
          break;
        }
        epoch = read_uint(buf, epoch_sz, start_pos);
        check_crc = crc32(buf.subarray(start_pos, end_pos), check_crc);
      }

      if (key_sz === null) {
        start_pos = end_pos;
        end_pos = start_pos + key_sz_sz;
        if (end_pos > sz) {
          break;
        }
        key_sz = read_uint(buf, key_sz_sz, start_pos);
        check_crc = crc32(buf.subarray(start_pos, end_pos), check_crc);
      }

      if (value_sz === null) {
        start_pos = end_pos;
        end_pos = start_pos + value_sz_sz;
        if (end_pos > sz) {
          break;
        }
        value_sz = read_uint(buf, value_sz_sz, start_pos);
        check_crc = crc32(buf.subarray(start_pos, end_pos), check_crc);
      }

      if (key === null) {
        start_pos = end_pos;
        end_pos = start_pos + key_sz;
        if (end_pos > sz) {
          break;
        }
        key = read_utf8(buf, start_pos, key_sz);
        check_crc = crc32(buf.subarray(start_pos, end_pos), check_crc);
      }

      // if (value === null)
      {
        start_pos = end_pos;
        if (value_sz !== TOMBSTONE) {
          end_pos = start_pos + value_sz - value_crc_pos;
          if (end_pos > sz) {
            if (start_pos < sz) {
              end_pos = sz;
              check_crc = crc32(buf.subarray(start_pos, end_pos), check_crc);
              value_crc_pos += end_pos - start_pos;
            }
            break;
          }

          check_crc = crc32(buf.subarray(start_pos, end_pos), check_crc);
        }
      }

      const record_sz =
        crc_sz +
        epoch_sz +
        key_sz_sz +
        value_sz_sz +
        key_sz +
        (value_sz === TOMBSTONE ? 0 : value_sz);
      const record_pos = file_pos;
      file_pos = record_pos + record_sz;

      if (crc !== check_crc) {
        console.warn(`crc error. key(${key}).`);
      } else {
        yield { key, value_sz, record_sz, record_pos, epoch };
      }

      crc = null;
      epoch = null;
      key_sz = null;
      value_sz = null;
      key = null;
      value_crc_pos = 0;
    } while (end_pos < sz);

    if (end_pos > sz) {
      prev = start_pos === 0 ? buf : buf.subarray(start_pos);
    }
  }
}
