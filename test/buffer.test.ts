import { expect, it } from "vitest";
import {
  ByteUnit,
  read_byte,
  read_uint,
  read_utf8,
  to_byte,
  Type,
  write_byte,
  write_uint,
  write_utf8,
} from "../src/buffer";

it("read_uint", () => {
  const buf = Buffer.of(1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1);

  expect(read_uint(buf, Type.UINT8, 0)).toBe(1);
  expect(read_uint(buf, Type.UINT16, 1)).toBe(1);
  expect(read_uint(buf, Type.UINT32, 3)).toBe(1);
  expect(read_uint(buf, Type.UINT64, 7)).toBe(1n);
});

it("read_byte", () => {
  const buf = Buffer.of(1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1);

  expect(read_byte(buf, 0, 4)).toStrictEqual(Buffer.of(1, 0, 1, 0));
});

it("read_utf8", () => {
  const buf = Buffer.from("hello");

  expect(read_utf8(buf, 1, 4)).toBe("ello");
});

it("write_uint", () => {
  const buf = Buffer.alloc(15);

  write_uint(buf, Type.UINT8, 1, 0);
  write_uint(buf, Type.UINT16, 1, 1);
  write_uint(buf, Type.UINT32, 1, 3);
  write_uint(buf, Type.UINT64, 1n, 7);

  expect(buf).toStrictEqual(
    Buffer.of(1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1),
  );
});

it("write_byte", () => {
  const buf = Buffer.alloc(5);

  write_byte(buf, Buffer.of(1), 2);

  expect(buf).toStrictEqual(Buffer.of(0, 0, 1, 0, 0));
});

it("write_utf8", () => {
  const buf = Buffer.alloc(5);

  write_utf8(buf, "hello", 0);

  expect(buf).toStrictEqual(Buffer.from("hello"));
});

it("to_byte", () => {
  expect(to_byte(12, ByteUnit.KB)).toBe(12 * 1024);
});
