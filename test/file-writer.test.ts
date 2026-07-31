import { fs, vol } from "memfs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BitcaskWriter } from "../src/file";
import { delay, error } from "./util";

vi.mock("node:fs", () => fs);
vi.mock("node:fs/promises", () => fs.promises);
const _open = vi.spyOn(fs, "open");
const _writev = vi.spyOn(fs, "writev");
const _fsync = vi.spyOn(fs, "fsync");
const _close = vi.spyOn(fs, "close");

const max_write_chunk_size = 16_384;
const fsync_interval_ms = 5_000;

beforeEach(() => {
  vi.useFakeTimers();
  vol.reset();
});
afterEach(() => {
  vi.resetAllMocks();
  vol.reset();
  vol._core.maxFiles = 10000;
});

it("emfile", async () => {
  const file_id = 1;
  _open.mockImplementation(delay(vol.open));
  _close.mockImplementation(delay(vol.close));

  const _close_cb = vi.fn();
  const _error_cb = vi.fn();

  vol._core.maxFiles = 0;

  const writer = new BitcaskWriter(
    file_id,
    "/test.db",
    max_write_chunk_size,
    fsync_interval_ms,
  );
  writer.on("close", _close_cb);
  writer.on("error", _error_cb);

  // open
  expect(_open).toHaveBeenCalledOnce();

  await vi.advanceTimersToNextTimerAsync();

  // open failed, close
  expect(_error_cb).toHaveBeenCalledWith(
    expect.objectContaining({ code: "EMFILE" }),
  );
  expect(_close_cb).toHaveBeenCalledOnce();
  expect(_close).not.toHaveBeenCalled();
});

it("open - write - close", async () => {
  const file_id = 1;
  _open.mockImplementation(delay(vol.open));
  _writev.mockImplementation(delay(vol.writev));
  _fsync.mockImplementation(delay(vol.fsync));
  _close.mockImplementation(delay(vol.close));

  const _close_cb = vi.fn();
  const _resolve = vi.fn();

  vol.fromJSON({ "test.db": "" }, "/");

  const writer = new BitcaskWriter(
    file_id,
    "/test.db",
    max_write_chunk_size,
    fsync_interval_ms,
  );
  writer.on("close", _close_cb);
  writer.write({
    buffer: Buffer.from("hello"),
    reject: () => {},
    resolve: _resolve,
  });
  writer.close();

  // open
  expect(_open).toHaveBeenCalledOnce();

  // lazy write
  await vi.advanceTimersToNextTimerAsync();
  await vi.advanceTimersToNextTimerAsync();

  // writer
  expect(_writev).toHaveBeenCalledOnce();
  expect(_resolve).not.toHaveBeenCalled();

  await vi.advanceTimersToNextTimerAsync();

  // writer end
  expect(_resolve).toHaveBeenCalledOnce();

  // fsync
  expect(_fsync).toHaveBeenCalledOnce();
  expect(_close).not.toHaveBeenCalled();

  await vi.advanceTimersToNextTimerAsync();

  // close
  expect(_close).toHaveBeenCalledOnce();
  expect(_close_cb).not.toHaveBeenCalled();

  await vi.advanceTimersToNextTimerAsync();

  // closed
  expect(_close_cb).toHaveBeenCalledOnce();
});

it("open - write - dispose - write", async () => {
  const file_id = 1;
  _open.mockImplementation(delay(vol.open));
  _writev.mockImplementation(delay(vol.writev));
  _fsync.mockImplementation(delay(vol.fsync));
  _close.mockImplementation(delay(vol.close));

  const _close_cb = vi.fn();
  const _reject1 = vi.fn();
  const _reject2 = vi.fn();

  vol.fromJSON({ "test.db": "" }, "/");

  const writer = new BitcaskWriter(
    file_id,
    "/test.db",
    max_write_chunk_size,
    fsync_interval_ms,
  );
  writer.on("close", _close_cb);
  writer.write({
    buffer: Buffer.from("hello"),
    reject: _reject1,
    resolve: () => {},
  });
  writer.dispose();
  writer.write({
    buffer: Buffer.from("world"),
    reject: _reject2,
    resolve: () => {},
  });
  writer.close();

  // open
  expect(_open).toHaveBeenCalledOnce();

  // lazy write
  await vi.advanceTimersToNextTimerAsync();
  await vi.advanceTimersToNextTimerAsync();

  // abort
  expect(_reject1).toHaveBeenCalledOnce();
  expect(_reject2).toHaveBeenCalledOnce();
  expect(_reject1).toHaveBeenCalledWith(
    expect.objectContaining({ message: "the file has been closed." }),
  );
  expect(_reject2).toHaveBeenCalledWith(
    expect.objectContaining({ message: "the file has been closed." }),
  );

  // close
  expect(_close).toHaveBeenCalledOnce();
  expect(_close_cb).not.toHaveBeenCalled();

  await vi.advanceTimersToNextTimerAsync();

  // closed
  expect(_close_cb).toHaveBeenCalledOnce();

  await vi.runAllTimersAsync();

  // not write not fsync
  expect(_writev).not.toHaveBeenCalled();
  expect(_fsync).not.toHaveBeenCalled();
});

