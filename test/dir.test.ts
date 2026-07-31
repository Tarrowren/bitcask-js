import { expect, it } from "vitest";
import { dir_read, dir_write } from "../src/dir";

it("dir", () => {
  const file_id = 1;
  const record_sz = 1;
  const record_pos = 1;
  const epoch = 1n;

  const buf = dir_write(file_id, record_sz, record_pos, epoch);

  expect(buf).toStrictEqual(
    Buffer.of(0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1),
  );

  expect(dir_read(buf)).toStrictEqual({
    file_id,
    record_sz,
    record_pos,
    epoch,
  });
});
