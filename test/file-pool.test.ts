import { fs, vol } from "memfs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BitcaskFilePool } from "../src/file-pool";
import { BitcaskManifest } from "../src/manifest";
import { get_file_pool_opts } from "../src/opts";
import * as m from "../src/random-name";
import { delay, mock_impl_get_random_file_name } from "./util";

vi.mock("node:fs", () => fs);
vi.mock("node:fs/promises", () => fs.promises);
const _open = vi.spyOn(fs, "open");
const _close = vi.spyOn(fs, "close");
const _get_random_file_name = vi.spyOn(m, "get_random_file_name");

beforeEach(() => {
  vi.useFakeTimers();
  vol.reset();
});
afterEach(() => {
  vi.resetAllMocks();
  vol.reset();
  vol._core.maxFiles = 10000;
});

const db_path = "/";

it("open", async () => {
  vol.fromJSON({ "current.txt": "" }, db_path);

  const _close_cb = vi.fn();

  const manifest = await BitcaskManifest.open(db_path);
  const file_pool = new BitcaskFilePool(
    db_path,
    manifest,
    get_file_pool_opts(),
  );
  file_pool.on("close", _close_cb);
  file_pool.dispose();
  file_pool.close();

  await vi.advanceTimersToNextTimerAsync();

  expect(_close_cb).toHaveBeenCalledOnce();
});

it("notfound", async () => {
  vol.fromJSON(
    {
      "current.txt": "1",
      "1.manifest.json": '{"files":[{"name":"file1","hint":false}]}',
      "file1.data": "helloworld",
    },
    db_path,
  );

  const manifest = await BitcaskManifest.open(db_path);
  const file_pool = new BitcaskFilePool(
    db_path,
    manifest,
    get_file_pool_opts(),
  );

  const read1 = expect(file_pool.read(1, 0, 0)).rejects.toThrow("not found");
  const read2 = expect(
    file_pool.read_stream(1, false, async () => {}),
  ).rejects.toThrow("not found");
  const read3 = expect(
    file_pool.read_stream(0, true, async () => {}),
  ).resolves.toBeUndefined();

  await vi.advanceTimersToNextTimerAsync();

  await read1;
  await read2;
  await read3;
});

it("close", async () => {
  vol.fromJSON(
    {
      "current.txt": "1",
      "1.manifest.json":
        '{"files":[{"name":"file1","hint":false},{"name":"file2","hint":false}]}',
      "file1.data": "helloworld",
      "file2.data": "0123456789",
    },
    db_path,
  );

  const _close_cb = vi.fn();
  const manifest = await BitcaskManifest.open(db_path);
  const file_pool = new BitcaskFilePool(
    db_path,
    manifest,
    get_file_pool_opts(),
  ).on("rotate", (c, e) => {
    manifest.rotate().then(c).catch(e);
  });
  file_pool.on("close", _close_cb);
  const _write1 = expect(
    file_pool.write(Buffer.from("test")),
  ).resolves.toStrictEqual({
    file_id: 2,
    pos: 0,
  });
  const _read1 = expect(file_pool.read(0, 0, 1)).resolves.toStrictEqual(
    Buffer.from("h"),
  );
  const _read2 = expect(
    file_pool.read_stream(1, false, async () => {}),
  ).resolves.toBeUndefined();
  const _read3 = expect(file_pool.read(0, 1, 1)).resolves.toStrictEqual(
    Buffer.from("e"),
  );
  file_pool.close();

  await vi.advanceTimersToNextTimerAsync();

  await _write1;
  await _read1;
  await _read2;
  await _read3;

  await vi.advanceTimersToNextTimerAsync();

  const _read4 = expect(file_pool.read(0, 0, 1)).resolves.toStrictEqual(
    Buffer.from("h"),
  );

  await vi.advanceTimersToNextTimerAsync();

  await _read4;

  expect(_close_cb).toHaveBeenCalledOnce();
});

it("dispose", async () => {
  vol.fromJSON(
    {
      "current.txt": "1",
      "1.manifest.json":
        '{"files":[{"name":"file1","hint":false},{"name":"file2","hint":false}]}',
      "file1.data": "helloworld",
      "file2.data": "0123456789",
    },
    db_path,
  );

  const _close_cb = vi.fn();
  const manifest = await BitcaskManifest.open(db_path);
  const file_pool = new BitcaskFilePool(db_path, manifest, {
    read_file_pool_limit: 1,
    read_file_pool_cleanratio: 0.5,
    max_write_file_size: 10,
    max_write_chunk_size: 16_384,
    fsync_interval_ms: 5_000,
  }).on("rotate", (c, e) => {
    manifest.rotate().then(c).catch(e);
  });
  file_pool.on("close", _close_cb);

  const _write1 = expect(
    file_pool.write(Buffer.from("test")),
  ).resolves.toStrictEqual({ file_id: 2, pos: 0 });
  const _read1 = expect(file_pool.read(0, 1, 1)).resolves.toStrictEqual(
    Buffer.from("e"),
  );

  await vi.runAllTimersAsync();

  await _write1;
  await _read1;

  file_pool.dispose();

  const _write2 = expect(file_pool.write(Buffer.from("test"))).rejects.toThrow(
    "closed",
  );
  const _read2 = expect(file_pool.read(0, 0, 1)).rejects.toThrow("closed");
  const _read3 = expect(
    file_pool.read_stream(1, false, async () => {}),
  ).rejects.toThrow("closed");

  await vi.advanceTimersToNextTimerAsync();

  await _write2;
  await _read2;
  await _read3;

  await expect(file_pool.write(Buffer.from("test"))).rejects.toThrow("closed");
  await expect(file_pool.read(0, 0, 1)).rejects.toThrow("closed");
  await expect(file_pool.read_stream(0, false, async () => {})).rejects.toThrow(
    "closed",
  );

  expect(_close_cb).toHaveBeenCalledOnce();
});

