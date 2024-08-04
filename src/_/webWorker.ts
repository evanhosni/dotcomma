const createWorkerBlob = (script: string) => {
  const blob = new Blob([script], { type: "application/javascript" });
  return URL.createObjectURL(blob);
};

export const webWorker = (funct: Function, params?: any) => {
  return new Promise<any>((resolve, reject) => {
    const workerUrl = createWorkerBlob(`
      self.onmessage = function(e) {
        const [funct, params] = e.data;
        const result = (${funct})(...params);
        self.postMessage(result);
      };
    `);

    const worker = new Worker(workerUrl);

    worker.onmessage = (e) => {
      resolve(e.data);
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    };

    worker.onerror = (e: ErrorEvent) => {
      reject(new Error("Error from worker: " + e.message));
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    };

    worker.postMessage([funct.toString(), params]);
  });
};
