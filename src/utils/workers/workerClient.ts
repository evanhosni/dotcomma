/**
 * THE worker-client base: lazy Worker, one INIT/INIT_DONE handshake, id-correlated
 * request/response, domain-switch reset(). A client module is just typed wrappers.
 * Webpack needs the literal `new Worker(new URL("./x.worker.ts", import.meta.url))`
 * at the call site to bundle the worker — hence the `create` factory.
 */

export interface WorkerClientOptions<TInit> {
  /** Construct the Worker — must be the literal `new Worker(new URL(...))`. */
  create: () => Worker;
  /** INIT payload (sent as `{ type: "INIT", ...payload }`); may be async. Omit for handshake-free workers. */
  init?: () => TInit | Promise<TInit>;
  /** Message `type` a request result arrives with (other types go to onMessage). Default: any message carrying a pending `id`. */
  resultType?: string;
  /** Fire-and-forget messages that aren't request results. */
  onMessage?: (data: any) => void;
}

export interface WorkerClient<TInit = unknown> {
  /** Idempotent; resolves once INIT_DONE arrived. */
  ensure: () => Promise<void>;
  isReady: () => boolean;
  exists: () => boolean;
  /** An `id` is appended to the message and must be echoed in the reply; queued behind ensure(). */
  request: <T = any>(message: Record<string, unknown>, transfer?: Transferable[]) => Promise<T>;
  /** No-op until the worker exists — ensure() first if the message must arrive. */
  post: (message: Record<string, unknown>, transfer?: Transferable[]) => void;
  /** Terminate and drop every in-flight request (a domain switch unmounted their callers). */
  reset: () => void;
}

export const createWorkerClient = <TInit = unknown>(options: WorkerClientOptions<TInit>): WorkerClient<TInit> => {
  let worker: Worker | null = null;
  let ready = false;
  let initPromise: Promise<void> | null = null;
  let nextId = 0;
  const pending = new Map<number, (data: any) => void>();

  const handleMessage = (e: MessageEvent) => {
    const data = e.data;
    if (data && typeof data.id === "number" && (!options.resultType || data.type === options.resultType)) {
      const resolve = pending.get(data.id);
      if (resolve) {
        pending.delete(data.id);
        resolve(data);
        return;
      }
    }
    options.onMessage?.(data);
  };

  const ensure = (): Promise<void> => {
    if (ready) return Promise.resolve();
    if (initPromise) return initPromise;
    initPromise = (async () => {
      // Resolve the init payload BEFORE constructing the worker: a reset()
      // during an awaited init (domain switch) must not leave a stray worker.
      const payload = options.init ? await options.init() : undefined;
      const thisInit = initPromise;
      const w = options.create();
      worker = w;
      if (!options.init) {
        w.onmessage = handleMessage;
        ready = true;
        return;
      }
      await new Promise<void>((resolve) => {
        w.onmessage = (e: MessageEvent) => {
          if (e.data?.type === "INIT_DONE") {
            w.onmessage = handleMessage;
            // Only publish readiness if this init wasn't reset() mid-flight.
            if (worker === w && initPromise === thisInit) ready = true;
            resolve();
          }
        };
        w.postMessage({ type: "INIT", ...(payload as object) });
      });
    })();
    return initPromise;
  };

  const request = async <T = any>(message: Record<string, unknown>, transfer?: Transferable[]): Promise<T> => {
    await ensure();
    const w = worker!;
    const id = nextId++;
    return new Promise<T>((resolve) => {
      pending.set(id, resolve);
      if (transfer) w.postMessage({ ...message, id }, transfer);
      else w.postMessage({ ...message, id });
    });
  };

  const post = (message: Record<string, unknown>, transfer?: Transferable[]) => {
    if (!worker) return;
    if (transfer) worker.postMessage(message, transfer);
    else worker.postMessage(message);
  };

  const reset = () => {
    worker?.terminate();
    worker = null;
    ready = false;
    initPromise = null;
    pending.clear();
  };

  return {
    ensure,
    isReady: () => ready,
    exists: () => worker !== null,
    request,
    post,
    reset,
  };
};
