import { constants, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import typia from "typia";
import {
  data_ext,
  hint_ext,
  manifest_ext,
  max_file_id,
  max_manifest_id,
} from "./def";
import { LinkedMap } from "./linked-map";
import { get_random_file_name } from "./random-name";

export class BitcaskManifest {
  private _next_version_available = false;

  constructor(
    private readonly _db_path: string,
    private readonly _raw: BitcaskManifestRaw,
    readonly version: number,
    readonly files: LinkedMap<number, BitcaskFile>,
  ) {}

  async rotate(signal?: AbortSignal): Promise<BitcaskManifestRotate> {
    if (this._next_version_available) {
      throw new Error("next version available.");
    }

    const file_id = Math.max(-1, ...this.files.keys()) + 1;
    if (file_id > max_file_id) {
      throw new Error(`the file id exceeds ${max_file_id}.`);
    }
    const next_version = this.version < max_manifest_id ? this.version + 1 : 1;

    const file_name = await get_random_file_name(this._db_path, false, signal);

    const writer: BitcaskFile = {
      file_id,
      file_name,
      readonly: false,
      data_name: file_name + data_ext,
    };

    const next_raw: BitcaskManifestRaw = {
      files: [...this._raw.files, { name: file_name, hint: false }],
    };
    const next_files = new LinkedMap([
      ...[...this.files].map<[number, BitcaskFile]>(([id, file]) => [
        id,
        { ...file, readonly: true },
      ]),
      [file_id, writer],
    ]);

    const next = new BitcaskManifest(
      this._db_path,
      next_raw,
      next_version,
      next_files,
    );

    await _put_manifest(this._db_path, next_raw, next_version, signal);

    this._next_version_available = true;
    return { next, file: writer };
  }

  async merge(
    old_files: ReadonlyArray<string>,
    new_files: ReadonlyArray<string>,
    signal?: AbortSignal,
  ): Promise<BitcaskManifest> {
    if (this._next_version_available) {
      throw new Error("next version available.");
    }

    const next_version = this.version < max_manifest_id ? this.version + 1 : 1;

    const next_raw: BitcaskManifestRaw = {
      files: [
        ...this._raw.files.filter((v) => !old_files.includes(v.name)),
        ...new_files.map((name) => ({ name, hint: true })),
      ],
    };
    const next_files = new LinkedMap(
      next_raw.files.map<[number, BitcaskFile]>((v, i) => {
        return [
          i,
          {
            file_id: i,
            file_name: v.name,
            readonly: true,
            data_name: v.name + data_ext,
            hint_name: v.hint ? v.name + hint_ext : undefined,
          },
        ];
      }),
    );

    const next = new BitcaskManifest(
      this._db_path,
      next_raw,
      next_version,
      next_files,
    );

    await _put_manifest(this._db_path, next_raw, next_version, signal);

    // Ignore. If the merge fails, the object can still be used.
    // this._next_version_available = true;

    return next;
  }

  static async open(
    db_path: string,
    signal?: AbortSignal,
  ): Promise<BitcaskManifest> {
    let version = await _get_current_version(db_path, signal);
    let raw: BitcaskManifestRaw;
    if (version === null) {
      version = 0;
      raw = { files: [] };
    } else {
      raw = await _get_manifest(db_path, version, signal);
    }

    const files = new LinkedMap(
      raw.files.map<[number, BitcaskFile]>((v, i) => {
        return [
          i,
          {
            file_id: i,
            file_name: v.name,
            readonly: true,
            data_name: v.name + data_ext,
            hint_name: v.hint ? v.name + hint_ext : undefined,
          },
        ];
      }),
    );

    return new BitcaskManifest(db_path, raw, version, files);
  }
}

async function _get_current_version(
  db_path: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const current_path = join(db_path, "current.txt");
  const text = await readFile(current_path, {
    flag: constants.O_CREAT | constants.O_RDONLY,
    encoding: "ascii",
    signal,
  });

  const value = Number.parseInt(text);
  if (!Number.isSafeInteger(value)) {
    return null;
  }

  return value;
}

async function _get_manifest(
  db_path: string,
  manifest_id: number,
  signal?: AbortSignal,
): Promise<BitcaskManifestRaw> {
  const manifest_path = join(db_path, manifest_id + manifest_ext);
  const text = await readFile(manifest_path, {
    flag: constants.O_CREAT | constants.O_RDONLY,
    encoding: "ascii",
    signal,
  });

  return raw_parse(text);
}

async function _put_manifest(
  db_path: string,
  raw: BitcaskManifestRaw,
  manifest_id: number,
  signal?: AbortSignal,
) {
  const flags = constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY;
  const options = {
    encoding: "ascii",
    flag: flags,
    flush: true,
    signal,
  } as const;

  await writeFile(
    join(db_path, manifest_id + manifest_ext),
    raw_stringify(raw),
    options,
  );
  await writeFile(join(db_path, "current.txt"), "" + manifest_id, options);
}

export interface BitcaskManifestRotate {
  readonly next: BitcaskManifest;
  readonly file: BitcaskFile;
}

export interface BitcaskFile {
  readonly file_id: number;
  readonly file_name: string;
  readonly readonly: boolean;
  readonly data_name: string;
  readonly hint_name?: string;
}

export interface BitcaskManifestRaw {
  readonly files: ReadonlyArray<FileMeta>;
}

export interface FileMeta {
  readonly name: string;
  readonly hint: boolean;
}

/* v8 ignore start */
const raw_parse = typia.json.createAssertParse<BitcaskManifestRaw>();
const raw_stringify = typia.json.createStringify<BitcaskManifestRaw>();
/* v8 ignore stop */
