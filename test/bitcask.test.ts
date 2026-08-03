import { fs, vol } from "memfs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Bitcask } from "../src/bitcask";
import { BitcaskManifest } from "../src/manifest";
import * as m from "../src/opts";

vi.mock("node:fs", () => fs);
vi.mock("node:fs/promises", () => fs.promises);
const _get_file_pool_opts = vi.spyOn(m, "get_file_pool_opts");
const _fsync = vi.spyOn(fs, "fsync");

beforeEach(() => {
  vi.useFakeTimers();
  vol.reset();
});
afterEach(() => {
  vi.resetAllMocks();
  vol.reset();
});

const db_path = "/";

it("open", async () => {
  vol.fromJSON({ "current.txt": "" }, db_path);

  const _close_cb = vi.fn();
  const _error_cb = vi.fn();
  const db = new Bitcask(db_path).on("close", _close_cb).on("error", _error_cb);

  await vi.advanceTimersToNextTimerAsync();

  db.dispose();

  await vi.advanceTimersToNextTimerAsync();

  expect(_close_cb).toHaveBeenCalledOnce();
  expect(_error_cb).not.toHaveBeenCalled();

  await expect(db.get("1")).rejects.toThrow("closed");
  await expect(db.put("1", Buffer.from("hello"))).rejects.toThrow("closed");
  await expect(db.delete("1")).rejects.toThrow("closed");
  await expect(db.keys().next()).rejects.toThrow("closed");
  await expect(db.values().next()).rejects.toThrow("closed");
  await expect(db.entries().next()).rejects.toThrow("closed");
  await expect(db.merge()).rejects.toThrow("closed");
});

it("read_only", async () => {
  vol.fromJSON({ "current.txt": "" }, db_path);

  const _close_cb = vi.fn();
  const _error_cb = vi.fn();
  const db = new Bitcask(db_path, { read_only: true })
    .on("close", _close_cb)
    .on("error", _error_cb);

  const put = expect(db.put("1", Buffer.from("hello"))).rejects.toThrow(
    "read-only",
  );
  const del = expect(db.delete("1")).rejects.toThrow("read-only");
  const merge = expect(db.merge()).rejects.toThrow("read-only");

  await vi.runAllTimersAsync();

  await put;
  await del;
  await merge;
});

it("open_failed", async () => {
  vol.fromJSON(
    {
      "current.txt": "1",
      "1.manifest.json": '{"files":[{"name":"file1","hint":false}]}',
    },
    db_path,
  );

  const _close_cb = vi.fn();
  const _error_cb = vi.fn();
  const db = new Bitcask(db_path).on("close", _close_cb).on("error", _error_cb);

  await vi.runAllTimersAsync();

  expect(_close_cb).not.toHaveBeenCalled();
  expect(_error_cb).toHaveBeenCalled();

  const get = expect(db.get("1")).rejects.toThrow("ENOENT");

  await vi.runAllTimersAsync();

  await get;
});

it("fsync_failed", async () => {
  vol.fromJSON({ "current.txt": "" }, db_path);
  _fsync.mockImplementation((_fd, cb) => {
    cb(new Error("hello"));
  });

  const _close_cb = vi.fn();
  const _error_cb = vi.fn();
  const db = new Bitcask(db_path, { fsync: m.BitcaskFsyncType.ON })
    .on("close", _close_cb)
    .on("error", _error_cb);

  const put = expect(db.put("1", Buffer.from("hello"))).rejects.toThrow(
    "hello",
  );

  await vi.runAllTimersAsync();

  await put;

  expect(_close_cb).toHaveBeenCalled();
  expect(_error_cb).toHaveBeenCalled();
  expect(_error_cb).toHaveBeenCalledWith(
    expect.objectContaining({ message: "hello" }),
  );
});

it("dispose", async () => {
  vol.fromJSON({ "current.txt": "" }, db_path);

  const _close_cb = vi.fn();
  const db = new Bitcask(db_path).on("close", _close_cb);

  db.put("1", Buffer.from("hello"));
  db.put("2", Buffer.from("world"));

  await vi.runAllTimersAsync();

  const keys = db.keys();
  const values = db.values();
  const entries = db.entries();

  keys.next();
  values.next();
  entries.next();

  await vi.runAllTimersAsync();

  db.dispose();

  await expect(keys.next()).rejects.toThrow("closed");
  await expect(values.next()).rejects.toThrow("closed");
  await expect(entries.next()).rejects.toThrow("closed");

  await vi.runAllTimersAsync();

  expect(_close_cb).toHaveBeenCalledOnce();
});

