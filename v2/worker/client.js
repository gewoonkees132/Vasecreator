// Main-thread client for the engine worker (ARCHITECTURE.md).
//
// preview() is latest-request-wins: once a newer preview has been asked for,
// every older one resolves null, even if its result is already on its way.
// The worker also drops previews that are superseded before it starts them,
// so a drag sends many requests but computes only what can still be shown.

/**
 * @param {{ library: { patterns: object[] }, workerUrl?: URL | string }} options
 */
export function createEngine({ library, workerUrl } = {}) {
  const worker = new Worker(workerUrl ?? new URL('./engine.worker.js', import.meta.url), { type: 'module' });
  const waiting = new Map(); // id → { resolve, reject, kind, onProgress }
  let nextId = 1;
  let latestPreview = 0;
  let disposed = false;

  worker.postMessage({ type: 'init', library });

  worker.onmessage = (event) => {
    const msg = event.data;
    const job = waiting.get(msg.id);
    if (!job) return;
    if ('progress' in msg) {
      job.onProgress?.(msg.progress);
      return;
    }
    waiting.delete(msg.id);
    if (msg.error !== undefined) {
      const error = new Error(msg.error);
      error.name = msg.name ?? 'Error';
      // A failed preview that is already stale isn't worth reporting.
      if (job.kind === 'preview' && msg.id !== latestPreview) job.resolve(null);
      else job.reject(error);
      return;
    }
    if (msg.superseded || (job.kind === 'preview' && msg.id !== latestPreview)) job.resolve(null);
    else job.resolve(msg.result);
  };

  // An error event means the worker itself failed (it didn't load, or threw
  // outside a request); it answers nothing after that, so later requests
  // fail at once instead of waiting forever.
  let broken = null;
  worker.onerror = (event) => {
    event.preventDefault?.();
    broken = new Error(event.message || 'The engine stopped working');
    for (const job of waiting.values()) job.reject(broken);
    waiting.clear();
  };

  function request(type, design, printer, onProgress) {
    if (disposed) return Promise.reject(new Error('The engine has been closed'));
    if (broken) return Promise.reject(broken);
    const id = nextId++;
    if (type === 'preview') latestPreview = id;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject, kind: type, onProgress });
      try {
        worker.postMessage({ type, id, design, printer });
      } catch (error) {
        waiting.delete(id);
        reject(error);
      }
    });
  }

  return {
    /** @returns {Promise<object | null>} PreviewResult, or null when a newer preview was asked for */
    preview: (design, printer) => request('preview', design, printer),
    /** @returns {Promise<object>} PrintResult */
    print: (design, printer) => request('print', design, printer),
    /** @returns {Promise<Blob>} text/plain G-code; rejects when an error blocks the export */
    gcode: (design, printer, onProgress) => request('gcode', design, printer, onProgress),
    dispose() {
      disposed = true;
      worker.terminate();
      for (const job of waiting.values()) {
        if (job.kind === 'preview') job.resolve(null);
        else job.reject(new Error('The engine has been closed'));
      }
      waiting.clear();
    },
  };
}
