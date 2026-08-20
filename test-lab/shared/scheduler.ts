export interface ScheduledTask<T = unknown> {
  id: string;
  dueAt: number;
  label: string;
  run(): Promise<T> | T;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export class LogicalScheduler {
  private logicalNow = 0;
  private counter = 0;
  private readonly queue: ScheduledTask[] = [];

  get now(): number {
    return this.logicalNow;
  }

  get pending(): ReadonlyArray<Pick<ScheduledTask, "id" | "dueAt" | "label">> {
    return this.queue.map(({ id, dueAt, label }) => ({ id, dueAt, label }));
  }

  schedule<T>(label: string, delayMs: number, run: () => Promise<T> | T): Promise<T> & { taskId: string } {
    const id = `task-${++this.counter}`;
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((accept, decline) => {
      resolve = accept;
      reject = decline;
    }) as Promise<T> & { taskId: string };
    promise.taskId = id;
    this.queue.push({ id, dueAt: this.logicalNow + Math.max(0, delayMs), label, run, resolve, reject });
    this.sort();
    return promise;
  }

  async advance(milliseconds: number): Promise<void> {
    this.logicalNow += Math.max(0, Math.floor(milliseconds));
    await this.flushDue();
  }

  async flushDue(): Promise<void> {
    const due = this.queue.filter(task => task.dueAt <= this.logicalNow);
    for (const task of due) await this.resolve(task.id);
  }

  async resolve(id: string): Promise<void> {
    const task = this.take(id);
    if (!task) throw new Error(`Unknown scheduled task: ${id}`);
    try {
      task.resolve(await task.run());
    } catch (error) {
      task.reject(error);
    }
  }

  reject(id: string, reason: unknown): void {
    const task = this.take(id);
    if (!task) throw new Error(`Unknown scheduled task: ${id}`);
    task.reject(reason instanceof Error ? reason : new Error(String(reason)));
  }

  reorder(ids: string[]): void {
    const rank = new Map(ids.map((id, index) => [id, index]));
    this.queue.sort((left, right) => {
      const leftRank = rank.get(left.id);
      const rightRank = rank.get(right.id);
      if (leftRank != null || rightRank != null) return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER);
      return left.dueAt - right.dueAt;
    });
  }

  reset(): void {
    const error = new Error("Scheduler reset");
    for (const task of this.queue.splice(0)) task.reject(error);
    this.logicalNow = 0;
    this.counter = 0;
  }

  private take(id: string): ScheduledTask | undefined {
    const index = this.queue.findIndex(task => task.id === id);
    return index < 0 ? undefined : this.queue.splice(index, 1)[0];
  }

  private sort(): void {
    this.queue.sort((left, right) => left.dueAt - right.dueAt || left.id.localeCompare(right.id));
  }
}
