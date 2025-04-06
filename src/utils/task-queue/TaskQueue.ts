type Task = () => Promise<void>;

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

    while (this.queue.length > 0) {
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
