class Node<K, V> {
  public prev: Node<K, V> | null = null;
  public next: Node<K, V> | null = null;
  public deleted = false;

  constructor(
    public readonly key: K,
    public value: V,
  ) {}
}

export class LinkedMap<K, V> implements Map<K, V> {
  private _map: Map<K, Node<K, V>> = new Map();
  private _head: Node<K, V> | null = null;
  private _tail: Node<K, V> | null = null;

  constructor(iterable?: Iterable<readonly [K, V]> | null) {
    if (iterable) {
      for (const [k, v] of iterable) {
        this.set(k, v);
      }
    }
  }

  dispose(): void {
    this._map.clear();
    this._head = null;
    this._tail = null;
  }

  clear(): void {
    this.dispose();
  }

  delete(key: K): boolean {
    const node = this._map.get(key);
    if (!node) {
      return false;
    }

    this._map.delete(key);

    node.deleted = true;
    const prev = node.prev;
    const next = node.next;

    if (this._head === node) {
      this._head = next;
    }
    if (this._tail === node) {
      this._tail = prev;
    }

    if (prev) {
      prev.next = next;
    }
    if (next) {
      next.prev = prev;
    }

    return true;
  }

  forEach(
    callbackfn: (value: V, key: K, map: Map<K, V>) => void,
    thisArg?: any,
  ): void {
    const cb = thisArg !== undefined ? callbackfn.bind(thisArg) : callbackfn;
    let node: Node<K, V> | null = null;
    while ((node = node ? node.next : this._head)) {
      cb(node.value, node.key, this);

      while (node?.deleted) {
        node = node.prev;
      }
    }
  }

  get(key: K): V | undefined {
    return this._map.get(key)?.value;
  }

  get_and_move_to_tail(key: K): V | undefined {
    const node = this._map.get(key);
    if (!node) {
      return;
    }

    if (node !== this._tail) {
      node.deleted = true;
      const prev = node.prev;
      const next = node.next!;

      if (this._head === node) {
        this._head = next;
      }

      if (prev) {
        prev.next = next;
      }
      next.prev = prev;

      const new_node = new Node(key, node.value);
      this._map.set(key, new_node);
      new_node.prev = this._tail;
      this._tail!.next = new_node;
      this._tail = new_node;
    }

    return node.value;
  }

  has(key: K): boolean {
    return this._map.has(key);
  }

  set(key: K, value: V): this {
    const node = this._map.get(key);
    if (node) {
      node.value = value;

      if (node !== this._tail) {
        node.deleted = true;
        const prev = node.prev;
        const next = node.next!;

        if (this._head === node) {
          this._head = next;
        }

        if (prev) {
          prev.next = next;
        }
        next.prev = prev;

        const new_node = new Node(key, value);
        this._map.set(key, new_node);
        new_node.prev = this._tail;
        this._tail!.next = new_node;
        this._tail = new_node;
      }
    } else {
      const node = new Node(key, value);
      this._map.set(key, node);

      if (this._tail) {
        node.prev = this._tail;
        this._tail.next = node;
      } else {
        this._head = node;
      }
      this._tail = node;
    }

    return this;
  }

  get size(): number {
    return this._map.size;
  }

  *entries(): MapIterator<[K, V]> {
    let node: Node<K, V> | null = null;
    while ((node = node ? node.next : this._head)) {
      yield [node.key, node.value];

      while (node?.deleted) {
        node = node.prev;
      }
    }
  }

  *keys(): MapIterator<K> {
    let node: Node<K, V> | null = null;
    while ((node = node ? node.next : this._head)) {
      yield node.key;

      while (node?.deleted) {
        node = node.prev;
      }
    }
  }

  *values(): MapIterator<V> {
    let node: Node<K, V> | null = null;
    while ((node = node ? node.next : this._head)) {
      yield node.value;

      while (node?.deleted) {
        node = node.prev;
      }
    }
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  [Symbol.toStringTag] = "LinkedMap";
}
