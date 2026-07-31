import { constants, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { data_ext, hint_ext } from "../src/def";

type Callback<TArgs extends unknown[] = any[]> = (...args: TArgs) => void;

export function delay<TArgs extends unknown[]>(
  fn: Callback<TArgs>,
): Callback<TArgs> {
  return (...args) => {
    const cb = args[args.length - 1];
    if (!(cb instanceof Function)) {
      throw new Error();
    }

    (fn as Callback)(...args.slice(0, args.length - 1), (...args: any[]) => {
      setTimeout(cb as Callback, 1000, ...args);
    });
  };
}

export function error(message: string): Callback {
  return (...args) => {
    const cb = args[args.length - 1];
    if (!(cb instanceof Function)) {
      throw new Error();
    }

    setTimeout(cb as Callback, 1000, new Error(message));
  };
}

export function mock_impl_get_random_file_name(file_name: string) {
  return async (db_path: string, include_hint: boolean): Promise<string> => {
    const flag = constants.O_CREAT | constants.O_EXCL;
    await writeFile(join(db_path, file_name + data_ext), Buffer.alloc(0), {
      flag,
    });
    if (include_hint) {
      await writeFile(join(db_path, file_name + hint_ext), Buffer.alloc(0), {
        flag,
      });
    }
    return file_name;
  };
}
