import { fs, vol } from "memfs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UnsafeLockFile } from "../src/lockfile";

vi.mock("node:fs", () => fs);
vi.mock("node:fs/promises", () => fs.promises);
const _pid = vi.spyOn(process, "pid", "get");
const _kill = vi.spyOn(process, "kill");

beforeEach(() => {
  vol.reset();
});
afterEach(() => {
  vi.resetAllMocks();
  vol.reset();
});

it("mutex", async () => {
  vol.fromJSON({}, "/");

  _pid.mockImplementation(() => 1);
  const lock1 = new UnsafeLockFile("/.LOCK");
  const lock2 = new UnsafeLockFile("/.LOCK");

  await expect(lock1.lock()).resolves.toBeUndefined();

  expect(vol.toJSON()).toStrictEqual({
    "/.LOCK": "1",
  });

  // current pid
  await expect(lock2.lock()).rejects.toThrow();

  // other pid
  _pid.mockImplementation(() => 2);
  _kill.mockImplementation(() => true);
  await expect(lock2.lock()).rejects.toThrow();

  // pid active
  _kill.mockThrow(new Error());
  await expect(lock2.lock()).rejects.toThrow();

  await expect(lock1.lock()).rejects.toThrow("taken");
  await expect(lock1.unlock()).resolves.toBeUndefined();
  await expect(lock2.unlock()).resolves.toBeUndefined();

  expect(vol.toJSON()).toStrictEqual({});
});

it("invalid pid", async () => {
  vol.fromJSON({ "/.LOCK": "-" }, "/");

  _pid.mockImplementation(() => 1);
  const lock1 = new UnsafeLockFile("/.LOCK");

  await expect(lock1.lock()).resolves.toBeUndefined();

  expect(vol.toJSON()).toStrictEqual({
    "/.LOCK": "1",
  });

  await lock1.unlock();

  vol.fromJSON({ "/.LOCK": "2" }, "/");
  _kill.mockThrow({ code: "ESRCH" });
  await expect(lock1.lock()).resolves.toBeUndefined();

  expect(vol.toJSON()).toStrictEqual({ "/.LOCK": "1" });
});
