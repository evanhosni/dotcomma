import { setWorkFocus, TaskQueue } from "./TaskQueue";

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
};

const recorder = () => {
  const order: string[] = [];
  const task = (name: string) => async () => {
    order.push(name);
  };
  return { order, task };
};

describe("TaskQueue priority", () => {
  test("nearest to the focus runs first; unpositioned tasks rank at the bias", async () => {
    setWorkFocus(0, 0);
    const q = new TaskQueue();
    const { order, task } = recorder();
    q.addTask(task("300"), { at: { x: 300, z: 0 } });
    q.addTask(task("100"), { at: { x: 0, z: 100 } });
    q.addTask(task("none"));
    q.addTask(task("200"), { at: { x: -200, z: 0 } });
    await settle();
    expect(order).toEqual(["none", "100", "200", "300"]);
  });

  test("equal ranks keep insertion order", async () => {
    setWorkFocus(0, 0);
    const q = new TaskQueue();
    const { order, task } = recorder();
    for (const name of ["a", "b", "c"]) q.addTask(task(name));
    await settle();
    expect(order).toEqual(["a", "b", "c"]);
  });

  test("ranks compare across queues, scaled by each queue's weight", async () => {
    setWorkFocus(0, 0);
    const near = new TaskQueue();
    const heavy = new TaskQueue({ weight: 3 });
    const { order, task } = recorder();
    heavy.addTask(task("heavy@50"), { at: { x: 50, z: 0 } }); // rank 150
    near.addTask(task("near@100"), { at: { x: 100, z: 0 } }); // rank 100
    near.addTask(task("near@200"), { at: { x: 200, z: 0 } }); // rank 200
    await settle();
    expect(order).toEqual(["near@100", "heavy@50", "near@200"]);
  });

  test("ranks are measured at pick time, not at enqueue time", async () => {
    setWorkFocus(0, 0);
    const q = new TaskQueue();
    const { order, task } = recorder();
    q.addTask(task("origin"), { at: { x: 0, z: 0 } });
    q.addTask(task("ahead"), { at: { x: 500, z: 0 } });
    setWorkFocus(500, 0);
    await settle();
    expect(order).toEqual(["ahead", "origin"]);
  });

  test("a removed task never runs", async () => {
    setWorkFocus(0, 0);
    const q = new TaskQueue();
    const { order, task } = recorder();
    q.addTask(task("keep"));
    const id = q.addTask(task("drop"));
    expect(q.removeTask(id)).toBe(true);
    await settle();
    expect(order).toEqual(["keep"]);
  });
});
