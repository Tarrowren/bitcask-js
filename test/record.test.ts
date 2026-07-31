import { fs, vol } from "memfs";
import { pipeline } from "node:stream/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as m from "../src/def";
import { TOMBSTONE } from "../src/def";
import type { Dir } from "../src/dir";
import {
  load_older_data_file,
  record_delete,
  record_read,
  record_write,
} from "../src/record";

vi.mock("node:fs", () => fs);
vi.mock("node:fs/promises", () => fs.promises);
const _max_key_sz = vi.spyOn(m, "max_key_sz", "get");
const _max_value_sz = vi.spyOn(m, "max_value_sz", "get");
const _max_record_sz = vi.spyOn(m, "max_record_sz", "get");

beforeEach(() => {
  vol.reset();
});
afterEach(() => {
  vi.resetAllMocks();
  vol.reset();
});

it("record", () => {
  const key = "1";
  const value = Buffer.from("1");
  const epoch = 1n;
  const record = Buffer.of(
    203,
    246,
    57,
    29,
    //
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    //
    0,
    1,
    //
    0,
    0,
    0,
    1,
    //
    49,
    //
    49,
  );

  const buf = record_write(key, value, epoch);

  expect(buf).toStrictEqual(record);
  expect(record_read(buf)).toStrictEqual({ key, value, epoch });
  expect(record_read(buf.subarray(0, -1))).toBeUndefined();
});

it("delete", () => {
  const key = "1";
  const epoch = 1n;

  const buf = record_delete(key, epoch);

  expect(buf).toStrictEqual(
    Buffer.of(
      184,
      38,
      216,
      4,
      //
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      //
      0,
      1,
      //
      255,
      255,
      255,
      255,
      //
      49,
      //
      // value null
    ),
  );

  expect(record_read(buf)).toBeUndefined();
});

it("load", async () => {
  const d1 = {
    key: "1",
    value_sz: 10,
    record_sz: 29,
    record_pos: 0,
    epoch: 1n,
  };
  const d2 = {
    key: "2",
    value_sz: 7,
    record_sz: 26,
    record_pos: 29,
    epoch: 2n,
  };
  const d3 = {
    key: "3",
    value_sz: TOMBSTONE,
    record_sz: 19,
    record_pos: 55,
    epoch: 3n,
  };
  const buf1 = record_write(d1.key, Buffer.from("1234567890"), d1.epoch);
  const buf2 = record_write(d2.key, Buffer.from("abcdefg"), d2.epoch);
  const buf3 = record_delete(d3.key, d3.epoch);
  const buf4 = Buffer.alloc(18);

  vol.fromJSON({ file: Buffer.concat([buf1, buf2, buf3, buf4]) }, "/");

  await expect(
    pipeline(
      load_older_data_file(fs.createReadStream("/file", { highWaterMark: 1 })),
      async (source) => {
        const data: Dir[] = [];
        for await (const hint of source) {
          data.push(hint);
        }
        return data;
      },
    ),
  ).resolves.toStrictEqual([d1, d2, d3]);

  await expect(
    pipeline(
      load_older_data_file(
        fs.createReadStream("/file", { highWaterMark: 1024 }),
      ),
      async (source) => {
        const data: Dir[] = [];
        for await (const hint of source) {
          data.push(hint);
        }
        return data;
      },
    ),
  ).resolves.toStrictEqual([d1, d2, d3]);
});

it("size_exceeds", () => {
  _max_key_sz.mockImplementation(() => 1);
  expect(() => record_write("hello", Buffer.alloc(16), 1n)).toThrow(
    "the key size exceeds 1.",
  );
  expect(() => record_delete("hello", 1n)).toThrow("the key size exceeds 1.");
  _max_key_sz.mockRestore();

  _max_value_sz.mockImplementation(() => 4);
  expect(() => record_write("hello", Buffer.alloc(16), 1n)).toThrow(
    "the value size exceeds 4.",
  );
  _max_value_sz.mockRestore();

  _max_record_sz.mockImplementation(() => 16);
  expect(() => record_write("hello", Buffer.alloc(16), 1n)).toThrow(
    "the record size exceeds 16.",
  );
  expect(() => record_delete("hello", 1n)).toThrow(
    "the record size exceeds 16.",
  );
  _max_record_sz.mockRestore();
});
