// Icons shared by more than one part of the app (D49), drawn in-house as the
// step emblems are: 24 × 24, round strokes in the current colour. Each is
// decorative; the button carries the name (ui/press-label.js labelIcon).

const svg = (body, width = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = Object.freeze({
  // Save design: a floppy disk.
  save: svg('<path d="M5 4h11.2L20 7.8V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M8 4v4.5h7V4"/><path d="M7.5 20v-6h9v6"/>', 2),
  // Swap A and B: two arrows, up and down.
  swap: svg('<path d="M8 19V5M4.5 8.5 8 5l3.5 3.5"/><path d="M16 5v14M12.5 15.5 16 19l3.5-3.5"/>', 1.9),
  // A swatch tile that takes an image: a picture with a hill and the sun.
  image: svg('<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.7"/><path d="M4 17.5l5-4.5 3.5 3 2.5-2 5 4"/>'),
  // Make your own: a grid with a plus.
  make: svg('<rect x="3.5" y="3.5" width="12.5" height="12.5" rx="1.6"/><path d="M7.7 3.5v12.5M11.8 3.5v12.5M3.5 7.7h12.5M3.5 11.8h12.5" stroke-width="1.1" opacity=".55"/><path d="M19 15.5v6M16 18.5h6" stroke-width="2"/>'),
  // Edit: a pencil.
  edit: svg('<path d="M15.2 4.8l4 4L8.5 19.5H4.5v-4z"/><path d="M13 7l4 4"/>'),
});
