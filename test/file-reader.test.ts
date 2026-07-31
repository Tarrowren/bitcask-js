import { fs, vol } from "memfs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BitcaskReader, ReadRequestType } from "../src/file";
import * as m from "../src/stream";
import { delay, error } from "./util";

vi.mock("node:fs", () => fs);
vi.mock("node:fs/promises", () => fs.promises);
const _open = vi.spyOn(fs, "open");
const _read = vi.spyOn(fs, "read");
const _close = vi.spyOn(fs, "close");
const _NoCloseReadStream = vi.spyOn(m, "NoCloseReadStream");

beforeEach(() => {
  vi.useFakeTimers();
  vol.reset();
});
afterEach(() => {
  vi.resetAllMocks();
  vol.reset();
});

it("enoent", async () => {
  const file_id = 1;
  _open.mockImplementation(delay(vol.open));
  _close.mockImplementation(delay(vol.close));

  const _close_cb = vi.fn();
  const _error_cb = vi.fn();

  const reader = new BitcaskReader(file_id, "/test.db", false);
  reader.on("close", _close_cb);
  reader.on("error", _error_cb);

  // open
  expect(_open).toHaveBeenCalledOnce();

  await vi.advanceTimersToNextTimerAsync();

  // open failed, close
  expect(_error_cb).toHaveBeenCalledWith(
    expect.objectContaining({ code: "ENOENT" }),
  );
  expect(_close_cb).toHaveBeenCalledOnce();
  expect(_close).not.toHaveBeenCalled();
});

it("open - read - closed - read", async () => {
  const file_id = 1;
  _open.mockImplementation(delay(vol.open));
  _read.mockImplementation(delay(vol.read));
  _close.mockImplementation(delay(vol.close));

  const _close_cb = vi.fn();
  const _resolve1 = vi.fn();
  const _resolve2 = vi.fn();

  vol.fromJSON({ "test.db": Buffer.from("0123456789") }, "/");

  const reader = new BitcaskReader(file_id, "/test.db", false);
  reader.on("close", _close_cb);
  reader.read({
    type: ReadRequestType.READ,
    file_id,
    pos: 0,
    reject: () => {},
    resolve: _resolve1,
    size: 5,
  });
  reader.close();

  // open
  expect(_open).toHaveBeenCalledOnce();

  await vi.advanceTimersToNextTimerAsync();

  // read
  expect(_read).toHaveBeenCalledOnce();
  expect(_resolve1).not.toHaveBeenCalled();

  await vi.advanceTimersToNextTimerAsync();

  // read end
  expect(_resolve1).toHaveBeenCalledOnce();

  // close
  expect(_close).toHaveBeenCalledOnce();
  expect(_close_cb).not.toHaveBeenCalled();

  await vi.advanceTimersToNextTimerAsync();

  // closed
  expect(_close_cb).toHaveBeenCalledOnce();

  reader.read({
    type: ReadRequestType.READ,
    file_id,
    pos: 5,
    reject: () => {},
    resolve: _resolve2,
    size: 5,
  });

  // open
  expect(_open).toHaveBeenCalledTimes(2);

  await vi.advanceTimersToNextTimerAsync();

  // read
  expect(_read).toHaveBeenCalledTimes(2);
  expect(_resolve2).not.toHaveBeenCalled();

  await vi.advanceTimersToNextTimerAsync();

  // read end
  expect(_resolve2).toHaveBeenCalledOnce();
});

it("open - read - dispose - read", async () => {
  const file_id = 1;
  _open.mockImplementation(delay(vol.open));
  _read.mockImplementation(delay(vol.read));
  _close.mockImplementation(delay(vol.close));

  const _close_cb = vi.fn();
  const _reject1 = vi.fn();
  const _reject2 = vi.fn();

  vol.fromJSON({ "test.db": Buffer.from("0123456789") }, "/");

  const reader = new BitcaskReader(file_id, "/test.db", false);
  reader.on("close", _close_cb);
  reader.read({
    type: ReadRequestType.READ,
    file_id,
    pos: 0,
    reject: _reject1,
    resolve: () => {},
    size: 5,
  });
  reader.dispose();
  reader.read({
    type: ReadRequestType.READ,
    file_id,
    pos: 5,
    reject: _reject2,
    resolve: () => {},
    size: 5,
  });
  reader.close();

  // open
  expect(_open).toHaveBeenCalledOnce();

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

  // not read
  expect(_read).not.toHaveBeenCalled();
});

