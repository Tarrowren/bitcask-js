import * as zlib from "node:zlib";
import { expect, it, vi } from "vitest";
import _crc32 from "../src/crc32";

const crc32: typeof zlib.crc32 = (zlib as any).crc32_native;

vi.mock(import("node:zlib"), async (importOriginal) => {
  const _zlib = await importOriginal();
  return { ..._zlib, crc32: undefined, crc32_native: _zlib.crc32 };
});

it("crc32_js", () => {
  expect(_crc32).not.toStrictEqual(crc32);

  test(Buffer.from("123456789"), 0xffffffff);
  test(Buffer.from("abcdefg"), 0x12345678);
  test(Buffer.from("你好"));

  function test(data: Buffer, value?: number) {
    expect(_crc32(data, value)).toBe(crc32(data, value));
  }
});
