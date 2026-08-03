import { EventEmitter } from "node:events";
import { join } from "node:path";
import {
  BitcaskReader,
  BitcaskWriter,
  ReadRequestType,
  type ConsumReadableStream,
  type ReadRequest,
  type ReadResponse,
  type WriteRequest,
  type WriteResponse,
} from "./file";
import { LinkedMap } from "./linked-map";
import type {
  BitcaskFile,
  BitcaskManifest,
  BitcaskManifestRotate,
} from "./manifest";
import type { BitcaskFilePoolOpts } from "./opts";
import { Queue } from "./queue";

enum Status {
  NORMAL,
  CLOSE,
  DESTROY,
}

const TICK: unique symbol = Symbol();

interface BitcaskFilePoolEvent {
  [TICK]: [];
  rotate: [(value: BitcaskManifestRotate) => void, (reason: unknown) => void];
  close: [];
  error: [unknown];
  fsync_failed: [unknown];
}

export class BitcaskFilePool extends EventEmitter<BitcaskFilePoolEvent> {
  private _closed = false;
  private _status: Status = Status.NORMAL;

  private readonly _read_queue = new Queue<ReadRequest>();
  private _read_block = false;
  private readonly _readers = new LinkedMap<number | symbol, BitcaskReader>();

  private readonly _write_queue = new Queue<WriteRequest>();
  private _write_block = false;
  private readonly _writers = new Map<number, BitcaskWriter>();
  private _writer: BitcaskWriter | null = null;

  constructor(
    private readonly _db_path: string,
    private _manifest: BitcaskManifest,
    private readonly _opts: BitcaskFilePoolOpts,
  ) {
    super();
    this.on(TICK, () => {
      setImmediate(() => {
        switch (this._status) {
          case Status.NORMAL:
            this._closed = false;
            this._custom();
            break;
          case Status.CLOSE:
            if (this.is_idle()) {
              if (!this._closed) {
                this.emit("close");
                this._closed = true;
              }
            } else if (this._queue_is_empty()) {
              for (const f of this._readers.values()) {
                f.close();
              }
              for (const f of this._writers.values()) {
                f.close();
              }
            } else {
              this._custom();
            }
            break;
          case Status.DESTROY:
            this._reject(new Error(message));

            if (this.is_idle()) {
              if (!this._closed) {
                this.emit("close");
                this._closed = true;
              }
            } else {
              for (const f of this._readers.values()) {
                f.dispose();
              }
              for (const f of this._writers.values()) {
                f.dispose();
              }
            }
            break;
        }
      });
    });
  }

  read(file_id: number, pos: number, size: number): Promise<ReadResponse> {
    if (this._status === Status.DESTROY) {
      return Promise.reject(new Error(message));
    }

    this._status = Status.NORMAL;
    return new Promise<ReadResponse>((resolve, reject) => {
      this._read_queue.push({
        type: ReadRequestType.READ,
        file_id,
        pos,
        size,
        resolve,
        reject,
      });
      this.emit(TICK);
    });
  }

  read_stream<T>(
    file_id: number,
    hint: boolean,
    consum: ConsumReadableStream<T>,
  ): Promise<T> {
    if (this._status === Status.DESTROY) {
      return Promise.reject(new Error(message));
    }

    this._status = Status.NORMAL;
    return new Promise<T>((resolve, reject) => {
      this._read_queue.push({
        type: ReadRequestType.STREAM,
        file_id,
        hint,
        consum,
        resolve,
        reject,
      });
      this.emit(TICK);
    });
  }

  write(buffer: Buffer): Promise<WriteResponse> {
    if (this._status === Status.DESTROY) {
      return Promise.reject(new Error(message));
    }

    this._status = Status.NORMAL;
    return new Promise<WriteResponse>((resolve, reject) => {
      this._write_queue.push({ buffer, resolve, reject });
      this.emit(TICK);
    });
  }

  is_idle(): boolean {
    return (
      this._queue_is_empty() &&
      !this._read_block &&
      !this._write_block &&
      this._readers.size === 0 &&
      this._writers.size === 0
    );
  }

  close(): void {
    if (this._status === Status.DESTROY) {
      return;
    }

    this._status = Status.CLOSE;
    this.emit(TICK);
  }

  dispose(): void {
    this._status = Status.DESTROY;
    this.emit(TICK);
  }