it("write", async () => {
  const file_id = 1;
  _open.mockImplementation(delay(vol.open));
  _writev.mockImplementation(delay(vol.writev));

  const _resolve1 = vi.fn();
  const _resolve2 = vi.fn();
  const _resolve3 = vi.fn();

  vol.fromJSON({ "test.db": "" }, "/");

  const writer = new BitcaskWriter(
    file_id,
    "/test.db",
    max_write_chunk_size,
    fsync_interval_ms,
  );

  // open
  expect(_open).toHaveBeenCalledOnce();

  await vi.advanceTimersToNextTimerAsync();

  // write
  writer.write({
    buffer: Buffer.allocUnsafe(16 * 1024).fill("tarrow"),
    reject: () => {},
    resolve: _resolve1,
  });
  expect(writer.size).toEqual(16 * 1024);
  // batch
  writer.write({
    buffer: Buffer.from("hello"),
    reject: () => {},
    resolve: _resolve2,
  });
  expect(writer.size).toEqual(16 * 1024 + 5);
  writer.write({
    buffer: Buffer.from("world"),
    reject: () => {},
    resolve: _resolve3,
  });
  expect(writer.size).toEqual(16 * 1024 + 10);

  // lazy write
  expect(_writev).not.toHaveBeenCalled();

  await vi.advanceTimersToNextTimerAsync();

  expect(_writev).toHaveBeenCalledTimes(1);

  await vi.advanceTimersToNextTimerAsync();

  // no.1 write end
  expect(_resolve1).toHaveBeenCalledOnce();
  expect(_resolve1).toHaveBeenCalledWith({ file_id, pos: 0 });
  // no.2/no.3 batch write start
  expect(_writev).toHaveBeenCalledTimes(2);
  expect(writer.size).toEqual(16 * 1024 + 10);

  await vi.advanceTimersToNextTimerAsync();

  // no.2/no.3 batch write end
  expect(_resolve2).toHaveBeenCalledOnce();
  expect(_resolve3).toHaveBeenCalledOnce();
  expect(_resolve2).toHaveBeenCalledWith({ file_id, pos: 16 * 1024 });
  expect(_resolve3).toHaveBeenCalledWith({ file_id, pos: 16 * 1024 + 5 });
  expect(writer.size).toEqual(16 * 1024 + 10);
});

it("failed", async () => {
  const file_id = 1;
  _open.mockImplementation(delay(vol.open));
  _writev.mockImplementation(delay(vol.writev));
  const message = "failed";

  const _error_cb = vi.fn();
  const _reject1 = vi.fn();
  const _reject2 = vi.fn();
  const _resolve1 = vi.fn();
  const _resolve2 = vi.fn();

  vol.fromJSON({ "test.db": "" }, "/");

  const writer = new BitcaskWriter(
    file_id,
    "/test.db",
    max_write_chunk_size,
    fsync_interval_ms,
  );

  // open
  expect(_open).toHaveBeenCalledOnce();
  writer.on("error", _error_cb);

  await vi.advanceTimersToNextTimerAsync();

  // write
  writer.write({
    buffer: Buffer.allocUnsafe(16 * 1024).fill("hello"),
    reject: _reject1,
    resolve: _resolve1,
  });
  expect(writer.size).toEqual(16 * 1024);
  writer.write({
    buffer: Buffer.allocUnsafe(16 * 1024).fill("world"),
    reject: _reject2,
    resolve: _resolve2,
  });
  expect(writer.size).toEqual(16 * 1024 + 16 * 1024);

  // lazy write
  expect(_writev).not.toHaveBeenCalled();
  await vi.advanceTimersToNextTimerAsync();

  // write start
  expect(_writev).toHaveBeenCalledTimes(1);
  _writev.mockImplementationOnce(error(message));

  await vi.advanceTimersToNextTimerAsync();

  // write end
  expect(_resolve1).toHaveBeenCalledOnce();
  expect(_resolve1).toHaveBeenCalledWith({ file_id, pos: 0 });
  expect(_reject1).not.toHaveBeenCalled();
  expect(writer.size).toEqual(16 * 1024 + 16 * 1024);

  // write start
  expect(_writev).toHaveBeenCalledTimes(2);

  await vi.advanceTimersToNextTimerAsync();

  // write end
  expect(_resolve2).not.toHaveBeenCalled();
  expect(_reject2).toHaveBeenCalledOnce();
  expect(_reject2).toHaveBeenCalledWith(expect.objectContaining({ message }));
  expect(writer.size).toEqual(16 * 1024);
});

