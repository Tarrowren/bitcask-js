class Node<V> {
  public next: Node<V> | null = null;

  constructor(public readonly value: V) {}
}

export class Queue<V> {
  private _head: Node<V> | null = null;
  private _tail: Node<V> | null = null;
  private _size = 0;

  dispose(): void {
    this._head = null;
    this._tail = null;
    this._size = 0;
  }

  push(value: V): void {
    this._size++;

    const node = new Node(value);

    if (this._tail) {
      this._tail.next = node;
    } else {
      this._head = node;
    }
    this._tail = node;
  }

  peek(): V | undefined {
    return this._head?.value;
  }

  shift(): V | undefined {
    if (this._head === null) {
      return undefined;
    }

    this._size--;

    const node = this._head;
    const next = node.next;
    node.next = null;

    this._head = next;
    if (next === null) {
      this._tail = null;
    }

    return node.value;
  }

  is_empty(): boolean {
    return this._head === null;
  }

  get size(): number {
    return this._size;
  }
}
