import { fs, vol } from "memfs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BitcaskFilePool } from "../src/file-pool";
import { hint_write } from "../src/hint";
import { BitcaskManifest, type BitcaskManifestRaw } from "../src/manifest";
import { clear, merge } from "../src/merge";
import { get_file_pool_opts } from "../src/opts";
import * as m from "../src/random-name";
import { record_delete, record_write } from "../src/record";
import { mock_impl_get_random_file_name } from "./util";

vi.mock("node:fs", () => fs);
vi.mock("node:fs/promises", () => fs.promises);
const _get_random_file_name = vi.spyOn(m, "get_random_file_name");

beforeEach(() => {
  vol.reset();
});
afterEach(() => {
  vi.resetAllMocks();
  vol.reset();
});

const db_path = "/";

it("merge", async () => {
  const buf1 = record_write("word1", Buffer.from("hello"), 1n);
  const buf2 = record_delete("word1", 2n);

  const data = Buffer.concat([buf1, buf2]);

  vol.fromJSON(
    {
      "current.txt": "0",
      "0.manifest.json": JSON.stringify({
        files: [{ name: "1", hint: false }],
      } satisfies BitcaskManifestRaw),
      "1.data": data,
    },
    db_path,
  );

  const manifest = await BitcaskManifest.open(db_path);
  const file_pool = new BitcaskFilePool(
    db_path,
    manifest,
    get_file_pool_opts(),
  );

  const new_files = await merge(
    db_path,
    file_pool,
    [...manifest.files.values()],
    1024,
  );
  expect(new_files).toStrictEqual([]);
});

it("split", async () => {
  const buf1 = record_write("word1", Buffer.from("hello"), 1n);
  const buf2 = record_write("word2", Buffer.from("world"), 2n);

  const h1 = hint_write("word1", buf1.byteLength, 0, 1n);
  const h2 = hint_write("word2", buf2.byteLength, buf1.byteLength, 2n);

  const data1 = Buffer.concat([buf1, buf2]);
  const data2 = record_write("word2", Buffer.from("12345"), 1n);
  const hint1 = Buffer.concat([h1, h2]);
  const hint3 = h1;
  const hint4 = hint_write("word2", buf2.byteLength, 0, 2n);

  vol.fromJSON(
    {
      "current.txt": "0",
      "0.manifest.json": JSON.stringify({
        files: [
          { name: "1", hint: true },
          { name: "2", hint: false },
        ],
      } satisfies BitcaskManifestRaw),
      "1.data": data1,
      "2.data": data2,
      "1.hint": hint1,
    },
    db_path,
  );

  const manifest = await BitcaskManifest.open(db_path);
  const file_pool = new BitcaskFilePool(
    db_path,
    manifest,
    get_file_pool_opts(),
  );

  _get_random_file_name
    .mockImplementation(mock_impl_get_random_file_name("4"))
    .mockImplementationOnce(mock_impl_get_random_file_name("3"));

  const new_files = await merge(
    db_path,
    file_pool,
    [...manifest.files.values()],
    16,
  );
  expect(new_files).toStrictEqual(["3", "4"]);

  expect(vol.toJSON(undefined, undefined, undefined, true)).toStrictEqual({
    "/current.txt": Buffer.from("0"),
    "/0.manifest.json": Buffer.from(
      JSON.stringify({
        files: [
          { name: "1", hint: true },
          { name: "2", hint: false },
        ],
      } satisfies BitcaskManifestRaw),
    ),
    "/1.data": data1,
    "/2.data": data2,
    "/3.data": buf1,
    "/4.data": buf2,
    "/1.hint": hint1,
    "/3.hint": hint3,
    "/4.hint": hint4,
  });
});

it("clear", async () => {
  const raw = JSON.stringify({
    files: [
      { name: "2", hint: true },
      { name: "3", hint: false },
    ],
  } satisfies BitcaskManifestRaw);

  vol.fromJSON(
    {
      ".LOCK": "",
      "other.jpg": "",
      "current.txt": "1",
      "0.manifest.json": "",
      "1.manifest.json": raw,
      "1.data": "",
      "2.data": "",
      "3.data": "",
      "1.hint": "",
      "2.hint": "",
      "3.hint": "",
    },
    db_path,
  );

  const manifest = await BitcaskManifest.open(db_path);
  await clear(db_path, manifest);

  expect(vol.toJSON()).toStrictEqual({
    "/.LOCK": "",
    "/other.jpg": "",
    "/current.txt": "1",
    "/1.manifest.json": raw,
    "/2.data": "",
    "/3.data": "",
    "/2.hint": "",
  });
});
