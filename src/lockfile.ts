import { constants, readFile, unlink, writeFile } from "node:fs/promises";

const flags =
  constants.O_TRUNC | constants.O_CREAT | constants.O_WRONLY | constants.O_EXCL;
const flags_force = constants.O_TRUNC | constants.O_CREAT | constants.O_WRONLY;

enum ProcessStatus {
  SELF,
  INVALID,
  ACTIVE,
}

async function _get(
  path: string,
  pid: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await writeFile(path, pid, { flag: flags, encoding: "ascii", signal });
  } catch (err) {
    const status = await _stat(path, pid, signal);
    if (status === ProcessStatus.INVALID) {
      await writeFile(path, pid, {
        flag: flags_force,
        encoding: "ascii",
        signal,
      });
    } else {
      throw err;
    }
  }
}

async function _stat(
  path: string,
  current_pid: string,
  signal?: AbortSignal,
): Promise<ProcessStatus> {
  const text = await readFile(path, { encoding: "ascii", signal });
  if (current_pid === text) {
    return ProcessStatus.SELF;
  }

  const pid = Number.parseInt(text);
  if (Number.isSafeInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 0);
      return ProcessStatus.ACTIVE;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ESRCH") {
        // No such process
        return ProcessStatus.INVALID;
      }
      return ProcessStatus.ACTIVE;
    }
  }

  return ProcessStatus.INVALID;
}

enum LockStatus {
  UNLOCKED,
  LOCKED,
  UNLOCKING,
  LOCKING,
}
export class UnsafeLockFile {
  private _locked = LockStatus.UNLOCKED;

  constructor(private readonly _path: string) {}

  async lock(signal?: AbortSignal): Promise<void> {
    if (this._locked !== LockStatus.UNLOCKED) {
      throw new Error("Lock already taken");
    }

    this._locked = LockStatus.LOCKING;

    try {
      await _get(this._path, "" + process.pid, signal);
    } catch (err) {
      this._locked = LockStatus.UNLOCKED;
      throw err;
    }

    this._locked = LockStatus.LOCKED;
  }

  async unlock(): Promise<void> {
    if (this._locked !== LockStatus.LOCKED) {
      return;
    }

    this._locked = LockStatus.UNLOCKING;

    try {
      await unlink(this._path);
    } catch (_err) {
      // ingore
    }

    this._locked = LockStatus.UNLOCKED;
  }
}
