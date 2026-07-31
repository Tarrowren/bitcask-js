import { constants, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { data_ext, hint_ext } from "./def";

export async function get_random_file_name(
  db_path: string,
  include_hint: boolean,
  signal?: AbortSignal,
): Promise<string> {
  const empty = Buffer.allocUnsafe(0);
  const options = {
    flag: constants.O_CREAT | constants.O_EXCL,
    signal,
  } as const;

  for (let i = 0; i < 3; i++) {
    const file_name = _random_name();
    try {
      await writeFile(join(db_path, file_name + data_ext), empty, options);
      if (include_hint) {
        await writeFile(join(db_path, file_name + hint_ext), empty, options);
      }

      return file_name;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        continue;
      }
      throw err;
    }
  }

  throw new Error("failed to generate random file name.");
}

const file_name_length = 13;
const file_name_random_table =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function _random_name(): string {
  let name = "";
  for (let i = 0; i < file_name_length; i++) {
    name +=
      file_name_random_table[
        (Math.random() * file_name_random_table.length) >> 0
      ];
  }
  return name;
}