it("fsync every write", async () => {
  const file_id = 1;
  const fsync_interval_ms = 0;
  _open.mockImplementation(delay(vol.open));
  _writev.mockImplementation(delay(vol.writev));
  _fsync.mockImplementation(delay(vol.fsync));

  const _resolve1 = vi.fn();
  const _resolve2 = vi.fn();
  const _resolve3 = vi.fn();

  vol.fromJSON({ "test.db": "" }, "/");

  const _close_cb = vi.fn();
  const writer = new BitcaskWriter(
    file_id,
    "/test.db",
    max_write_chunk_size,
    fsync_interval_ms,
  ).on("close", _close_cb);

  // open
  expect(_open).toHaveBeenCalledOnce();

  await vi.advanceTimersToNextTimerAsync();

  // write
  writer.write({
    buffer: Buffer.allocUnsafe(16 * 1024).fill("tarrow"),
    reject: () => {},
    resolve: _resolve1,
  });
  // batch
  writer.write({
    buffer: Buffer.from("hello"),
    reject: () => {},
    resolve: _resolve2,
  });
  writer.write({
    buffer: Buffer.from("world"),
    reject: () => {},
    resolve: _resolve3,
  });

  // lazy write
  expect(_writev).not.toHaveBeenCalled();

  await vi.advanceTimersToNextTimerAsync();

  expect(_writev).toHaveBeenCalledTimes(1);

  await vi.advanceTimersToNextTimerAsync();

  // fsync
  expect(_fsync).toHaveBeenCalledTimes(1);

  await vi.advanceTimersToNextTimerAsync();

  // fsync end
  expect(_resolve1).toHaveBeenCalledOnce();
  expect(_resolve1).toHaveBeenCalledWith({ file_id, pos: 0 });

  // batch write
  expect(_writev).toHaveBeenCalledTimes(2);

  await vi.advanceTimersToNextTimerAsync();

  // fsync
  expect(_fsync).toHaveBeenCalledTimes(2);

  await vi.advanceTimersToNextTimerAsync();

  // fsync end
  expect(_resolve2).toHaveBeenCalledOnce();
  expect(_resolve3).toHaveBeenCalledOnce();
  expect(_resolve2).toHaveBeenCalledWith({ file_id, pos: 16 * 1024 });
  expect(_resolve3).toHaveBeenCalledWith({ file_id, pos: 16 * 1024 + 5 });

  writer.dispose();

  await vi.advanceTimersToNextTimerAsync();

  expect(_close_cb).toHaveBeenCalledOnce();
});

