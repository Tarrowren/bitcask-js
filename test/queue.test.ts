import { expect, it } from "vitest";
import { Queue } from "../src/queue";

it("queue", () => {
  const queue = new Queue<number>();
  queue.push(1);
  queue.push(2);
  queue.push(3);
  queue.push(4);

  expect(queue.size).toBe(4);

  expect(queue.peek()).toEqual(1);
  expect(queue.peek()).toEqual(1);

  expect(queue.size).toBe(4);

  expect(queue.shift()).toEqual(1);
  expect(queue.shift()).toEqual(2);
  expect(queue.shift()).toEqual(3);

  expect(queue.peek()).toEqual(4);

  expect(queue.is_empty()).toBeFalsy();

  expect(queue.size).toBe(1);

  queue.shift();

  queue.dispose();

  expect(queue.is_empty()).toBeTruthy();

  expect(queue.peek()).toBeUndefined();
  expect(queue.shift()).toBeUndefined();

  expect(queue.size).toBe(0);
});
