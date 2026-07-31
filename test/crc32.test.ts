import { crc32 } from "node:zlib";
import { expect, it } from "vitest";
import _crc32 from "../src/crc32";

it("crc32", () => {
  expect(_crc32).toStrictEqual(crc32);
});
