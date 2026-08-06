type Task = () => Promise<void>;

/** Main-thread budget per processing slice — heavy tasks (collider builds,
 *  building geometry) yield to the browser between slices so a burst of
 *  spawns can't stack synchronous work into a single frame. */
const SLICE_BUDGET_MS = 6;

export class TaskQueue {
  private queue: { id: string; task: Task }[] = [];
  private isProcessing = false;
  private taskIdCounter = 0;

  public addTask(task: Task): string {
    const taskId = `task-${this.taskIdCounter++}`;
    this.queue.push({ id: taskId, task });
    this.processQueue();
    return taskId;
  }

  public removeTask(taskId: string): boolean {
    const initialLength = this.queue.length;
    this.queue = this.queue.filter((item) => item.id !== taskId);
    return initialLength !== this.queue.length;
  }

  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    let sliceStart = performance.now();
    while (this.queue.length > 0) {
      // Yield a macrotask once the slice budget is spent (awaiting a
      // synchronous task only yields a MICROtask, which never lets the
      // browser render — without this, N queued tasks run in one frame).
      if (performance.now() - sliceStart > SLICE_BUDGET_MS) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        sliceStart = performance.now();
      }
      const { task } = this.queue.shift()!;
      try {
        await task();
      } catch (error) {
        console.error("Error processing task:", error);
      }
    }

    this.isProcessing = false;
  }
}