it("emfile", async () => {
  vol.fromJSON(
    {
      "current.txt": "1",
      "1.manifest.json":
        '{"files":[{"name":"file1","hint":false},{"name":"file2","hint":false},{"name":"file3","hint":false}]}',
      "file1.data": "helloworld",
      "file2.data": "0123456789",
      "file3.data": "tarrow",
    },
    db_path,
  );
  vol._core.maxFiles = 2;

  const _error_cb = vi.fn();

  const manifest = await BitcaskManifest.open(db_path);
  const file_pool = new BitcaskFilePool(db_path, manifest, {
    read_file_pool_limit: 1_000,
    read_file_pool_cleanratio: 0.5,
    max_write_file_size: 10,
    max_write_chunk_size: 16_384,
    fsync_interval_ms: 5_000,
  }).on("rotate", (c, e) => {
    manifest.rotate().then(c).catch(e);
  });
  file_pool.on("error", _error_cb);

  const read1 = file_pool.read(0, 0, 5);
  const read2 = file_pool.read(1, 0, 5);
  const read3 = file_pool.read(2, 0, 5);

  const _read1 = expect(read1).resolves.toStrictEqual(Buffer.from("hello"));
  const _read2 = expect(read2).resolves.toStrictEqual(Buffer.from("01234"));
  const _read3 = expect(read3).rejects.toThrow("EMFILE");

  expect(_error_cb).not.toHaveBeenCalled();
  await vi.advanceTimersToNextTimerAsync();
  expect(_error_cb).toHaveBeenCalledOnce();
  expect(_error_cb).toHaveBeenCalledWith(
    expect.objectContaining({ code: "EMFILE" }),
  );

  await _read1;
  await _read2;
  await _read3;

  const write1 = file_pool.write(Buffer.from("abcde"));
  const _write1 = expect(write1).rejects.toThrow("EMFILE");

  await vi.advanceTimersToNextTimerAsync();
  expect(_error_cb).toHaveBeenCalledTimes(2);

  await _write1;
});

it("read limit", async () => {
  _open.mockImplementation(delay(vol.open));
  _close.mockImplementation(delay(vol.close));
  vol.fromJSON(
    {
      "current.txt": "1",
      "1.manifest.json":
        '{"files":[{"name":"file1","hint":false},{"name":"file2","hint":false},{"name":"file3","hint":false},{"name":"file4","hint":false}]}',
      "file1.data": "helloworld",
      "file2.data": "0123456789",
      "file3.data": "tarrow",
      "file4.data": "abcdefg",
    },
    db_path,
  );

  const manifest = await BitcaskManifest.open(db_path);
  const file_pool = new BitcaskFilePool(db_path, manifest, {
    read_file_pool_limit: 3,
    read_file_pool_cleanratio: 0.5,
    max_write_file_size: 10,
    max_write_chunk_size: 16_384,
    fsync_interval_ms: 5_000,
  });

  const read1 = file_pool.read(0, 0, 5);
  const read2 = file_pool.read(1, 5, 5);
  const read3 = file_pool.read(2, 0, 5);
  const read4 = file_pool.read(3, 0, 5);
  const read5 = file_pool.read(2, 5, 5);

  await vi.advanceTimersToNextTimerAsync();

  expect(_open).toHaveBeenCalledTimes(3);

  await vi.runAllTimersAsync();

  await expect(read1).resolves.toStrictEqual(Buffer.from("hello"));
  await expect(read2).resolves.toStrictEqual(Buffer.from("56789"));
  await expect(read3).resolves.toStrictEqual(Buffer.from("tarro"));
  await expect(read4).resolves.toStrictEqual(Buffer.from("abcde"));
  await expect(read5).resolves.toStrictEqual(Buffer.from("w"));

  expect(_open).toHaveBeenCalledTimes(4);
  expect(_close).toHaveBeenCalledTimes(2);
});

