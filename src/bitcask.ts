import { EventEmitter } from "node:events";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { TOMBSTONE } from "./def";
import { BitcaskKeyDir, dir_read, dir_write } from "./dir";
import type { ConsumReadableStream } from "./file";
import { BitcaskFilePool } from "./file-pool";
import { load_hint_file } from "./hint";
import { UnsafeLockFile } from "./lockfile";
import { BitcaskManifest, type BitcaskFile } from "./manifest";
import { clear, merge } from "./merge";
import {
  get_common_opts,
  get_file_pool_opts,
  type BitcaskCommonOpts,
  type BitcaskFilePoolOpts,
  type BitcaskOpts,
} from "./opts";
import { Queue } from "./queue";
import {
  load_older_data_file,
  record_delete,
  record_read,
  record_write,
} from "./record";

enum Status {
  NORMAL,
  DESTROY,
}

const TICK: unique symbol = Symbol();

interface BitcaskEvent {
  [TICK]: [];
  close: [];
  error: [unknown];
}

export class Bitcask extends EventEmitter<BitcaskEvent> {
  private _lock = false;
  private _closed = false;

  private _status: Status = Status.NORMAL;

  private readonly _lock_file: UnsafeLockFile;
  private readonly _controller = new AbortController();
  private readonly _common_opts: BitcaskCommonOpts;
  private readonly _file_pool_opts: BitcaskFilePoolOpts;

  private _manifest: BitcaskManifest | null | undefined;
  private _file_pool: BitcaskFilePool | null | undefined;
  private _key_dir: BitcaskKeyDir | null | undefined;

  private _active = 0;
  private _merging = false;

  private readonly _queue = new Queue<BitcaskRequest>();
  private _replace_manifest_request: BitcaskReplaceRequest | null | undefined;

  constructor(
    private readonly _db_path: string,
    opts?: BitcaskOpts,
  ) {
    super();
    this._lock_file = new UnsafeLockFile(join(this._db_path, ".LOCK"));
    this._common_opts = get_common_opts(opts);
    this._file_pool_opts = get_file_pool_opts(opts);
    this.on(TICK, () => {
      setImmediate(() => {
        if (this._lock) {
          return;
        }

        const manifest = this._manifest;
        const file_pool = this._file_pool;
        const key_dir = this._key_dir;

        switch (this._status) {
          case Status.NORMAL:
            this._closed = false;
            if (manifest && file_pool && key_dir) {
              this._consum(manifest, file_pool, key_dir);
            } else {
              this._open();
            }
            break;
          case Status.DESTROY:
            this._reject(new Error(message));
            file_pool?.dispose();

            if (this._active === 0 && !this._merging) {
              if (manifest && file_pool && key_dir) {
                if (file_pool.is_idle()) {
                  this._close();
                }
              } else {
                if (!this._closed) {
                  this.emit("close");
                  this._closed = true;
                }
              }
            }
            break;
        }
      });
    });
    this._open();
  }

  get(key: string): Promise<Buffer | undefined> {
    if (this._status === Status.DESTROY) {
      return Promise.reject(new Error(message));
    }

    return new Promise<Buffer | undefined>((resolve, reject) => {
      this._queue.push({ type: BitcaskRequestType.GET, key, resolve, reject });
      this.emit(TICK);
    });
  }

  put(key: string, value: Buffer): Promise<void> {
    if (this._status === Status.DESTROY) {
      return Promise.reject(new Error(message));
    }

    return new Promise<void>((resolve, reject) => {
      this._queue.push({
        type: BitcaskRequestType.PUT,
        key,
        value,
        resolve,
        reject,
      });
      this.emit(TICK);
    });
  }

  delete(key: string): Promise<void> {
    if (this._status === Status.DESTROY) {
      return Promise.reject(new Error(message));
    }

    return new Promise<void>((resolve, reject) => {
      this._queue.push({ type: BitcaskRequestType.DEL, key, resolve, reject });
      this.emit(TICK);
    });
  }

