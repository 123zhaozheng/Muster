// OWNER: B4. Tiny single-consumer async queue backing DriverSession.events.
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: Array<(r: IteratorResult<T>) => void> = [];
  private done = false;

  push(v: T): void {
    if (this.done) return;
    const w = this.waiters.shift();
    if (w) w({ value: v, done: false });
    else this.items.push(v);
  }

  end(): void {
    if (this.done) return;
    this.done = true;
    for (const w of this.waiters) w({ value: undefined, done: true });
    this.waiters = [];
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift() as T, done: false });
        if (this.done) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<T>>((res) => this.waiters.push(res));
      },
      return: async () => {
        this.end();
        return { value: undefined, done: true };
      },
    };
  }
}
