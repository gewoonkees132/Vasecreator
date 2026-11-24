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
  let lastDelivered = 0;
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
    // A preview the worker finished is still the newest one computed, so it is
    // delivered even when a newer request is waiting: on a slow phone every
    // request is overtaken during a drag, and dropping them would freeze the pot
    // until the finger lifts (D20). Only results older than one already
    // delivered are dropped.
    if (msg.superseded || (job.kind === 'preview' && msg.id < lastDelivered)) job.resolve(null);
    else {
      if (job.kind === 'preview') lastDelivered = msg.id;
      job.resolve(msg.result);
    }
  };

  // An error event means the worker itself failed (it didn't load, or threw
  // outside a request); it answers nothing after that, so later requests
  // fail at once instead of waiting forever.
  let broken = null;
  worker.onerror = (event) => {
    event.preventDefault?.();
    broken = new Error(event.message || 'The engine stopped working');
    broken.engineBroken = true;
    for (const job of waiting.values()) job.reject(broken);
    waiting.clear();
  };

  function request(type, design, printer, onProgress, extra) {
    if (disposed) return Promise.reject(new Error('The engine has been closed'));
    if (broken) return Promise.reject(broken);
    const id = nextId++;
    if (type === 'preview') latestPreview = id;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject, kind: type, onProgress });
      try {
        // Posted without a transfer list: the worker gets a copy and the caller keeps its raster.
        worker.postMessage(extra ? { type, id, ...extra } : { type, id, design, printer });
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
    /**
     * Stores a copy of a Raster in the worker's image cache, once per image.
     * Resolves after the worker has it, so a preview asked for afterwards sees it.
     * @param {string} hash hashRaster(raster)
     * @param {{ width: number, height: number, data: Uint8Array }} raster
     * @returns {Promise<void>}
     */
    setImage: (hash, raster) => request('setImage', null, null, undefined, {
      hash, raster: { width: raster.width, height: raster.height, data: raster.data },
    }).then(() => undefined),
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