it("fsync interval x ms", async () => {
  const file_id = 1;
  const fsync_interval_ms = 10_000;
  _open.mockImplementation(delay(vol.open));
  _writev.mockImplementation(delay(vol.writev));
  _fsync.mockImplementation(delay(vol.fsync));

  const _resolve1 = vi.fn();
  const _resolve2 = vi.fn();
  const _resolve3 = vi.fn();
  const _resolve4 = vi.fn();

  vol.fromJSON({ "test.db": "" }, "/");

  const _close_cb = vi.fn();
  const writer = new BitcaskWriter(
    file_id,
    "/test.db",
    max_write_chunk_size,
    fsync_interval_ms,
  ).on("close", _close_cb);

  // open
  expect(_open).toHaveBeenCalledOnce();

  await vi.advanceTimersToNextTimerAsync();

  // write
  writer.write({
    buffer: Buffer.allocUnsafe(16 * 1024).fill("tarrow"),
    reject: () => {},
    resolve: _resolve1,
  });
  // batch
  writer.write({
    buffer: Buffer.from("hello"),
    reject: () => {},
    resolve: _resolve2,
  });
  writer.write({
    buffer: Buffer.from("world"),
    reject: () => {},
    resolve: _resolve3,
  });

  // lazy write
  expect(_writev).not.toHaveBeenCalled();

  await vi.advanceTimersToNextTimerAsync();

  expect(_writev).toHaveBeenCalledTimes(1);

  await vi.advanceTimersToNextTimerAsync();

  expect(_resolve1).toHaveBeenCalledOnce();
  expect(_resolve1).toHaveBeenCalledWith({ file_id, pos: 0 });

  // batch write
  expect(_writev).toHaveBeenCalledTimes(2);

  await vi.advanceTimersToNextTimerAsync();

  expect(_resolve2).toHaveBeenCalledOnce();
  expect(_resolve3).toHaveBeenCalledOnce();
  expect(_resolve2).toHaveBeenCalledWith({ file_id, pos: 16 * 1024 });
  expect(_resolve3).toHaveBeenCalledWith({ file_id, pos: 16 * 1024 + 5 });

  expect(_fsync).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(fsync_interval_ms);

  expect(_fsync).toHaveBeenCalledOnce();

  writer.write({
    buffer: Buffer.from("tarrow"),
    reject: () => {},
    resolve: _resolve4,
  });

  await vi.advanceTimersToNextTimerAsync();

  expect(_writev).toHaveBeenCalledTimes(3);

  await vi.advanceTimersToNextTimerAsync();

  expect(_resolve4).toHaveBeenCalledOnce();

  writer.dispose();

  await vi.runAllTimersAsync();

  expect(_fsync).toHaveBeenCalledTimes(2);

  await vi.advanceTimersToNextTimerAsync();

  expect(_close_cb).toHaveBeenCalledOnce();
});

it("failed_to_fsync_interval_x_ms", async () => {
  const file_id = 1;
  const fsync_interval_ms = 10_000;
  _open.mockImplementation(delay(vol.open));
  _writev.mockImplementation(delay(vol.writev));
  _fsync.mockImplementation((_fd, cb) => {
    cb(new Error("hello"));
  });

  const _resolve1 = vi.fn();
  const _resolve2 = vi.fn();
  const _resolve3 = vi.fn();

  vol.fromJSON({ "test.db": "" }, "/");

  const _fsync_failed_cb = vi.fn();
  const writer = new BitcaskWriter(
    file_id,
    "/test.db",
    max_write_chunk_size,
    fsync_interval_ms,
  ).on("fsync_failed", _fsync_failed_cb);

  // open
  expect(_open).toHaveBeenCalledOnce();

  await vi.advanceTimersToNextTimerAsync();

  // write
  writer.write({
    buffer: Buffer.allocUnsafe(16 * 1024).fill("tarrow"),
    reject: () => {},
    resolve: _resolve1,
  });
  // batch
  writer.write({
    buffer: Buffer.from("hello"),
    reject: () => {},
    resolve: _resolve2,
  });
  writer.write({
    buffer: Buffer.from("world"),
    reject: () => {},
    resolve: _resolve3,
  });

  // lazy write
  expect(_writev).not.toHaveBeenCalled();

  await vi.advanceTimersToNextTimerAsync();

  expect(_writev).toHaveBeenCalledTimes(1);

  await vi.advanceTimersToNextTimerAsync();

  expect(_resolve1).toHaveBeenCalledOnce();
  expect(_resolve1).toHaveBeenCalledWith({ file_id, pos: 0 });

  // batch write
  expect(_writev).toHaveBeenCalledTimes(2);

  await vi.advanceTimersToNextTimerAsync();

  expect(_resolve2).toHaveBeenCalledOnce();
  expect(_resolve3).toHaveBeenCalledOnce();
  expect(_resolve2).toHaveBeenCalledWith({ file_id, pos: 16 * 1024 });
  expect(_resolve3).toHaveBeenCalledWith({ file_id, pos: 16 * 1024 + 5 });

  expect(_fsync).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(fsync_interval_ms);

  // fsync
  expect(_fsync).toHaveBeenCalledOnce();

  await vi.runAllTimersAsync();

  expect(_fsync_failed_cb).toHaveBeenCalledOnce();
});

