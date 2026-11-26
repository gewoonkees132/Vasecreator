// Module worker around core/engine.js (research §9.2). All evaluation runs
// here so the main thread only uploads buffers and draws.
//
// Messages in:  { type: 'init', library }
//               { type: 'setImage', id, hash, raster }   stores a copy in the image cache
//               { type: 'preview' | 'print' | 'gcode', id, design, printer }
//               { type: 'cad', id, design, format }       format 'dxf' | 'stl'
// Messages out: { id, result } | { id, superseded: true } | { id, error, name }
//               { id, progress } while G-code is written
//
// Previews are latest-wins: a burst of edits collapses to its last request.
// The newest pending preview waits for a setTimeout(0), so every message
// already queued behind it is read first; the ones it replaces answer
// "superseded" and are never computed.

import { computePreview, computePrint, emitGcode, exportCad } from '../core/engine.js';
import { isRaster } from '../core/raster.js';

let library = { patterns: [] };
// Rasters by hash, posted once by client.setImage(); every request uses them.
const images = new Map();
let pending = null;
let scheduled = false;

const transfers = (r) => [r.positions.buffer, r.kinds.buffer, r.issues.buffer, r.profileLine.buffer, r.seamLine.buffer, r.wallGrid.positions.buffer];

function fail(id, error) {
  self.postMessage({ id, error: error?.message ?? String(error), name: error?.name ?? 'Error' });
}

function runPreview() {
  scheduled = false;
  const job = pending;
  pending = null;
  if (!job) return;
  try {
    const result = computePreview(job.design, { library, printer: job.printer, images });
    self.postMessage({ id: job.id, result }, transfers(result));
  } catch (error) {
    fail(job.id, error);
  }
}

self.onmessage = (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      library = msg.library ?? { patterns: [] };
      return;
    case 'setImage': {
      const r = msg.raster;
      if (typeof msg.hash !== 'string' || !isRaster(r)) {
        fail(msg.id, new TypeError('Not an image raster'));
        return;
      }
      images.set(msg.hash, { width: r.width, height: r.height, data: r.data });
      self.postMessage({ id: msg.id, result: true });
      return;
    }
    case 'preview':
      if (pending) self.postMessage({ id: pending.id, superseded: true });
      pending = msg;
      if (!scheduled) {
        scheduled = true;
        setTimeout(runPreview, 0);
      }
      return;
    case 'print':
      try {
        const { toolpath, ...result } = computePrint(msg.design, { library, printer: msg.printer, images });
        self.postMessage({ id: msg.id, result }, transfers(result));
      } catch (error) {
        fail(msg.id, error);
      }
      return;
    case 'gcode':
      try {
        const print = computePrint(msg.design, { library, printer: msg.printer, images });
        if (!print.canExport) {
          const blocking = print.checks.filter((c) => c.severity === 'error').map((c) => c.message);
          throw Object.assign(new Error(blocking.join('; ') || 'This design cannot be exported'), { name: 'ExportBlocked' });
        }
        let last = -1;
        const chunks = emitGcode(msg.design, print, msg.printer, {
          library,
          images,
          onProgress: (fraction) => {
            // A message per percent is plenty for a progress bar.
            const step = Math.floor(fraction * 100);
            if (step !== last) {
              last = step;
              self.postMessage({ id: msg.id, progress: fraction });
            }
          },
        });
        self.postMessage({ id: msg.id, result: new Blob(chunks, { type: 'text/plain' }) });
      } catch (error) {
        fail(msg.id, error);
      }
      return;
    case 'cad':
      try {
        const file = exportCad(msg.design, msg.format, { library, images });
        self.postMessage({ id: msg.id, result: new Blob(file.chunks, { type: file.type }) });
      } catch (error) {
        fail(msg.id, error);
      }
      return;
    default:
      fail(msg.id, new Error(`Unknown engine request: ${msg.type}`));
  }
};