  async *keys(): AsyncGenerator<string> {
    if (this._status === Status.DESTROY) {
      throw new Error(message);
    }

    const { key_dir } = await new Promise<_IteratorCtx>((resolve, reject) => {
      this._queue.push({ type: BitcaskRequestType.ITER, resolve, reject });
      this.emit(TICK);
    });

    this._active++;
    try {
      for (const key of key_dir.keys()) {
        // @ts-ignore
        if (this._status === Status.DESTROY) {
          throw new Error(message);
        }

        yield key;
      }
    } finally {
      this._active--;
      this.emit(TICK);
    }
  }

  async *values(): AsyncGenerator<Buffer> {
    if (this._status === Status.DESTROY) {
      throw new Error(message);
    }

    const { file_pool, key_dir } = await new Promise<_IteratorCtx>(
      (resolve, reject) => {
        this._queue.push({ type: BitcaskRequestType.ITER, resolve, reject });
        this.emit(TICK);
      },
    );

    this._active++;
    try {
      for (const dir of key_dir.values()) {
        // @ts-ignore
        if (this._status === Status.DESTROY) {
          throw new Error(message);
        }

        const { file_id, record_pos, record_sz } = dir_read(dir);
        const record = await file_pool.read(file_id, record_pos, record_sz);
        const value = record_read(record)?.value;
        if (value) {
          yield value;
        }
      }
    } finally {
      this._active--;
      this.emit(TICK);
    }
  }

  async *entries(): AsyncGenerator<[string, Buffer]> {
    if (this._status === Status.DESTROY) {
      throw new Error(message);
    }

    const { file_pool, key_dir } = await new Promise<_IteratorCtx>(
      (resolve, reject) => {
        this._queue.push({ type: BitcaskRequestType.ITER, resolve, reject });
        this.emit(TICK);
      },
    );

    this._active++;
    try {
      for (const [key, dir] of key_dir.entries()) {
        // @ts-ignore
        if (this._status === Status.DESTROY) {
          throw new Error(message);
        }

        const { file_id, record_pos, record_sz } = dir_read(dir);
        const record = await file_pool.read(file_id, record_pos, record_sz);
        const value = record_read(record)?.value;
        if (value) {
          yield [key, value];
        }
      }
    } finally {
      this._active--;
      this.emit(TICK);
    }
  }

  merge(): Promise<void> {
    if (this._status === Status.DESTROY) {
      return Promise.reject(new Error(message));
    }

    return new Promise<void>((resolve, reject) => {
      this._queue.push({ type: BitcaskRequestType.MERGE, resolve, reject });
      this.emit(TICK);
    });
  }

  dispose(): void {
    this._status = Status.DESTROY;
    this._controller.abort(new Error(message));
    this.emit(TICK);
  }

  private async _open(): Promise<void> {
    this._lock = true;
    try {
      await mkdir(this._db_path, { recursive: true });
      await this._lock_file.lock(this._controller.signal);

      const manifest = await BitcaskManifest.open(
        this._db_path,
        this._controller.signal,
      );
      const file_pool = this._create_file_pool(manifest);
      const key_dir = await _create_key_dir(
        manifest,
        file_pool,
        this._controller.signal,
      );

      this._manifest = manifest;
      this._file_pool?.removeAllListeners();
      this._file_pool = file_pool;
      this._key_dir = key_dir;

      this._lock = false;
      this.emit(TICK);
    } catch (err) {
      await this._lock_file.unlock();

      this._lock = false;
      this.emit("error", new Error("failed to open database.", { cause: err }));
      this._reject(err);

      // do not trigger "tick" to avoid infinite loop
    }
  }

  private async _close(): Promise<void> {
    this._lock = true;

    this._key_dir = null;
    this._file_pool = null;
    this._manifest = null;

    await this._lock_file.unlock();

    this._lock = false;
    this.emit(TICK);
  }

