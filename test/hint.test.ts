import { fs, vol } from "memfs";
import { pipeline } from "node:stream/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as m from "../src/def";
import type { Dir } from "../src/dir";
import { hint_read, hint_write, load_hint_file } from "../src/hint";

vi.mock("node:fs", () => fs);
vi.mock("node:fs/promises", () => fs.promises);
const _max_key_sz = vi.spyOn(m, "max_key_sz", "get");
const _max_record_sz = vi.spyOn(m, "max_record_sz", "get");
const _max_record_pos = vi.spyOn(m, "max_record_pos", "get");

beforeEach(() => {
  vol.reset();
});
afterEach(() => {
  vi.resetAllMocks();
  vol.reset();
});

it("hint", () => {
  const key = "1";
  const record_sz = 1;
  const record_pos = 1;
  const epoch = 1n;

  const buf = hint_write(key, record_sz, record_pos, epoch);

  expect(buf).toStrictEqual(
    Buffer.of(0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 49),
  );

  expect(hint_read(buf)).toStrictEqual({
    key,
    record_sz,
    record_pos,
    epoch,
  });
});

it("load", async () => {
  const d1: Dir = {
    key: "1",
    value_sz: null,
    record_sz: 1,
    record_pos: 1,
    epoch: 1n,
  };
  const d2: Dir = {
    key: "2",
    value_sz: null,
    record_sz: 2,
    record_pos: 2,
    epoch: 2n,
  };

  const buf1 = hint_write(d1.key, d1.record_sz, d1.record_pos, d1.epoch);
  const buf2 = hint_write(d2.key, d2.record_sz, d2.record_pos, d2.epoch);

  vol.fromJSON({ file: Buffer.concat([buf1, buf2]) }, "/");

  await expect(
    pipeline(
      load_hint_file(fs.createReadStream("/file", { highWaterMark: 1 })),
      async (source) => {
        const data: Dir[] = [];
        for await (const hint of source) {
          data.push(hint);
        }
        return data;
      },
    ),
  ).resolves.toStrictEqual([d1, d2]);

  await expect(
    pipeline(
      load_hint_file(fs.createReadStream("/file", { highWaterMark: 1024 })),
      async (source) => {
        const data: Dir[] = [];
        for await (const hint of source) {
          data.push(hint);
        }
        return data;
      },
    ),
  ).resolves.toStrictEqual([d1, d2]);
});

it("size_exceeds", () => {
  _max_key_sz.mockImplementation(() => 1);
  expect(() => hint_write("hello", 10, 20, 1n)).toThrow(
    "the key size exceeds 1.",
  );
  _max_key_sz.mockRestore();

  _max_record_sz.mockImplementation(() => 4);
  expect(() => hint_write("hello", 10, 20, 1n)).toThrow(
    "the record size exceeds 4.",
  );
  _max_record_sz.mockRestore();

  _max_record_pos.mockImplementation(() => 16);
  expect(() => hint_write("hello", 10, 20, 1n)).toThrow(
    "the record pos exceeds 16.",
  );
  _max_record_pos.mockRestore();
});