it("fsync before close", async () => {
  const file_id = 1;
  const fsync_interval_ms = -1;
  _open.mockImplementation(delay(vol.open));
  _writev.mockImplementation(delay(vol.writev));
  _fsync.mockImplementation(delay(vol.fsync));

  const _resolve = vi.fn();

  vol.fromJSON({ "test.db": "" }, "/");

  const _close_cb = vi.fn();
  const writer = new BitcaskWriter(
    file_id,
    "/test.db",
    max_write_chunk_size,
    fsync_interval_ms,
  ).on("close", _close_cb);

  // open
  expect(_open).toHaveBeenCalledOnce();

  await vi.advanceTimersToNextTimerAsync();

  // write
  writer.write({
    buffer: Buffer.from("hello"),
    reject: () => {},
    resolve: _resolve,
  });

  // lazy write
  expect(_writev).not.toHaveBeenCalled();

  await vi.advanceTimersToNextTimerAsync();

  expect(_writev).toHaveBeenCalledTimes(1);

  await vi.advanceTimersToNextTimerAsync();

  expect(_resolve).toHaveBeenCalledOnce();
  expect(_resolve).toHaveBeenCalledWith({ file_id, pos: 0 });

  expect(_fsync).not.toHaveBeenCalled();

  writer.close();

  // fsync
  expect(_fsync).toHaveBeenCalledOnce();

  await vi.advanceTimersToNextTimerAsync();

  expect(_close_cb).toHaveBeenCalledOnce();
});

it("failed_to_fsync_before_close", async () => {
  const file_id = 1;
  const fsync_interval_ms = -1;
  _open.mockImplementation(delay(vol.open));
  _writev.mockImplementation(delay(vol.writev));
  _fsync.mockImplementation((_fd, cb) => {
    cb(new Error("hello"));
  });

  const _resolve = vi.fn();

  vol.fromJSON({ "test.db": "" }, "/");

  const _fsync_failed = vi.fn();
  const writer = new BitcaskWriter(
    file_id,
    "/test.db",
    max_write_chunk_size,
    fsync_interval_ms,
  ).on("fsync_failed", _fsync_failed);

  // open
  expect(_open).toHaveBeenCalledOnce();

  await vi.advanceTimersToNextTimerAsync();

  // write
  writer.write({
    buffer: Buffer.from("hello"),
    reject: () => {},
    resolve: _resolve,
  });

  // lazy write
  expect(_writev).not.toHaveBeenCalled();

  await vi.advanceTimersToNextTimerAsync();

  expect(_writev).toHaveBeenCalledTimes(1);

  await vi.advanceTimersToNextTimerAsync();

  expect(_resolve).toHaveBeenCalledOnce();
  expect(_resolve).toHaveBeenCalledWith({ file_id, pos: 0 });

  expect(_fsync).not.toHaveBeenCalled();

  writer.close();

  // fsync
  expect(_fsync).toHaveBeenCalledOnce();

  await vi.advanceTimersToNextTimerAsync();

  expect(_fsync_failed).toHaveBeenCalledOnce();
});

it("abort close", async () => {
  const file_id = 1;
  _open.mockImplementation(delay(vol.open));
  _writev.mockImplementation(delay(vol.writev));
  _close.mockImplementation(delay(vol.close));

  const _close_cb = vi.fn();
  const _resolve = vi.fn();

  vol.fromJSON({ "test.db": "" }, "/");

  const writer = new BitcaskWriter(
    file_id,
    "/test.db",
    max_write_chunk_size,
    fsync_interval_ms,
  );
  writer.on("close", _close_cb);
  writer.close();
  writer.write({
    buffer: Buffer.from("hello"),
    reject: () => {},
    resolve: _resolve,
  });

  // open
  expect(_open).toHaveBeenCalledOnce();

  // lazy write
  await vi.advanceTimersToNextTimerAsync();
  await vi.advanceTimersToNextTimerAsync();

  // write
  expect(_writev).toHaveBeenCalledOnce();
  expect(_resolve).not.toHaveBeenCalled();

  await vi.advanceTimersToNextTimerAsync();

  // write end
  expect(_resolve).toHaveBeenCalledOnce();

  await vi.runAllTimersAsync();

  // not close not closed
  expect(_close).not.toHaveBeenCalled();
  expect(_close_cb).not.toHaveBeenCalled();
});
