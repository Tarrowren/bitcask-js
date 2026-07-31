import { fs, vol } from "memfs";
import { pipeline } from "node:stream/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NoCloseReadStream } from "../src/stream";

vi.mock("node:fs", () => fs);
vi.mock("node:fs/promises", () => fs.promises);

beforeEach(() => {
  vol.reset();
});
afterEach(() => {
  vol.reset();
});

it("close_fd", async () => {
  vol.fromJSON({ file: "1234567890" }, "/");
  const fd = fs.openSync("/file", fs.constants.O_RDONLY);

  await pipeline(
    fs.createReadStream("", { fd, autoClose: false }),
    async (source) => {
      for await (const _ of source) {
      }
    },
  );

  expect(() => fs.readSync(fd, Buffer.alloc(16), 0, 16, 0)).toThrow("EBADF");
});

it("no_close_fd", async () => {
  vol.fromJSON({ file: "1234567890" }, "/");
  const fd = fs.openSync("/file", fs.constants.O_RDONLY);

  await pipeline(new NoCloseReadStream(fd), async (source) => {
    for await (const _ of source) {
    }
  });

  expect(() => fs.readSync(fd, Buffer.alloc(16), 0, 16, 0)).not.toThrow();
  fs.closeSync(fd);

  await expect(
    pipeline(new NoCloseReadStream(fd), async (source) => {
      for await (const _ of source) {
      }
    }),
  ).rejects.toThrow("EBADF");
});
