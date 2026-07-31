import type { Readable } from "node:stream";
import { read_uint, read_utf8, write_uint, write_utf8 } from "./buffer";
import {
  epoch_sz,
  key_sz_sz,
  max_key_sz,
  max_record_pos,
  max_record_sz,
  record_pos_sz,
  record_sz_sz,
} from "./def";
import type { Dir } from "./dir";

export interface BitcaskHint {
  readonly key: string;
  readonly record_sz: number;
  readonly record_pos: number;
  readonly epoch: bigint;
}

export function hint_write(
  key: string,
  record_sz: number,
  record_pos: number,
  epoch: bigint,
): Buffer {
  const key_sz = Buffer.byteLength(key, "utf8");

  if (key_sz > max_key_sz) {
    throw new Error(`the key size exceeds ${max_key_sz}.`);
  }
  if (record_sz > max_record_sz) {
    throw new Error(`the record size exceeds ${max_record_sz}.`);
  }
  if (record_pos > max_record_pos) {
    throw new Error(`the record pos exceeds ${max_record_pos}.`);
  }

  const sz = epoch_sz + key_sz_sz + record_sz_sz + record_pos_sz + key_sz;

  let pos = 0;

  const buf = Buffer.allocUnsafe(sz);
  // prettier-ignore
  write_uint(buf, epoch_sz,      epoch,      pos);
  // prettier-ignore
  write_uint(buf, key_sz_sz,     key_sz,     pos += epoch_sz);
  // prettier-ignore
  write_uint(buf, record_sz_sz,  record_sz,  pos += key_sz_sz);
  // prettier-ignore
  write_uint(buf, record_pos_sz, record_pos, pos += record_sz_sz);
  // prettier-ignore
  write_utf8(buf,                key,        pos += record_pos_sz);

  return buf;
}

export function hint_read(buf: Buffer): BitcaskHint {
  let pos = 0;

  // prettier-ignore
  const epoch      = read_uint(buf, epoch_sz,      pos);
  // prettier-ignore
  const key_sz     = read_uint(buf, key_sz_sz,     pos += epoch_sz);
  // prettier-ignore
  const record_sz  = read_uint(buf, record_sz_sz,  pos += key_sz_sz);
  // prettier-ignore
  const record_pos = read_uint(buf, record_pos_sz, pos += record_sz_sz);
  // prettier-ignore
  const key        = read_utf8(buf,                pos += record_pos_sz, key_sz);

  return { key, record_sz, record_pos, epoch };
}

export async function* load_hint_file(stream: Readable): AsyncGenerator<Dir> {
  let epoch: bigint | null = null;
  let key_sz: number | null = null;
  let record_sz: number | null = null;
  let record_pos: number | null = null;
  let key: string | null = null;

  let prev: Buffer | null | undefined;

  for await (const chunk of stream) {
    const buf: Buffer = prev ? Buffer.concat([prev, chunk]) : chunk;
    prev = null;

    const sz = buf.byteLength;

    let start_pos = 0;
    let end_pos = 0;

    do {
      if (epoch === null) {
        start_pos = end_pos;
        end_pos = start_pos + epoch_sz;
        if (end_pos > sz) {
          break;
        }
        epoch = read_uint(buf, epoch_sz, start_pos);
      }

      if (key_sz === null) {
        start_pos = end_pos;
        end_pos = start_pos + key_sz_sz;
        if (end_pos > sz) {
          break;
        }
        key_sz = read_uint(buf, key_sz_sz, start_pos);
      }

      if (record_sz === null) {
        start_pos = end_pos;
        end_pos = start_pos + record_sz_sz;
        if (end_pos > sz) {
          break;
        }
        record_sz = read_uint(buf, record_sz_sz, start_pos);
      }

      if (record_pos === null) {
        start_pos = end_pos;
        end_pos = start_pos + record_pos_sz;
        if (end_pos > sz) {
          break;
        }
        record_pos = read_uint(buf, record_pos_sz, start_pos);
      }

      // if (key === null)
      {
        start_pos = end_pos;
        end_pos = start_pos + key_sz;
        if (end_pos > sz) {
          break;
        }
        key = read_utf8(buf, start_pos, key_sz);
      }

      yield { key, value_sz: null, record_sz, record_pos, epoch };

      epoch = null;
      key_sz = null;
      record_sz = null;
      record_pos = null;
      key = null;
    } while (end_pos < sz);

    if (end_pos > sz) {
      prev = start_pos === 0 ? buf : buf.subarray(start_pos);
    }
  }
}
