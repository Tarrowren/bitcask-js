import { createWriteStream } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { data_ext, hint_ext, manifest_ext, TOMBSTONE } from "./def";
import type { ConsumReadableStream } from "./file";
import type { BitcaskFilePool } from "./file-pool";
import { hint_write, load_hint_file } from "./hint";
import { LinkedMap } from "./linked-map";
import type { BitcaskFile, BitcaskManifest } from "./manifest";
import { get_random_file_name } from "./random-name";
import { load_older_data_file } from "./record";

export async function merge(
  db_path: string,
  file_pool: BitcaskFilePool,
  old_files: ReadonlyArray<BitcaskFile>,
  max_merge_file_size: number,
  signal?: AbortSignal,
): Promise<ReadonlyArray<string>> {
  const dirs_list = await _split_dirs(
    db_path,
    file_pool,
    old_files,
    max_merge_file_size,
    signal,
  );

  const options = { flush: true };
  for (const { file_name, dirs } of dirs_list) {
    const data_file = createWriteStream(
      join(db_path, file_name + data_ext),
      options,
    );
    await pipeline(new _DataStream(file_pool, dirs), data_file, {
      signal,
    });

    const hint_file = createWriteStream(
      join(db_path, file_name + hint_ext),
      options,
    );
    await pipeline(new _HintStream(dirs), hint_file, { signal });
  }

  return dirs_list.map((v) => v.file_name);
}

export async function clear(
  db_path: string,
  manifest: BitcaskManifest,
): Promise<void> {
  const files = await readdir(db_path);
  const bitcask_files = [...manifest.files.values()];
  const current_version = manifest.version + manifest_ext;

  const reg = /\.(manifest\.json|data|hint)$/;

  const dels: string[] = [];
  for (const file of files) {
    if (reg.test(file)) {
      if (
        current_version === file ||
        bitcask_files.some((v) => v.data_name === file || v.hint_name === file)
      ) {
        continue;
      }

      dels.push(file);
    }
  }

  for (const del of dels) {
    await unlink(resolve(db_path, del));
  }
}

export async function _split_dirs(
  db_path: string,
  file_pool: BitcaskFilePool,
  old_files: ReadonlyArray<BitcaskFile>,
  max_merge_file_size: number,
  signal?: AbortSignal,
): Promise<ReadonlyArray<{ file_name: string; dirs: ReadonlyArray<_Dir> }>> {
  const key_dir = new LinkedMap<string, _Dir>();

  const consum: ConsumReadableStream = async (file_id, hint, stream) => {
    await pipeline(
      stream,
      hint ? load_hint_file : load_older_data_file,
      async (source) => {
        for await (const {
          key,
          record_sz,
          record_pos,
          value_sz,
          epoch,
        } of source) {
          const old = key_dir.get(key);
          if (!old || epoch >= old.epoch) {
            if (value_sz === TOMBSTONE) {
              key_dir.delete(key);
            } else {
              key_dir.set(key, { key, file_id, record_sz, record_pos, epoch });
            }
          }
        }
      },
      { signal },
    );
  };

  for (const file of old_files) {
    await file_pool.read_stream(file.file_id, !!file.hint_name, consum);
  }

  if (key_dir.size === 0) {
    return [];
  }

  let size = 0;
  let dirs: _Dir[] = [];
  let file_name: string;
  const list: { file_name: string; dirs: ReadonlyArray<_Dir> }[] = [];
  for (const dir of key_dir.values()) {
    if (size > max_merge_file_size) {
      file_name = await get_random_file_name(db_path, true, signal);
      list.push({ file_name, dirs });

      size = 0;
      dirs = [];
    }

    size += dir.record_sz;
    dirs.push(dir);
  }

  file_name = await get_random_file_name(db_path, true, signal);
  list.push({ file_name, dirs });
  return list;
}

class _DataStream extends Readable {
  private _index = 0;

  constructor(
    private readonly _file_pool: BitcaskFilePool,
    private readonly _dirs: ReadonlyArray<_Dir>,
  ) {
    super();
  }

  async _read(_size: number): Promise<void> {
    if (this._index < this._dirs.length) {
      const dir = this._dirs[this._index];
      this._index++;

      const record: Buffer = await this._file_pool.read(
        dir.file_id,
        dir.record_pos,
        dir.record_sz,
      );
      this.push(record);
    } else {
      this.push(null);
    }
  }
}

class _HintStream extends Readable {
  private _index = 0;
  private _record_pos = 0;

  constructor(private readonly _dirs: ReadonlyArray<_Dir>) {
    super();
  }

  _read(_size: number): void {
    if (this._index < this._dirs.length) {
      const dir = this._dirs[this._index];
      this._index++;

      const hint = hint_write(
        dir.key,
        dir.record_sz,
        this._record_pos,
        dir.epoch,
      );
      this._record_pos += dir.record_sz;
      this.push(hint);
    } else {
      this.push(null);
    }
  }
}

interface _Dir {
  readonly key: string;
  readonly file_id: number;
  readonly record_sz: number;
  readonly record_pos: number;
  readonly epoch: bigint;
}
