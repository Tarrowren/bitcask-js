import { ByteUnit, to_byte } from "./buffer";

export interface BitcaskOpts {
  /**
   * @default false
   */
  readonly read_only?: boolean;

  /**
   * @default 2_147_483_648
   */
  readonly max_merge_file_size?: number;

  /**
   * @default 1_000
   */
  readonly read_file_pool_limit?: number;
  /**
   * @default 0.5
   */
  readonly read_file_pool_cleanratio?: number;

  /**
   * @default 2_147_483_648
   */
  readonly max_write_file_size?: number;
  /**
   * @default 16_384
   */
  readonly max_write_chunk_size?: number;
  /**
   * @default INTERVAL
   */
  readonly fsync?: BitcaskFsyncType;
  /**
   * @default 10_000
   */
  readonly fsync_interval_ms?: number;
}

export enum BitcaskFsyncType {
  ON,
  OFF,
  INTERVAL,
}

export interface BitcaskCommonOpts {
  readonly read_only: boolean;
  readonly max_merge_file_size: number;
}

export function get_common_opts(opts?: BitcaskOpts): BitcaskCommonOpts {
  const read_only = !!opts?.read_only;
  const max_merge_file_size = _valid_value(
    opts?.max_merge_file_size,
    to_byte(2, ByteUnit.GB),
    to_byte(1, ByteUnit.GB),
    to_byte(3, ByteUnit.GB),
  );
  return { read_only, max_merge_file_size };
}

export interface BitcaskFilePoolOpts {
  readonly read_file_pool_limit: number;
  readonly read_file_pool_cleanratio: number;
  readonly max_write_file_size: number;
  readonly max_write_chunk_size: number;

  // ms = 0: sync every write
  // ms < 0: do not sync
  // ms > 0: sync after it expires
  readonly fsync_interval_ms: number;
}

export function get_file_pool_opts(opts?: BitcaskOpts): BitcaskFilePoolOpts {
  const read_file_pool_limit = _valid_value(
    opts?.read_file_pool_limit,
    1000,
    16,
    1024,
  );

  const read_file_pool_cleanratio = _valid_value(
    opts?.read_file_pool_cleanratio,
    0.5,
    0,
    1,
  );

  const max_write_file_size = _valid_value(
    opts?.max_write_file_size,
    to_byte(2, ByteUnit.GB),
    to_byte(512, ByteUnit.MB),
    to_byte(2, ByteUnit.GB),
  );

  const max_write_chunk_size = _valid_value(
    opts?.max_write_chunk_size,
    to_byte(4, ByteUnit.KB),
    to_byte(16, ByteUnit.KB),
    to_byte(64, ByteUnit.KB),
  );

  let fsync_interval_ms: number = 0;
  switch (opts?.fsync) {
    case BitcaskFsyncType.ON:
      fsync_interval_ms = 0;
      break;
    case BitcaskFsyncType.OFF:
      fsync_interval_ms = -1;
      break;
    default:
      fsync_interval_ms = _valid_value(
        opts?.fsync_interval_ms,
        10_000,
        1_000,
        30_000,
      );
      break;
  }

  return {
    read_file_pool_limit,
    read_file_pool_cleanratio,
    max_write_file_size,
    max_write_chunk_size,
    fsync_interval_ms,
  };
}

function _valid_value(
  value: number | null | undefined,
  defaultValue: number,
  min: number,
  max: number,
): number {
  return Math.min(Math.max(value ?? defaultValue, min), max);
}
