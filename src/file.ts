import { EventEmitter } from "node:events";
import {
  close,
  constants,
  fsync,
  open,
  read,
  writev,
  type OpenMode,
} from "node:fs";
import type { Readable } from "node:stream";
import { Queue } from "./queue";
import { NoCloseReadStream } from "./stream";

enum Status {
  NORMAL,
  CLOSE,
  DESTROY,
}

const TICK: unique symbol = Symbol();

interface BitcaskFileEvent {
  [TICK]: [];
  close: [];
  error: [unknown];
  fsync_failed: [unknown];
}

abstract class BitcaskFile extends EventEmitter<BitcaskFileEvent> {
  private _lock = false;
  private _closed = false;

  protected _status: Status = Status.NORMAL;
  private _fd: number = -1;

  constructor(
    readonly file_id: number,
    readonly file_path: string,
    private readonly _flags: OpenMode,
  ) {
    super();
    this.on(TICK, () => {
      if (this._lock) {
        return;
      }

      const status = this._status;
      const fd = this._fd;

      switch (status) {
        case Status.NORMAL:
          this._closed = false;
          if (fd < 0) {
            this._open();
          } else {
            this._consum(fd);
          }
          break;
        case Status.CLOSE:
          if (this._is_idle()) {
            if (fd < 0) {
              if (!this._closed) {
                this.emit("close");
                this._closed = true;
              }
            } else {
              this._close(fd);
            }
          } else if (!this._queue_is_empty()) {
            this._consum(fd);
          }
          break;
        case Status.DESTROY:
          this._reject(new Error(message));

          if (this._is_idle()) {
            if (fd < 0) {
              if (!this._closed) {
                this.emit("close");
                this._closed = true;
              }
            } else {
              this._close(fd);
            }
          }
          break;
      }
    });
    this._open();
  }

  protected abstract _consum(fd: number): void;
  protected abstract _reject(reason: unknown): void;
  protected abstract _queue_is_empty(): boolean;
  protected abstract _is_idle(): boolean;
  protected abstract _fsync_before_close(): boolean;

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

  private _open(): void {
    this._lock = true;

    open(this.file_path, this._flags, (err, fd) => {
      if (err) {
        this.emit("error", err);
        this._reject(err);

        this._status = Status.DESTROY;
      } else {
        this._fd = fd;
      }

      this._lock = false;
      this.emit(TICK);
    });
  }

  private _close(fd: number): void {
    this._lock = true;

    const cb = () => {
      close(fd, (err) => {
        if (err) {
          this.emit("error", err);
        }

        this._fd = -1;
        this._lock = false;

        this.emit(TICK);
      });
    };

    if (this._fsync_before_close()) {
      fsync(fd, (err) => {
        if (err) {
          this.emit("fsync_failed", err);
        }
        cb();
      });
    } else {
      cb();
    }
  }
}

export class BitcaskReader extends BitcaskFile {
  private readonly _read_queue = new Queue<ReadRequest>();
  private _read_active = 0;

  constructor(
    readonly file_id: number,
    readonly file_path: string,
    readonly hint: boolean,
  ) {
    super(file_id, file_path, constants.O_RDONLY);
  }

  protected _consum(fd: number): void {
    let request: ReadRequest | undefined;
    while ((request = this._read_queue.shift())) {
      this._read_active++;

      switch (request.type) {
        case ReadRequestType.READ:
          const { resolve, reject } = request;
          read(
            fd,
            Buffer.allocUnsafeSlow(request.size),
            0,
            request.size,
            request.pos,
            (err, bytesRead, buf) => {
              this._read_active--;

              if (err) {
                this.emit("error", err);
                reject(err);
              } else {
                if (bytesRead > 0) {
                  if (bytesRead !== buf.length) {
                    const dst = Buffer.allocUnsafeSlow(bytesRead);
                    buf.copy(dst, 0, 0, bytesRead);
                    buf = dst;
                  }
                } else {
                  buf = Buffer.allocUnsafe(0);
                }
                resolve(buf);
              }

              this.emit(TICK);
            },
          );
          break;
        case ReadRequestType.STREAM:
          request
            .consum(this.file_id, this.hint, new NoCloseReadStream(fd))
            .then(request.resolve)
            .catch(request.reject)
            .finally(() => {
              this._read_active--;
              this.emit(TICK);
            });
          break;
      }
    }
  }

  protected _reject(reason: unknown): void {
    let request: ReadRequest | undefined;
    while ((request = this._read_queue.shift())) {
      request.reject(reason);
    }
  }

  protected _queue_is_empty(): boolean {
    return this._read_queue.is_empty();
  }

  protected _is_idle(): boolean {
    return this._queue_is_empty() && this._read_active === 0;
  }

  protected _fsync_before_close(): boolean {
    return false;
  }

  read(request: ReadRequest): boolean {
    if (this._status === Status.DESTROY) {
      request.reject(new Error(message));
      return false;
    }

    this._status = Status.NORMAL;
    this._read_queue.push(request);

    this.emit(TICK);

    return true;
  }
}

export enum ReadRequestType {
  READ,
  STREAM,
}