  private _custom(): void {
    this._custom_write_queue();
    this._custom_read_queue();
  }

  private _custom_read_queue(): void {
    let request: ReadRequest | null | undefined;
    while (!this._read_block && (request = this._read_queue.peek())) {
      const file = this._manifest.files.get(request.file_id);
      if (!file) {
        request.reject(new Error(`file ${request.file_id} not found.`));
        this._read_queue.shift();
        continue;
      }

      if (
        request.type === ReadRequestType.STREAM &&
        request.hint &&
        file.hint_name
      ) {
        if (this._readers.size >= this._opts.read_file_pool_limit) {
          this._read_block = true;
          this._release_readers();
          break;
        }

        const reader = this._create_reader(file, true);

        this._read_queue.shift();
        reader.read(request);
        reader.close();
      } else {
        let reader = this._readers.get_and_move_to_tail(request.file_id);
        if (!reader) {
          if (this._readers.size >= this._opts.read_file_pool_limit) {
            this._read_block = true;
            this._release_readers();
            break;
          }

          reader = this._create_reader(file, false);
        }

        this._read_queue.shift();
        reader.read(request);
      }
    }
  }

  private _custom_write_queue(): void {
    let request: WriteRequest | null | undefined;
    while (!this._write_block && (request = this._write_queue.peek())) {
      if (this._writer) {
        if (
          this._writer.size > 0 &&
          this._writer.size + request.buffer.byteLength >
            this._opts.max_write_file_size
        ) {
          this._writer.close();
          this._writer = null;
        } else {
          this._write_queue.shift();
          this._writer.write(request);
          continue;
        }
      }

      this._write_block = true;
      new Promise<BitcaskManifestRotate>((resolve, reject) => {
        this.emit("rotate", resolve, reject);
      })
        .then(({ next, file }) => {
          this._manifest = next;
          this._writer = this._create_writer(file);
        })
        .catch((err) => {
          this.emit("error", err);
          this._reject_write_queue(err);
        })
        .finally(() => {
          this._write_block = false;
          this.emit(TICK);
        });
    }
  }

  private _release_readers(): void {
    const size = this._readers.size * this._opts.read_file_pool_cleanratio;

    let index = 0;
    for (const reader of this._readers.values()) {
      reader.close();

      index++;
      if (index >= size) {
        return;
      }
    }
  }

  private _create_reader(file: BitcaskFile, hint: boolean): BitcaskReader {
    const key = hint ? Symbol() : file.file_id;

    const reader = new BitcaskReader(
      file.file_id,
      join(this._db_path, hint ? file.hint_name! : file.data_name),
      hint,
    )
      .on("error", (err) => {
        this.emit("error", err);
      })
      .on("close", () => {
        if (this._readers.get(key) !== reader) {
          return;
        }

        this._readers.delete(key);

        if (this._readers.size < this._opts.read_file_pool_limit) {
          this._read_block = false;
        }

        this.emit(TICK);
      });
    this._readers.set(key, reader);
    return reader;
  }

  private _create_writer(file: BitcaskFile): BitcaskWriter {
    const writer = new BitcaskWriter(
      file.file_id,
      join(this._db_path, file.data_name),
      this._opts.max_write_chunk_size,
      this._opts.fsync_interval_ms,
    )
      .on("error", (err) => {
        this.emit("error", err);
      })
      .on("close", () => {
        if (this._writer === writer) {
          this._writer = null;
        }

        if (this._writers.get(writer.file_id) !== writer) {
          return;
        }

        this._writers.delete(writer.file_id);

        this.emit(TICK);
      })
      .on("fsync_failed", (err) => {
        this.emit("fsync_failed", err);
      });
    this._writers.set(writer.file_id, writer);
    return writer;
  }

  private _reject(reason: unknown): void {
    this._reject_read_queue(reason);
    this._reject_write_queue(reason);
  }

  private _reject_read_queue(reason: unknown): void {
    let request: ReadRequest | null | undefined;

    while ((request = this._read_queue.shift())) {
      request.reject(reason);
    }
  }

  private _reject_write_queue(reason: unknown): void {
    let request: WriteRequest | null | undefined;

    while ((request = this._write_queue.shift())) {
      request.reject(reason);
    }
  }

  private _queue_is_empty(): boolean {
    return this._read_queue.is_empty() && this._write_queue.is_empty();
  }
}

const message = "the file pool has been closed.";
