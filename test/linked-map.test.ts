import { expect, it, vi } from "vitest";
import { LinkedMap } from "../src/linked-map";

it("linked-map", () => {
  const map = new LinkedMap();
  for (let i = 1; i <= 10; i++) {
    map.set(i, i);
  }

  expect(map.get(1)).toEqual(1);
  expect(map.get(11)).toBeUndefined();

  expect(map.has(1)).toBeTruthy();
  expect(map.has(11)).toBeFalsy();

  expect(map.size).toEqual(10);
  map.delete(11);
  expect(map.size).toEqual(10);

  map.delete(10);
  expect(map.size).toEqual(9);

  map.delete(1);
  expect(map.size).toEqual(8);

  map.set(3, 1);
  map.set(9, 1);

  expect([...map.keys()]).toStrictEqual([2, 4, 5, 6, 7, 8, 3, 9]);
  expect([...map.values()]).toStrictEqual([2, 4, 5, 6, 7, 8, 1, 1]);
  expect([...map.entries()]).toStrictEqual([
    [2, 2],
    [4, 4],
    [5, 5],
    [6, 6],
    [7, 7],
    [8, 8],
    [3, 1],
    [9, 1],
  ]);

  map.clear();
  expect(map.size).toEqual(0);

  for (let i = 1; i <= 10; i++) {
    map.set(i, i);
  }

  expect(map.get_and_move_to_tail(1)).toEqual(1);
  expect(map.get_and_move_to_tail(1)).toEqual(1);
  expect(map.get_and_move_to_tail(10)).toEqual(10);
  expect(map.get_and_move_to_tail(11)).toBeUndefined();

  const cb = vi.fn();
  map.forEach(cb);
  expect(cb).toHaveBeenCalledWith(10, 10, map);

  map.forEach(cb, "test");
  expect(cb).toHaveBeenCalledWith(10, 10, map);
});

it("ordered", () => {
  const map = new LinkedMap([
    [1, 1],
    [2, 2],
  ]);

  expect([...map]).toStrictEqual([
    [1, 1],
    [2, 2],
  ]);

  map.set(1, 3);

  expect([...map]).toStrictEqual([
    [2, 2],
    [1, 3],
  ]);

  map.set(1, 4);

  expect([...map]).toStrictEqual([
    [2, 2],
    [1, 4],
  ]);

  map.set(3, 5);

  expect([...map]).toStrictEqual([
    [2, 2],
    [1, 4],
    [3, 5],
  ]);

  map.get_and_move_to_tail(2);

  expect([...map]).toStrictEqual([
    [1, 4],
    [3, 5],
    [2, 2],
  ]);

  map.get_and_move_to_tail(2);

  expect([...map]).toStrictEqual([
    [1, 4],
    [3, 5],
    [2, 2],
  ]);
});

it("iterator", () => {
  const cb = vi.fn();
  let map = new LinkedMap([
    [1, 1],
    [2, 2],
    [3, 3],
  ]);

  for (const key of map.keys()) {
    map.delete(key);
    cb();
  }

  expect(cb).toHaveBeenCalledTimes(3);
  expect(map.size).toBe(0);

  cb.mockClear();
  map = new LinkedMap([
    [1, 1],
    [2, 2],
    [3, 3],
  ]);

  for (const value of map.values()) {
    map.delete(value);
    cb();
  }

  expect(cb).toHaveBeenCalledTimes(3);
  expect(map.size).toBe(0);

  cb.mockClear();
  map = new LinkedMap([
    [1, 1],
    [2, 2],
    [3, 3],
  ]);

  for (const [key] of map.entries()) {
    map.delete(key);
    cb();
  }

  expect(cb).toHaveBeenCalledTimes(3);
  expect(map.size).toBe(0);

  cb.mockClear();
  map = new LinkedMap([
    [1, 1],
    [2, 2],
    [3, 3],
  ]);

  map.forEach((_, key) => {
    map.delete(key);
    cb();
  });

  expect(cb).toHaveBeenCalledTimes(3);
  expect(map.size).toBe(0);
});