export type ReadRequest = _ReadRequest | _StreamRequest;

interface _ReadRequest {
  type: ReadRequestType.READ;
  readonly file_id: number;
  readonly pos: number;
  readonly size: number;
  resolve: (result: ReadResponse) => void;
  reject: (reason: unknown) => void;
}

interface _StreamRequest {
  type: ReadRequestType.STREAM;
  readonly file_id: number;
  readonly hint: boolean;
  consum: ConsumReadableStream<any>;
  resolve: (result: any) => void;
  reject: (reason: unknown) => void;
}

export type ReadResponse = Buffer;
export type ConsumReadableStream<T = void> = (
  file_id: number,
  hint: boolean,
  stream: Readable,
) => Promise<T>;

export class BitcaskWriter extends BitcaskFile {
  private readonly _write_queue = new Queue<WriteRequest>();
  private _write_active = false;

  private _write_queue_buf_length = 0;
  private _write_pos = 0;
  private _write_dirty = false;
  private _write_sync = false;
  private _write_sync_timer: NodeJS.Timeout | null = null;

  constructor(
    readonly file_id: number,
    readonly file_path: string,
    private readonly _max_write_chunk_size: number,
    private readonly _fsync_interval_ms: number,
  ) {
    super(
      file_id,
      file_path,
      constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY,
    );

    if (this._fsync_interval_ms > 0) {
      this.on("close", () => {
        if (this._write_sync_timer !== null) {
          clearTimeout(this._write_sync_timer);
          this._write_sync_timer = null;
        }
      });
    }
  }

  get size(): number {
    return this._write_pos + this._write_queue_buf_length;
  }

  protected _consum(fd: number): void {
    if (this._write_active) {
      return;
    }

    if (this._fsync_interval_ms > 0) {
      // > 0: sync after it expires
      if (this._write_dirty && !this._write_sync && !this._write_sync_timer) {
        this._write_sync_timer = setTimeout(() => {
          this._write_sync_timer = null;
          this._write_sync = true;

          this.emit(TICK);
        }, this._fsync_interval_ms);
      }
    } else {
      // = 0: sync every write
      // < 0: do not sync
      this._write_sync = this._fsync_interval_ms === 0;
    }

    if (this._write_queue.is_empty()) {
      if (this._write_sync && this._write_dirty) {
        this._write_active = true;
        fsync(fd, (err) => {
          this._write_active = this._write_sync = this._write_dirty = false;
          if (err) {
            this.emit("fsync_failed", err);
          } else {
            this.emit(TICK);
          }
        });
      }

      return;
    }

    let size = 0;
    const requests: WriteRequest[] = [];

    let request: WriteRequest | null | undefined;
    while ((request = this._write_queue.peek())) {
      const length = request.buffer.byteLength;
      if (size + length > this._max_write_chunk_size && size > 0) {
        break;
      }

      this._write_queue.shift();

      size += length;
      requests.push(request);
    }
    request = null;

    if (requests.length === 0) {
      // unreachable
      return;
    }

    const position = this._write_pos;
    this._write_active = true;

    const bufs = requests.map((v) => v.buffer);
    const cb = (err: NodeJS.ErrnoException | null) => {
      this._write_active = false;
      this._write_queue_buf_length -= size;

      if (err) {
        this.emit("error", err);
        for (const request of requests) {
          request.reject(err);
        }
      } else {
        this._write_pos += size;
        let _pos = position;
        for (const request of requests) {
          request.resolve({ file_id: this.file_id, pos: _pos });
          _pos += request.buffer.byteLength;
        }
      }

      this.emit(TICK);
    };
    writev(fd, bufs, position, (err) => {
      if (err) {
        cb(err);
      } else {
        this._write_dirty = true;
        if (this._write_sync) {
          fsync(fd, (err) => {
            this._write_sync = this._write_dirty = false;
            if (err) {
              this.emit("fsync_failed", err);
            }
            cb(err);
          });
        } else {
          cb(null);
        }
      }
    });
  }

  protected _reject(reason: unknown): void {
    let request: WriteRequest | undefined;
    while ((request = this._write_queue.shift())) {
      request.reject(reason);
    }
    this._write_queue_buf_length = 0;
  }

  protected _queue_is_empty(): boolean {
    return this._write_queue.is_empty();
  }

  protected _is_idle(): boolean {
    return this._queue_is_empty() && !this._write_active;
  }

  protected _fsync_before_close(): boolean {
    return this._write_dirty;
  }

  write(request: WriteRequest): boolean {
    if (this._status === Status.DESTROY) {
      request.reject(new Error(message));
      return false;
    }

    this._status = Status.NORMAL;
    this._write_queue.push(request);
    this._write_queue_buf_length += request.buffer.byteLength;

    // lazy write
    setImmediate(() => {
      this.emit(TICK);
    });

    return true;
  }
}

export interface WriteRequest {
  readonly buffer: Buffer;
  resolve: (result: WriteResponse) => void;
  reject: (reason: unknown) => void;
}

export interface WriteResponse {
  readonly file_id: number;
  readonly pos: number;
}

const message = "the file has been closed.";