  private _consum(
    manifest: BitcaskManifest,
    file_pool: BitcaskFilePool,
    key_dir: BitcaskKeyDir,
  ): void {
    let request: BitcaskRequest | null | undefined;
    while (!this._replace_manifest_request && (request = this._queue.shift())) {
      this._consum_normal_request(manifest, file_pool, key_dir, request);
    }

    if (this._replace_manifest_request && this._active === 0) {
      if (file_pool.is_idle()) {
        this._consum_replace_manifest_request(
          manifest,
          this._replace_manifest_request,
        );
      } else {
        file_pool.close();
      }
    }
  }

  private _reject(reason: unknown) {
    let request: BitcaskRequest | null | undefined;
    while ((request = this._queue.shift())) {
      request.reject(reason);
    }

    this._replace_manifest_request?.reject(reason);
    this._replace_manifest_request = null;
  }

  private async _consum_normal_request(
    manifest: BitcaskManifest,
    file_pool: BitcaskFilePool,
    key_dir: BitcaskKeyDir,
    request: BitcaskRequest,
  ): Promise<void> {
    if (
      this._common_opts.read_only &&
      (request.type === BitcaskRequestType.PUT ||
        request.type === BitcaskRequestType.DEL ||
        request.type === BitcaskRequestType.MERGE)
    ) {
      request.reject(new Error("the database in read-only mode."));
      this.emit(TICK);
      return;
    }

    switch (request.type) {
      case BitcaskRequestType.GET: {
        this._active++;
        try {
          const dir = key_dir.get(request.key);
          let value: Buffer | undefined;
          if (dir) {
            const { file_id, record_pos, record_sz } = dir_read(dir);
            const record = await file_pool.read(file_id, record_pos, record_sz);
            value = record_read(record)?.value;
          }
          request.resolve(value);
        } catch (err) {
          request.reject(err);
        } finally {
          this._active--;
          this.emit(TICK);
        }

        return;
      }

      case BitcaskRequestType.PUT: {
        this._active++;
        try {
          const epoch = _epoch();
          const record = record_write(request.key, request.value, epoch);
          const { file_id, pos } = await file_pool.write(record);
          const dir = dir_write(file_id, record.byteLength, pos, epoch);
          key_dir.set(request.key, dir);
          request.resolve();
        } catch (err) {
          request.reject(err);
        } finally {
          this._active--;
          this.emit(TICK);
        }

        return;
      }

      case BitcaskRequestType.DEL: {
        this._active++;
        try {
          if (key_dir.has(request.key)) {
            const epoch = _epoch();
            const record = record_delete(request.key, epoch);
            await file_pool.write(record);
            key_dir.delete(request.key);
          }
          request.resolve();
        } catch (err) {
          request.reject(err);
        } finally {
          this._active--;
          this.emit(TICK);
        }

        return;
      }

      case BitcaskRequestType.ITER: {
        request.resolve({ file_pool, key_dir });

        return;
      }

      case BitcaskRequestType.MERGE: {
        if (this._merging) {
          request.reject(new Error("merging in progress."));
          return;
        }

        this._merging = true;
        try {
          await this._merge(manifest, file_pool);
          request.resolve();
        } catch (err) {
          request.reject(err);
        } finally {
          this._merging = false;
          this._replace_manifest_request = null;
          this.emit(TICK);
        }

        return;
      }
    }
  }

  private async _consum_replace_manifest_request(
    manifest: BitcaskManifest,
    request: BitcaskReplaceRequest,
  ): Promise<void> {
    this._lock = true;
    try {
      const new_manifest = await manifest.merge(
        request.old_files.map((v) => v.file_name),
        request.new_files,
        this._controller.signal,
      );
      const new_file_pool = this._create_file_pool(new_manifest);
      const new_key_dir = await _create_key_dir(
        new_manifest,
        new_file_pool,
        this._controller.signal,
      );

      this._manifest = new_manifest;
      this._file_pool?.removeAllListeners();
      this._file_pool = new_file_pool;
      this._key_dir = new_key_dir;

      try {
        await clear(this._db_path, new_manifest);
      } catch (_) {
        // ignore
      }

      request.resolve();
    } catch (err) {
      request.reject(err);
    } finally {
      this._lock = false;
    }
  }

