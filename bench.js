import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { Bitcask } from "./dist/index.mjs";

const large = Buffer.from(
  "123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890",
);
const medium = Buffer.from(
  "1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890",
);
const small = Buffer.from("12345678901234567890");
const MAX_RUNS = 10000;

const put_keys = shuffle(1, 3 * MAX_RUNS);
const get_keys = shuffle(MAX_RUNS, 3 * MAX_RUNS);

let index = 0;

await run();

async function run() {
  const db_path = resolve("db");
  await rm(db_path, { recursive: true, force: true });

  const db = new Bitcask(db_path)
    .on("error", (err) => {
      console.log("error", err);
    })
    .on("close", () => {
      console.log("end");
    });
  try {
    index = 0;
    await put(db, "small", small);
    await put(db, "medium", medium);
    await put(db, "large", large);

    index = 0;
    await get(db, "small");
    await get(db, "medium");
    await get(db, "large");
  } finally {
    db.dispose();
  }
}

async function get(db, label) {
  const p = new Array(MAX_RUNS);
  await time(`get ${label} >>`, async () => {
    for (let i = 0; i < MAX_RUNS; i++) {
      const key = get_keys[index];
      index++;
      p[i] = db.get("" + key).then((v) => {
        if (!v) {
          console.error("NOT FOUND");
        }
      });
    }
    await Promise.all(p);
  });
}

async function put(db, label, data) {
  const p = new Array(MAX_RUNS);
  await time(`set ${label} >>`, async () => {
    for (let i = 0; i < MAX_RUNS; i++) {
      const key = put_keys[index];
      index++;
      p[i] = db.put("" + key, data);
    }
    await Promise.all(p);
  });
}

function shuffle(step, length) {
  const result = new Array(length);
  let i = 0;
  for (let start = 0; start < step; start++) {
    for (let v = start; v < length; v += step) {
      result[i] = v + 1;
      i++;
    }
  }
  return result;
}

async function time(label, callback) {
  console.log(label);

  const start = performance.now();

  await callback();

  const time = (performance.now() - start) / 1000;
  const opsPerSecond = MAX_RUNS / time;

  console.log(
    "time",
    time.toFixed(2),
    "ms,",
    opsPerSecond.toFixed(2) + " ops/s",
  );
}