it("stream limit", async () => {
  _open.mockImplementation(delay(vol.open));
  _close.mockImplementation(delay(vol.close));
  vol.fromJSON(
    {
      "current.txt": "1",
      "1.manifest.json":
        '{"files":[{"name":"file1","hint":true},{"name":"file2","hint":true},{"name":"file3","hint":false},{"name":"file4","hint":false}]}',
      "file1.data": "helloworld",
      "file1.hint": "helloworld",
      "file2.data": "0123456789",
      "file2.hint": "0123456789",
      "file3.data": "tarrow",
      "file4.data": "abcdefg",
    },
    db_path,
  );

  const manifest = await BitcaskManifest.open(db_path);
  const file_pool = new BitcaskFilePool(db_path, manifest, {
    read_file_pool_limit: 3,
    read_file_pool_cleanratio: 0.5,
    max_write_file_size: 10,
    max_write_chunk_size: 16_384,
    fsync_interval_ms: 5_000,
  });

  const cb = vi.fn().mockReturnValue(Promise.resolve());

  const read1 = file_pool.read_stream(0, false, cb);
  const read2 = file_pool.read_stream(1, true, cb);
  const read3 = file_pool.read_stream(2, false, cb);
  const read4 = file_pool.read_stream(3, false, cb);
  const read5 = file_pool.read_stream(2, false, cb);
  const read6 = file_pool.read_stream(0, true, cb);
  const read7 = file_pool.read_stream(1, true, cb);

  await vi.advanceTimersToNextTimerAsync();

  expect(_open).toHaveBeenCalledTimes(3);

  await vi.runAllTimersAsync();

  await expect(read1).resolves.toBeUndefined();
  await expect(read2).resolves.toBeUndefined();
  await expect(read3).resolves.toBeUndefined();
  await expect(read4).resolves.toBeUndefined();
  await expect(read5).resolves.toBeUndefined();
  await expect(read6).resolves.toBeUndefined();
  await expect(read7).resolves.toBeUndefined();

  expect(cb).toHaveBeenCalledTimes(7);

  expect(_open).toHaveBeenCalledTimes(6);
  expect(_close).toHaveBeenCalledTimes(6);
});

it("write", async () => {
  vol.fromJSON({ "current.txt": "" }, db_path);

  const manifest = await BitcaskManifest.open(db_path);
  const file_pool = new BitcaskFilePool(db_path, manifest, {
    read_file_pool_limit: 1_000,
    read_file_pool_cleanratio: 0.5,
    max_write_file_size: 10,
    max_write_chunk_size: 16_384,
    fsync_interval_ms: 5_000,
  }).on("rotate", (c, e) => {
    manifest.rotate().then(c).catch(e);
  });

  _get_random_file_name.mockImplementationOnce(
    mock_impl_get_random_file_name("file1"),
  );

  const write1 = file_pool.write(Buffer.from("hello"));

  const write2 = file_pool.write(Buffer.from("world"));

  await vi.runAllTimersAsync();

  await expect(write1).resolves.toStrictEqual({ file_id: 0, pos: 0 });
  await expect(write2).resolves.toStrictEqual({ file_id: 0, pos: 5 });

  expect(vol.toJSON()).toStrictEqual({
    "/current.txt": "1",
    "/1.manifest.json": '{"files":[{"name":"file1","hint":false}]}',
    "/file1.data": "helloworld",
  });
});

it("write rotate", async () => {
  _open.mockImplementation(delay(vol.open));
  _close.mockImplementation(delay(vol.close));
  vol.fromJSON({ "current.txt": "" }, db_path);

  let manifest = await BitcaskManifest.open(db_path);
  const file_pool = new BitcaskFilePool(db_path, manifest, {
    read_file_pool_limit: 1_000,
    read_file_pool_cleanratio: 0.5,
    max_write_file_size: 9,
    max_write_chunk_size: 16_384,
    fsync_interval_ms: 5_000,
  }).on("rotate", (c, e) => {
    manifest
      .rotate()
      .then((result) => {
        manifest = result.next;
        c(result);
      })
      .catch(e);
  });

  _get_random_file_name.mockImplementationOnce(
    mock_impl_get_random_file_name("file1"),
  );
  const write1 = file_pool.write(Buffer.from("hello"));

  _get_random_file_name.mockImplementationOnce(
    mock_impl_get_random_file_name("file2"),
  );
  const write2 = file_pool.write(Buffer.from("world"));

  await vi.runAllTimersAsync();

  expect(_open).toHaveBeenCalledTimes(2);
  expect(_close).toHaveBeenCalledOnce();

  await expect(write1).resolves.toStrictEqual({ file_id: 0, pos: 0 });
  await expect(write2).resolves.toStrictEqual({ file_id: 1, pos: 0 });

  expect(vol.toJSON()).toStrictEqual({
    "/current.txt": "2",
    "/1.manifest.json": '{"files":[{"name":"file1","hint":false}]}',
    "/2.manifest.json":
      '{"files":[{"name":"file1","hint":false},{"name":"file2","hint":false}]}',
    "/file1.data": "hello",
    "/file2.data": "world",
  });
});
