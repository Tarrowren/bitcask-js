import { fs, vol } from "memfs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BitcaskManifest, type BitcaskManifestRaw } from "../src/manifest";
import * as m from "../src/random-name";
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

it("empty", async () => {
  vol.fromJSON({ "current.txt": "" }, db_path);

  const manifest = await BitcaskManifest.open(db_path);

  expect(manifest.version).toEqual(0);
  expect(manifest.files.size).toEqual(0);
});

it("manifest json error", async () => {
  vol.fromJSON({ "current.txt": "1", "1.manifest.json": "{}" }, db_path);

  await expect(BitcaskManifest.open(db_path)).rejects.toThrow("typia.json");
});

it("version 17", async () => {
  vol.fromJSON(
    {
      "current.txt": "17",
      "17.manifest.json": JSON.stringify({
        files: [
          { name: "hello", hint: false },
          { name: "world", hint: true },
        ],
      } satisfies BitcaskManifestRaw),
      "hello.data": "",
      "world.data": "",
      "world.hint": "",
    },
    db_path,
  );

  const manifest = await BitcaskManifest.open(db_path);

  expect(manifest.version).toEqual(17);
  expect(manifest.files.size).toEqual(2);
});

it("next version", async () => {
  vol.fromJSON(
    {
      "current.txt": "1",
      "1.manifest.json": JSON.stringify({
        files: [
          { name: "hello", hint: false },
          { name: "world", hint: true },
        ],
      } satisfies BitcaskManifestRaw),
      "hello.data": "",
      "world.data": "",
      "world.hint": "",
    },
    db_path,
  );

  const manifest = await BitcaskManifest.open(db_path);

  expect(manifest.version).toEqual(1);
  expect(manifest.files.size).toEqual(2);

  _get_random_file_name.mockImplementationOnce(
    mock_impl_get_random_file_name("tarrow"),
  );

  const { file, next } = await manifest.rotate();

  expect(_get_random_file_name).toHaveBeenCalledOnce();

  expect(next.version).toEqual(2);
  expect(next.files.size).toEqual(3);

  expect(file.file_id).toEqual(2);

  await expect(manifest.rotate()).rejects.toThrow("next version available");
  await expect(manifest.merge([], [])).rejects.toThrow(
    "next version available",
  );

  expect(vol.toJSON()).toStrictEqual({
    "/current.txt": "2",
    "/1.manifest.json":
      '{"files":[{"name":"hello","hint":false},{"name":"world","hint":true}]}',
    "/2.manifest.json":
      '{"files":[{"name":"hello","hint":false},{"name":"world","hint":true},{"name":"tarrow","hint":false}]}',
    "/hello.data": "",
    "/tarrow.data": "",
    "/world.data": "",
    "/world.hint": "",
  });
});

it("merge", async () => {
  vol.fromJSON(
    {
      "current.txt": "1",
      "1.manifest.json": JSON.stringify({
        files: [
          { name: "hello", hint: false },
          { name: "world", hint: true },
        ],
      } satisfies BitcaskManifestRaw),
      "hello.data": "",
      "world.data": "",
      "world.hint": "",
    },
    db_path,
  );

  const manifest = await BitcaskManifest.open(db_path);

  expect(manifest.version).toEqual(1);
  expect(manifest.files.size).toEqual(2);

  const next = await manifest.merge(["world"], ["tarrow"]);

  expect(next.version).toEqual(2);
  expect(next.files.size).toEqual(2);

  expect(vol.toJSON()).toStrictEqual({
    "/current.txt": "2",
    "/1.manifest.json":
      '{"files":[{"name":"hello","hint":false},{"name":"world","hint":true}]}',
    "/2.manifest.json":
      '{"files":[{"name":"hello","hint":false},{"name":"tarrow","hint":true}]}',
    "/hello.data": "",
    "/world.data": "",
    "/world.hint": "",
  });
});