it("open - readstream - closed - readstream", async () => {
  const file_id = 1;
  _open.mockImplementation(delay(vol.open));
  _close.mockImplementation(delay(vol.close));

  const _close_cb = vi.fn();
  const _consum1 = vi.fn();
  const _consum2 = vi.fn();
  const _resolve1 = vi.fn();
  const _resolve2 = vi.fn();

  vol.fromJSON({ "test.db": Buffer.from("0123456789") }, "/");

  const reader = new BitcaskReader(file_id, "/test.db", false);
  reader.on("close", _close_cb);
  reader.read({
    type: ReadRequestType.STREAM,
    file_id,
    hint: false,
    consum: (file_id, _hint, _stream) => {
      _consum1(file_id);
      return new Promise((c) => setTimeout(c, 1000));
    },
    reject: () => {},
    resolve: _resolve1,
  });
  reader.close();

  // open
  expect(_open).toHaveBeenCalledOnce();

  await vi.advanceTimersToNextTimerAsync();

  // readstream
  expect(_NoCloseReadStream).toHaveBeenCalledOnce();
  expect(_resolve1).not.toHaveBeenCalled();
  expect(_consum1).toHaveBeenCalledOnce();
  expect(_consum1).toHaveBeenCalledWith(file_id);

  await vi.advanceTimersToNextTimerAsync();

  // readstream end
  expect(_resolve1).toHaveBeenCalledOnce();

  // close
  expect(_close).toHaveBeenCalledOnce();
  expect(_close_cb).not.toHaveBeenCalled();

  await vi.advanceTimersToNextTimerAsync();

  // closed
  expect(_close_cb).toHaveBeenCalledOnce();

  reader.read({
    type: ReadRequestType.STREAM,
    file_id,
    hint: false,
    consum: (file_id, _hint, _stream) => {
      _consum2(file_id);
      return new Promise((c) => setTimeout(c, 1000));
    },
    reject: () => {},
    resolve: _resolve2,
  });

  // open
  expect(_open).toHaveBeenCalledTimes(2);

  await vi.advanceTimersToNextTimerAsync();

  // readstream
  expect(_NoCloseReadStream).toHaveBeenCalledTimes(2);
  expect(_resolve2).not.toHaveBeenCalled();
  expect(_consum2).toHaveBeenCalledOnce();
  expect(_consum2).toHaveBeenCalledWith(file_id);

  await vi.advanceTimersToNextTimerAsync();

  // readstream end
  expect(_resolve2).toHaveBeenCalledOnce();
});

it("open - readstream - dispose - readstream", async () => {
  const file_id = 1;
  _open.mockImplementation(delay(vol.open));
  _close.mockImplementation(delay(vol.close));

  const _close_cb = vi.fn();
  const _reject1 = vi.fn();
  const _reject2 = vi.fn();

  vol.fromJSON({ "test.db": Buffer.from("0123456789") }, "/");

  const reader = new BitcaskReader(file_id, "/test.db", false);
  reader.on("close", _close_cb);
  reader.read({
    type: ReadRequestType.STREAM,
    file_id,
    hint: false,
    consum: async () => {},
    reject: _reject1,
    resolve: () => {},
  });
  reader.dispose();
  reader.read({
    type: ReadRequestType.STREAM,
    file_id,
    hint: false,
    consum: async () => {},
    reject: _reject2,
    resolve: () => {},
  });
  reader.close();

  // open
  expect(_open).toHaveBeenCalledOnce();

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

  // not readstream
  expect(_NoCloseReadStream).not.toHaveBeenCalled();
});

