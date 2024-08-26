type Task = () => Promise<void>;

class TaskQueue {
  private queue: Task[] = [];
  private isProcessing = false;

  public addTask(task: Task) {
    this.queue.push(task);
    this.processQueue();
  }

  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      await task();
    }

    this.isProcessing = false;
  }
}

export const taskQueue = new TaskQueue();