it("load", async () => {
  vol.fromJSON({ "current.txt": "" }, db_path);

  const db1 = new Bitcask(db_path);
  db1.put("1", Buffer.from("hello"));
  db1.put("2", Buffer.from("world"));
  await vi.runAllTimersAsync();
  db1.delete("1");
  await vi.runAllTimersAsync();
  db1.dispose();

  await vi.runAllTimersAsync();

  const db2 = new Bitcask(db_path);
  await vi.runAllTimersAsync();

  const keys = expect(iter(db2.keys())).resolves.toStrictEqual(["2"]);
  await vi.runAllTimersAsync();
  await keys;
});

it("get_put_delete_iterator", async () => {
  vol.fromJSON({ "current.txt": "" }, db_path);

  const db = new Bitcask(db_path);

  const put1 = expect(
    db.put("1", Buffer.from("hello")),
  ).resolves.toBeUndefined();
  await vi.runAllTimersAsync();
  await put1;

  const get1 = expect(db.get("1")).resolves.toStrictEqual(Buffer.from("hello"));
  await vi.runAllTimersAsync();
  await get1;

  const put2 = expect(
    db.put("1", Buffer.from("tarrow")),
  ).resolves.toBeUndefined();
  await vi.runAllTimersAsync();
  await put2;

  const get2 = expect(db.get("1")).resolves.toStrictEqual(
    Buffer.from("tarrow"),
  );
  await vi.runAllTimersAsync();
  await get2;

  const keys = expect(iter(db.keys())).resolves.toStrictEqual(["1"]);
  await vi.runAllTimersAsync();
  await keys;

  const values = expect(iter(db.values())).resolves.toStrictEqual([
    Buffer.from("tarrow"),
  ]);
  await vi.runAllTimersAsync();
  await values;

  const entries = expect(iter(db.entries())).resolves.toStrictEqual([
    ["1", Buffer.from("tarrow")],
  ]);
  await vi.runAllTimersAsync();
  await entries;

  const del1 = expect(db.delete("1")).resolves.toBeUndefined();
  await vi.runAllTimersAsync();
  await del1;

  const get3 = expect(db.get("1")).resolves.toBeUndefined();
  await vi.runAllTimersAsync();
  await get3;

  const del2 = expect(db.delete("1")).resolves.toBeUndefined();
  await vi.runAllTimersAsync();
  await del2;
});

it("merge", async () => {
  vol.fromJSON({ "current.txt": "" }, db_path);

  _get_file_pool_opts.mockReturnValueOnce({
    read_file_pool_limit: 16,
    read_file_pool_cleanratio: 0.5,
    max_write_file_size: 1,
    max_write_chunk_size: 16_384,
    fsync_interval_ms: 10_000,
  });

  const db = new Bitcask(db_path);

  const noop = expect(db.merge()).resolves.toBeUndefined();
  const in_progress = expect(db.merge()).rejects.toThrow("merging in progress");

  await vi.runAllTimersAsync();

  await noop;
  await in_progress;

  {
    const manifest = await BitcaskManifest.open(db_path);
    expect(manifest.files.size).toBe(0);
    expect(manifest.version).toBe(0);
  }

  db.put("1", Buffer.from("hello"));
  await vi.runAllTimersAsync();

  {
    const manifest = await BitcaskManifest.open(db_path);
    expect(manifest.files.size).toBe(1);
    expect(manifest.version).toBe(1);
  }

  db.delete("1");
  await vi.runAllTimersAsync();

  {
    const manifest = await BitcaskManifest.open(db_path);
    expect(manifest.files.size).toBe(2);
    expect(manifest.version).toBe(2);
  }

  db.put("2", Buffer.from("world"));
  await vi.runAllTimersAsync();

  {
    const manifest = await BitcaskManifest.open(db_path);
    expect(manifest.files.size).toBe(3);
    expect(manifest.version).toBe(3);
  }

  const merge = expect(db.merge()).resolves.toBeUndefined();

  await vi.runAllTimersAsync();

  await merge;

  {
    const manifest = await BitcaskManifest.open(db_path);
    expect(manifest.files.size).toBe(1);
    expect(manifest.version).toBe(4);
  }
});

async function iter<T>(it: AsyncGenerator<T>): Promise<T[]> {
  const data: T[] = [];
  for await (const c of it) {
    data.push(c);
  }
  return data;
}
