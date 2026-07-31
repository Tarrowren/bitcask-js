import { fs, vol } from "memfs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BitcaskReader } from "../src/file";
import { delay, error } from "./util";

vi.mock("node:fs", () => fs);
vi.mock("node:fs/promises", () => fs.promises);
const _open = vi.spyOn(fs, "open");
const _close = vi.spyOn(fs, "close");

beforeEach(() => {
  vi.useFakeTimers();
  vol.reset();
});
afterEach(() => {
  vi.resetAllMocks();
  vol.reset();
});

it("close_ignore_error", async () => {
  const file_id = 1;
  const message = "failed";
  _open.mockImplementation(delay(vol.open));
  _close.mockImplementation(error(message));

  const _error_cb = vi.fn();
  const _close_cb = vi.fn();

  vol.fromJSON({ "test.db": Buffer.from("0123456789") }, "/");

  const reader = new BitcaskReader(file_id, "/test.db", false);
  reader.on("error", _error_cb);
  reader.on("close", _close_cb);
  reader.close();

  // open
  expect(_open).toHaveBeenCalledOnce();
  expect(_close).not.toHaveBeenCalled();

  await vi.advanceTimersToNextTimerAsync();

  // close
  expect(_close).toHaveBeenCalledOnce();
  expect(_close_cb).not.toHaveBeenCalled();
  expect(_error_cb).not.toHaveBeenCalled();

  await vi.advanceTimersToNextTimerAsync();

  // closed
  expect(_close_cb).toHaveBeenCalledOnce();
  expect(_error_cb).toHaveBeenCalledOnce();
  expect(_error_cb).toHaveBeenCalledWith(expect.objectContaining({ message }));
});

it("open_failed", async () => {
  const file_id = 1;
  _open.mockImplementation(delay(vol.open));
  _close.mockImplementation(delay(vol.close));

  const _error_cb = vi.fn();
  const _close_cb = vi.fn();

  vol._core.maxFiles = 1;
  vol.fromJSON({ "test.db": Buffer.from("0123456789") }, "/");

  fs.open("/test.db", fs.constants.O_RDONLY, () => {});
  _open.mockClear();

  const reader = new BitcaskReader(file_id, "/test.db", false);
  reader.on("error", _error_cb);
  reader.on("close", _close_cb);

  // open
  expect(_open).toHaveBeenCalledOnce();
  expect(_close).not.toHaveBeenCalled();
  expect(_error_cb).not.toHaveBeenCalled();

  await vi.advanceTimersToNextTimerAsync();

  // closed
  expect(_close_cb).toHaveBeenCalledOnce();
  expect(_error_cb).toHaveBeenCalledOnce();
  expect(_error_cb).toHaveBeenCalledWith(
    expect.objectContaining({ code: "EMFILE" }),
  );
});