it("read", async () => {
  const file_id = 1;
  _open.mockImplementation(delay(vol.open));
  _read.mockImplementation(delay(vol.read));

  const _resolve1 = vi.fn();
  const _resolve2 = vi.fn();
  const _resolve3 = vi.fn();
  const _resolve4 = vi.fn();

  vol.fromJSON({ "test.db": Buffer.from("0123456789") }, "/");

  const reader = new BitcaskReader(file_id, "/test.db", false);

  // open
  expect(_open).toHaveBeenCalledOnce();

  await vi.advanceTimersToNextTimerAsync();

  // read
  reader.read({
    type: ReadRequestType.READ,
    file_id,
    pos: 0,
    reject: () => {},
    resolve: _resolve1,
    size: 5,
  });
  reader.read({
    type: ReadRequestType.STREAM,
    file_id,
    hint: false,
    consum: (_file_id, _hint, _stream) => {
      return new Promise((c) => setTimeout(c, 3000));
    },
    reject: () => {},
    resolve: _resolve2,
  });
  reader.read({
    type: ReadRequestType.READ,
    file_id,
    pos: 5,
    reject: () => {},
    resolve: _resolve3,
    size: 5,
  });
  reader.read({
    type: ReadRequestType.STREAM,
    file_id,
    hint: false,
    consum: (_file_id, _hint, _stream) => {
      return new Promise((c) => setTimeout(c, 2000));
    },
    reject: () => {},
    resolve: _resolve4,
  });

  expect(_read).toHaveBeenCalledTimes(2);
  expect(_NoCloseReadStream).toHaveBeenCalledTimes(2);

  await vi.advanceTimersToNextTimerAsync();

  // read end
  expect(_resolve1).toHaveBeenCalledOnce();
  expect(_resolve1).toHaveBeenCalledWith(Buffer.from("01234"));
  expect(_resolve3).toHaveBeenCalledOnce();
  expect(_resolve3).toHaveBeenCalledWith(Buffer.from("56789"));

  expect(_resolve2).not.toHaveBeenCalled();
  expect(_resolve4).not.toHaveBeenCalled();

  // stream end
  await vi.advanceTimersToNextTimerAsync();

  expect(_resolve2).not.toHaveBeenCalled();
  expect(_resolve4).toHaveBeenCalledOnce();

  await vi.advanceTimersToNextTimerAsync();

  expect(_resolve2).toHaveBeenCalledOnce();
});

it("failed", async () => {
  const file_id = 1;
  _open.mockImplementation(delay(vol.open));
  _read.mockImplementation(delay(vol.read));
  const message = "failed";

  const _error_cb = vi.fn();
  const _reject1 = vi.fn();
  const _reject2 = vi.fn();
  const _resolve1 = vi.fn();
  const _resolve2 = vi.fn();

  vol.fromJSON({ "test.db": Buffer.from("0123456789") }, "/");

  const reader = new BitcaskReader(file_id, "/test.db", false);

  // open
  expect(_open).toHaveBeenCalledOnce();
  reader.on("error", _error_cb);

  await vi.advanceTimersToNextTimerAsync();

  // read
  reader.read({
    type: ReadRequestType.READ,
    file_id,
    pos: 0,
    reject: _reject1,
    resolve: _resolve1,
    size: 5,
  });
  // read error
  _read.mockImplementationOnce(error(message));
  reader.read({
    type: ReadRequestType.READ,
    file_id,
    pos: 5,
    reject: _reject2,
    resolve: _resolve2,
    size: 5,
  });
  expect(_read).toHaveBeenCalledTimes(2);

  await vi.advanceTimersToNextTimerAsync();

  // read end
  expect(_resolve1).toHaveBeenCalledOnce();
  expect(_resolve2).not.toHaveBeenCalled();
  expect(_reject1).not.toHaveBeenCalled();
  expect(_reject2).toHaveBeenCalledOnce();
  expect(_resolve1).toHaveBeenCalledWith(Buffer.from("01234"));
  expect(_reject2).toHaveBeenCalledWith(expect.objectContaining({ message }));
});

it("abort close", async () => {
  const file_id = 1;
  _open.mockImplementation(delay(vol.open));
  _read.mockImplementation(delay(vol.read));
  _close.mockImplementation(delay(vol.close));

  const _close_cb = vi.fn();
  const _resolve = vi.fn();

  vol.fromJSON({ "test.db": Buffer.from("0123456789") }, "/");

  const reader = new BitcaskReader(file_id, "/test.db", false);
  reader.on("close", _close_cb);
  reader.close();
  reader.read({
    type: ReadRequestType.READ,
    file_id,
    pos: 0,
    reject: () => {},
    resolve: _resolve,
    size: 5,
  });

  // open
  expect(_open).toHaveBeenCalledOnce();

  await vi.advanceTimersToNextTimerAsync();

  // read
  expect(_read).toHaveBeenCalledOnce();
  expect(_resolve).not.toHaveBeenCalled();

  await vi.advanceTimersToNextTimerAsync();

  // read end
  expect(_resolve).toHaveBeenCalled();

  await vi.runAllTimersAsync();

  // not close
  expect(_close).not.toHaveBeenCalled();
  expect(_close_cb).not.toHaveBeenCalled();

  // not closed
  expect(_close_cb).not.toHaveBeenCalled();
});
