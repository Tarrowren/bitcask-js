import { fs, vol } from "memfs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { get_random_file_name } from "../src/random-name";

vi.mock("node:fs", () => fs);
vi.mock("node:fs/promises", () => fs.promises);
const _random = vi.spyOn(Math, "random");

beforeEach(() => {
  vol.reset();
});
afterEach(() => {
  vi.resetAllMocks();
  vol.reset();
  vol._core.maxFiles = 10000;
});

const db_path = "/";

it("random_file_name", async () => {
  vol.fromJSON({}, db_path);

  const file_name = await get_random_file_name(db_path, true);

  expect(vol.toJSON()).toStrictEqual({
    [`/${file_name}.data`]: "",
    [`/${file_name}.hint`]: "",
  });
});

it("failed_to_generate", async () => {
  vol.fromJSON({}, db_path);

  _random.mockReturnValue(0);

  await expect(get_random_file_name(db_path, false)).resolves.toBe(
    "0000000000000",
  );
  await expect(get_random_file_name(db_path, false)).rejects.toThrow("failed");
});

it("emfile", async () => {
  vol._core.maxFiles = 0;
  vol.fromJSON({}, db_path);

  await expect(get_random_file_name(db_path, false)).rejects.toThrow("EMFILE");
});