  private _create_file_pool(manifest: BitcaskManifest): BitcaskFilePool {
    return new BitcaskFilePool(this._db_path, manifest, this._file_pool_opts)
      .on("error", (err) => {
        this.emit("error", err);
      })
      .on("fsync_failed", (err) => {
        this.emit("error", err);
        this.dispose();
      })
      .on("close", () => {
        this.emit(TICK);
      })
      .on("rotate", (resolve, reject) => {
        if (!this._manifest) {
          reject(new Error(message));
        } else {
          this._manifest
            .rotate(this._controller.signal)
            .then((result) => {
              this._manifest = result.next;
              resolve(result);
            })
            .catch(reject);
        }
      });
  }

  private async _merge(
    manifest: BitcaskManifest,
    file_pool: BitcaskFilePool,
  ): Promise<void> {
    const lk = new UnsafeLockFile(join(this._db_path, "merge.LOCK"));
    await lk.lock(this._controller.signal);
    try {
      const old_files = [...manifest.files.values()].filter((v) => v.readonly);
      if (old_files.every((v) => v.hint_name)) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        merge(
          this._db_path,
          file_pool,
          old_files,
          this._common_opts.max_merge_file_size,
          this._controller.signal,
        )
          .then((new_files) => {
            this._replace_manifest_request = {
              old_files,
              new_files,
              resolve,
              reject,
            };
            this.emit(TICK);
          })
          .catch(reject);
      });
    } finally {
      await lk.unlock();
    }
  }
}

const message = "the database has been closed.";

async function _create_key_dir(
  manifest: BitcaskManifest,
  file_pool: BitcaskFilePool,
  signal?: AbortSignal,
): Promise<BitcaskKeyDir> {
  const key_dir = new BitcaskKeyDir();

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
          if (!old || epoch >= dir_read(old).epoch) {
            if (value_sz === TOMBSTONE) {
              key_dir.delete(key);
            } else {
              key_dir.set(
                key,
                dir_write(file_id, record_sz, record_pos, epoch),
              );
            }
          }
        }
      },
      { signal },
    );
  };

  for (const file of manifest.files.values()) {
    await file_pool.read_stream(file.file_id, !!file.hint_name, consum);
  }

  return key_dir;
}

function _epoch(): bigint {
  return BigInt(Date.now());
}

enum BitcaskRequestType {
  GET,
  PUT,
  DEL,
  ITER,
  MERGE,
}

type BitcaskRequest =
  | BitcaskGetRequest
  | BitcaskPutRequest
  | BitcaskDelRequest
  | BitcaskIterateRequest
  | BitcaskMergeRequest;

interface BitcaskGetRequest {
  type: BitcaskRequestType.GET;
  key: string;
  resolve: (result: Buffer | undefined) => void;
  reject: (reason: unknown) => void;
}

interface BitcaskPutRequest {
  type: BitcaskRequestType.PUT;
  key: string;
  value: Buffer;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

interface BitcaskDelRequest {
  type: BitcaskRequestType.DEL;
  key: string;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

interface BitcaskIterateRequest {
  type: BitcaskRequestType.ITER;
  resolve: (ctx: _IteratorCtx) => void;
  reject: (reason: unknown) => void;
}

interface BitcaskMergeRequest {
  type: BitcaskRequestType.MERGE;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

interface BitcaskReplaceRequest {
  readonly old_files: ReadonlyArray<BitcaskFile>;
  readonly new_files: ReadonlyArray<string>;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

interface _IteratorCtx {
  readonly key_dir: BitcaskKeyDir;
  readonly file_pool: BitcaskFilePool;
}
