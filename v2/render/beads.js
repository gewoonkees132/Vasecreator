// The bead renderer: draws the pot exactly as the nozzle lays it, one bead
// per path segment (design §9.7, research §8.2).
//
// Vertex pulling: the GPU reads the toolpath straight from the positions
// array. Each segment (point i → i+1) is one instance of a small template
// (two rings of a rounded cross-section plus flat caps). The vertex shader
// builds the bead's frame from the segment, mitres the rings onto the plane
// that bisects the turn to the neighbouring segment (so beads join without
// gaps or bulges) and collapses segments that carry no bead. setToolpath()
// therefore does no per-segment work in JavaScript at all.
//
// Rendering is on demand only (research §9.2): on camera moves (while damping
// settles), new toolpaths, highlight and marker changes, and resizes.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** Sides around the bead cross-section. 10 keeps the outer face round enough to catch the light per layer. */
const SIDES = 10;
/** Superellipse exponent of the cross-section: 2 is an ellipse, higher is a flatter, squarer (squashed clay) bead. */
const SHAPE_EXP = 2.6;
/** Beads are drawn a little taller than the layer so stacked layers overlap and never show hairline cracks. */
const HEIGHT_OVERLAP = 1.06;
/**
 * Shading level of detail. Once one layer covers fewer screen pixels than
 * LOD_FULL_PX, the bead's cross-section normals ease towards the smooth wall
 * normal, reaching LOD_HINT of their full relief at LOD_FLAT_PX. Sampled
 * finer than that the layer lines alias into moire bands; flattened, they
 * fade to an even texture with a hint of lines.
 */
const LOD_FLAT_PX = 1.0;
const LOD_FULL_PX = 5.0;
const LOD_HINT = 0.1;

const FOV = 35;
const FIT_MARGIN = 0.84;
const THUMB_SUPERSAMPLE = 2;
const DEFAULT_AZIMUTH = THREE.MathUtils.degToRad(32);
const DEFAULT_ELEVATION = THREE.MathUtils.degToRad(22);

const COLOR_BEAD = '#f3f1ec';
const COLOR_WARNING = '#e0a100';
const COLOR_ERROR = '#d64545';
// Dashed and lighter than the solid profile line, so the two never read as one (C13).
const COLOR_SEAM = 'rgb(93,138,139)';

const UP = new THREE.Vector3(0, 0, 1);

// GLSL injected into MeshStandardMaterial. Variable names carry a `bd` prefix
// so they never clash with three's own chunk locals.
const VERT_PARS = /* glsl */`
attribute vec3 aPrev;
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec3 aNext;
attribute vec3 aKinds;   // kind of the previous, this and the next segment (0 = no bead)
attribute float aIssue;  // issue bits of the bead ending at aEnd
uniform vec2 uBead;      // bead width, drawn bead height (mm)
uniform vec2 uHalfPx;    // half the size of the final image, px (NDC to pixels)
uniform int uMask;
varying float vHighlight;
// Horizontal normal of a direction; a vertical move has none, so any
// horizontal side will do.
vec3 bdSideOf( vec3 t ) {
  vec3 s = cross( t, vec3( 0.0, 0.0, 1.0 ) );
  float l = length( s );
  return l > 1e-4 ? s / l : vec3( 1.0, 0.0, 0.0 );
}
`;

// beginnormal_vertex runs before begin_vertex, so the whole frame is built
// here and reused for the position below.
const VERT_NORMAL = /* glsl */`
vec3 bdDir = aEnd - aStart;
float bdLen = length( bdDir );
bool bdLive = aKinds.y > 0.5 && bdLen > 1e-5;
vec3 bdT = bdLive ? bdDir / bdLen : vec3( 1.0, 0.0, 0.0 );
vec3 bdSide = bdSideOf( bdT );
vec3 bdUp = cross( bdSide, bdT );
bool bdAtEnd = position.z > 0.5;
// The neighbouring move at this ring's end of the segment.
vec3 bdNb = bdAtEnd ? aNext - aEnd : aStart - aPrev;
float bdNbKind = bdAtEnd ? aKinds.z : aKinds.x;
float bdNbLen = length( bdNb );
vec3 bdM = bdT;
float bdC = 1.0;
bool bdMitred = false;
if ( bdNbKind > 0.5 && bdNbLen > 1e-5 ) {
  vec3 bdSum = bdT + bdNb / bdNbLen;
  if ( dot( bdSum, bdSum ) > 1e-8 ) {
    bdM = normalize( bdSum );
    bdC = dot( bdT, bdM );
    // Mitre only up to a 120 degree turn; sharper hairpins get open ends.
    bdMitred = bdC > 0.5;
  }
}
// Shade the joint ring with the bisector's frame: both neighbours then agree
// on the normal there, so the joints don't show as stripes.
vec3 bdNT = bdMitred ? bdM : bdT;
vec3 bdNSide = bdSideOf( bdNT );
// z is the top of the bead, so its centre is half a layer lower.
vec3 bdCentre = ( bdAtEnd ? aEnd : aStart ) - vec3( 0.0, 0.0, 0.5 * uBead.y / ${HEIGHT_OVERLAP.toFixed(3)} );
// Level of detail: how many pixels apart this bead and its neighbours land
// on screen. Wall beads stack a layer apart; base beads lie side by side.
bool bdBase = abs( aKinds.y - 3.0 ) < 0.5;
float bdPitch = bdBase ? uBead.x : uBead.y / ${HEIGHT_OVERLAP.toFixed(3)};
vec3 bdStep = ( bdBase ? bdNSide : cross( bdNSide, bdNT ) ) * bdPitch;
vec4 bdClip = projectionMatrix * modelViewMatrix * vec4( bdCentre, 1.0 );
vec4 bdDClip = projectionMatrix * modelViewMatrix * vec4( bdStep, 0.0 );
float bdW = max( bdClip.w, 1e-3 );
float bdPx = length( ( bdDClip.xy * bdW - bdClip.xy * bdDClip.w ) / ( bdW * bdW ) * uHalfPx );
// Seen from above, the layers of a flared wall spread sideways more than up.
// Allow for a flare of up to about 45 degrees, so bowls and flared rims seen
// from above keep their relief.
if ( !bdBase ) bdPx = max( bdPx, bdPitch * abs( normalize( cameraPosition - bdCentre ).z ) * projectionMatrix[1][1] * uHalfPx.y / bdW );
float bdDetail = mix( ${LOD_HINT.toFixed(3)}, 1.0, smoothstep( ${LOD_FLAT_PX.toFixed(3)}, ${LOD_FULL_PX.toFixed(3)}, bdPx ) );
// The template normal belongs to a unit shape; scaling it to width x height
// needs the inverse-transpose, i.e. a divide. Easing the relief off is the
// same as shading a bead stretched along the stacking direction: walls lose
// their up/down tilt, base beads their sideways one.
vec2 bdN = normalize( normal.xy * ( bdBase
  ? vec2( bdDetail / uBead.x, 1.0 / uBead.y )
  : vec2( 1.0 / uBead.x, bdDetail / uBead.y ) ) );
vec3 objectNormal = bdNSide * bdN.x + cross( bdNSide, bdNT ) * bdN.y;
vHighlight = ( uMask != 0 && ( int( aIssue + 0.5 ) & uMask ) != 0 ) ? 1.0 : 0.0;
`;

const VERT_POSITION = /* glsl */`
vec3 bdOff = bdSide * ( position.x * uBead.x ) + bdUp * ( position.y * uBead.y );
// Mitred: slide the ring along the tangent onto the bisecting plane. Both
// neighbours land on the same plane, so the joint is closed and nothing
// sticks out. Open end (start or end of a bead run, a hairpin): a short stub.
float bdAlong = bdMitred ? - dot( bdOff, bdM ) / bdC : ( bdAtEnd ? 0.35 : -0.35 ) * uBead.y;
vec3 transformed = bdLive ? bdCentre + bdOff + bdT * bdAlong : vec3( 0.0 );
`;

const FRAG_PARS = /* glsl */`
uniform vec3 uHighlightColor;
varying float vHighlight;
`;

/**
 * @typedef {object} PreviewResult
 * @property {Float32Array} positions  x,y,z per point, mm, z up, z = top of the bead
 * @property {Uint8Array} kinds        per point: kind of the move ending there (0 = no bead)
 * @property {Uint8Array} issues       per point: ISSUE bits of the bead ending there
 * @property {number} beadWidthMm
 * @property {number} layerHeightMm
 * @property {{ min: number[], max: number[] }} bounds  centreline bounds
 * @property {Float32Array} [profileLine]  r,z pairs
 * @property {Float32Array} [seamLine]     x,y,z per wall layer
 * @property {number} [pointCount]
 */

/**
 * The bead renderer. One WebGL context, transparent background (the page's
 * CSS gradient shows through), z-up world in mm.
 *
 * Extensions beyond ARCHITECTURE.md, for render/handles.js and tests:
 * `canvas`, `onAfterRender(fn)`, `rayFromClient(x, y)`, `worldToCanvas(v)`
 * and `fitCamera({ keepDirection })`.
 */
export class BeadRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this._canvas = canvas;
    this._result = null;
    this._bounds = null;
    this._viewport = null;
    this._size = { width: 1, height: 1 };
    this._everFitted = false;
    this._raf = 0;
    this._lost = false;
    this._disposed = false;
    this._afterRender = new Set();
    this._seamVisible = false;
    this._bed = null;

    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this._renderer.setClearColor(0x000000, 0);
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral keeps whites white; ACES would turn the pot grey-yellow.
    this._renderer.toneMapping = THREE.NeutralToneMapping;
    this._renderer.toneMappingExposure = 1.0;

    this._scene = new THREE.Scene();
    // RoomEnvironment is y-up; turn it so its ceiling lights sit above the pot.
    this._scene.environmentRotation.set(Math.PI / 2, 0, 0);
    this._scene.environmentIntensity = 0.5;
    this._initEnvironment();

    // A gentle key light that follows the camera (placed in _renderWith), so
    // the side you look at is always lit like a studio shot.
    this._key = new THREE.DirectionalLight(0xffffff, 1.3);
    this._scene.add(this._key, this._key.target);

    this._camera = new THREE.PerspectiveCamera(FOV, 1, 1, 5000);
    this._camera.up.copy(UP);   // before OrbitControls reads it
    this._camera.position.set(300, -400, 250);

    this._controls = new OrbitControls(this._camera, canvas);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.12;
    this._controls.minDistance = 20;
    this._controls.maxDistance = 4000;
    this._controls.target.set(0, 0, 60);
    this._controls.addEventListener('change', () => this.requestRender());

    this._uniforms = {
      uBead: { value: new THREE.Vector2(3, 1.5 * HEIGHT_OVERLAP) },
      uHalfPx: { value: new THREE.Vector2(1, 1) },
      uMask: { value: 0 },
      uHighlightColor: { value: new THREE.Color(COLOR_WARNING) },
    };
    this._material = new THREE.MeshStandardMaterial({ color: COLOR_BEAD, roughness: 0.6, metalness: 0 });
    this._material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this._uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
        .replace('#include <beginnormal_vertex>', VERT_NORMAL)
        .replace('#include <begin_vertex>', VERT_POSITION);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );',
          'vec4 diffuseColor = vec4( mix( diffuse, uHighlightColor, vHighlight ), opacity );');
    };
    this._material.customProgramCacheKey = () => 'vc-beads-2';

    this._mesh = new THREE.Mesh(new THREE.InstancedBufferGeometry(), this._material);
    // The template's own bounds mean nothing; the beads are placed in the shader.
    this._mesh.frustumCulled = false;
    this._mesh.visible = false;
    this._scene.add(this._mesh);

    this._shadow = makeContactShadow();
    this._scene.add(this._shadow);
    this._bedGroup = new THREE.Group();
    this._scene.add(this._bedGroup);
    this._seam = new THREE.Line(new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: COLOR_SEAM, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.95, depthWrite: false }));
    this._seam.frustumCulled = false;
    this._seam.visible = false;
    this._scene.add(this._seam);

    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._v = new THREE.Vector3();

    this._frame = this._frame.bind(this);
    this._onDblClick = () => this.fitCamera();
    this._onLost = (e) => {
      e.preventDefault();
      this._lost = true;
      cancelAnimationFrame(this._raf);
      this._raf = 0;
      console.warn('BeadRenderer: WebGL context lost; waiting for it to come back.');
    };
    this._onRestored = () => {
      // three rebuilds its own state first (its listener was added earlier);
      // only the prefiltered environment has no source to re-upload from.
      // The old one belonged to the dead context: drop it, don't dispose it.
      this._lost = false;
      this._envTexture = null;
      this._pmrem = null;
      this._initEnvironment();
      console.info('BeadRenderer: WebGL context restored.');
      this.requestRender();
    };
    canvas.addEventListener('dblclick', this._onDblClick);
    canvas.addEventListener('webglcontextlost', this._onLost);
    canvas.addEventListener('webglcontextrestored', this._onRestored);
    this._resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    this._resizeObserver?.observe(canvas);

    this.resize();
  }

  /** @returns {HTMLCanvasElement} */
  get canvas() { return this._canvas; }
  /** @returns {THREE.PerspectiveCamera} z-up camera; its view offset centres the pot in the viewport region. */
  get camera() { return this._camera; }
  /** @returns {OrbitControls} */
  get controls() { return this._controls; }
  /** @returns {THREE.Scene} */
  get scene() { return this._scene; }

  /**
   * Shows a new toolpath. Takes ownership of the typed arrays. Never moves
   * the camera (D20), except for the very first toolpath.
   * @param {PreviewResult | null} result
   */
  setToolpath(result) {
    const geometry = result ? buildGeometry(result) : null;
    this._mesh.geometry.dispose();
    this._mesh.geometry = geometry || new THREE.InstancedBufferGeometry();
    this._mesh.visible = !!geometry;
    this._result = geometry ? result : null;
    if (geometry) {
      this._setBeadUniform(result);
      this._bounds = outerBounds(result);
      placeShadow(this._shadow, this._bounds);
      this._buildSeam(result);
      if (!this._everFitted) {
        this._everFitted = true;
        this.fitCamera();
      }
    } else {
      this._bounds = null;
      this._shadow.visible = false;
      this._seam.visible = false;
    }
    this.requestRender();
  }

  /**
   * Colours beads whose issue bits match. Uniforms only, so it is instant.
   * @param {number} bitmask 0 turns highlighting off
   * @param {'warning' | 'error' | null} severity
   */
  setHighlight(bitmask, severity) {
    this._uniforms.uMask.value = bitmask | 0;
    this._uniforms.uHighlightColor.value.set(severity === 'error' ? COLOR_ERROR : COLOR_WARNING);
    this.requestRender();
  }

  /**
   * A faint vertical line just outside the wall where each layer's seam sits.
   * @param {boolean} visible
   */
  setSeamMarker(visible) {
    this._seamVisible = !!visible;
    this._seam.visible = this._seamVisible && !!this._result && this._seam.geometry.getAttribute('position') !== undefined;
    this.requestRender();
  }

  /**
   * The printer bed as a faint rectangle centred under the pot.
   * @param {{ widthMm: number, depthMm: number } | null} bed
   */
  setBed(bed) {
    for (const child of [...this._bedGroup.children]) {
      child.geometry.dispose();
      child.material.dispose();
      this._bedGroup.remove(child);
    }
    this._bed = bed && bed.widthMm > 0 && bed.depthMm > 0 ? { widthMm: bed.widthMm, depthMm: bed.depthMm } : null;
    if (this._bed) {
      const w = this._bed.widthMm / 2, d = this._bed.depthMm / 2, z = -0.2;
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(2 * w, 2 * d),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, depthWrite: false, toneMapped: false }));
      fill.position.z = z - 0.05;
      fill.renderOrder = -2;
      const outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-w, -d, z), new THREE.Vector3(w, -d, z), new THREE.Vector3(w, d, z), new THREE.Vector3(-w, d, z),
        ]),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }));
      outline.renderOrder = -2;
      this._bedGroup.add(fill, outline);
    }
    this.requestRender();
  }

  /**
   * The region of the canvas (CSS px) the pot must be centred and fitted in:
   * phone, the top 40 %; desktop, between the sidebar and the right column.
   * Recentres right away; call fitCamera() to also refit the size.
   * @param {{ x: number, y: number, width: number, height: number } | null} viewport
   */
  setViewport(viewport) {
    this._viewport = viewport && viewport.width > 0 && viewport.height > 0 ? { ...viewport } : null;
    this._updateProjection();
    this.requestRender();
  }

  /**
   * Fits the pot into the viewport region. Only on load, double-click and
   * viewport changes (D20): editing never calls it.
   * @param {{ keepDirection?: boolean }} [options] keepDirection keeps the
   *   current orbit angle instead of returning to the default 3/4 view
   */
  fitCamera({ keepDirection = false } = {}) {
    if (!this._bounds) return;
    const dir = keepDirection
      ? this._v.copy(this._camera.position).sub(this._controls.target).normalize().clone()
      : defaultDirection();
    const { width, height } = this._region();
    const fit = fitView(this._bounds, dir, width, height, this._size.height);
    // Let any orbit still damping out finish at once, so it can't carry on
    // past the new view.
    const c = this._controls;
    c.enableDamping = false;
    c.update();
    c.target.copy(fit.target);
    this._camera.position.copy(fit.position);
    this._camera.lookAt(fit.target);
    c.update();
    c.enableDamping = true;
    this.requestRender();
  }

  /** Re-reads the canvas size. Also runs on its own through a ResizeObserver. */
  resize() {
    const width = Math.max(1, this._canvas.clientWidth);
    const height = Math.max(1, this._canvas.clientHeight);
    this._size = { width, height };
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this._renderer.setSize(width, height, false);
    this._updateProjection();
    this.requestRender();
  }

  /** Schedules one frame. Cheap to call often: frames are coalesced. */
  requestRender() {
    if (this._raf || this._lost || this._disposed) return;
    this._raf = requestAnimationFrame(this._frame);
  }

  /**
   * Registers a callback run after every on-screen render (not thumbnails),
   * when the camera matrices are current; handles.js repositions its DOM here.
   * @param {() => void} fn
   * @returns {() => void} unsubscribe
   */
  onAfterRender(fn) {
    this._afterRender.add(fn);
    return () => this._afterRender.delete(fn);
  }

  /**
   * The world-space ray under a client (viewport) pointer position.
   * @param {number} clientX
   * @param {number} clientY
   * @param {THREE.Ray} [out]
   * @returns {THREE.Ray}
   */
  rayFromClient(clientX, clientY, out = new THREE.Ray()) {
    const rect = this._canvas.getBoundingClientRect();
    this._ndc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1);
    this._camera.updateMatrixWorld();
    this._raycaster.setFromCamera(this._ndc, this._camera);
    return out.copy(this._raycaster.ray);
  }

  /**
   * Projects a world point to CSS px relative to the canvas' top-left corner.
   * Uses the camera as of the last render (call inside onAfterRender).
   * @param {THREE.Vector3} v
   * @param {{ x: number, y: number, behind: boolean }} [out]
   */
  worldToCanvas(v, out = { x: 0, y: 0, behind: false }) {
    const p = this._v.copy(v).project(this._camera);
    out.x = (p.x + 1) * 0.5 * this._size.width;
    out.y = (1 - p.y) * 0.5 * this._size.height;
    out.behind = p.z > 1;
    return out;
  }

  /**
   * A white bead render of the current or a given toolpath, from a fixed 3/4
   * view on a transparent background. Leaves the main view untouched.
   * @param {PreviewResult} [result] defaults to the current toolpath; not taken over
   * @param {number} [size]
   * @returns {Promise<Blob>} image/webp where supported, otherwise image/png
   */
  async thumbnail(result = this._result, size = 192) {
    if (!result) throw new Error('BeadRenderer.thumbnail: no toolpath');
    if (this._lost) throw new Error('BeadRenderer.thumbnail: WebGL context lost');
    size = Math.max(16, Math.round(size));
    const own = result === this._result ? null : buildGeometry(result);
    if (result !== this._result && !own) throw new Error('BeadRenderer.thumbnail: empty toolpath');
    try {
      return await this._thumbnailWith(result, own, size);
    } finally {
      own?.dispose();
    }
  }

  async _thumbnailWith(result, own, size) {
    const bounds = outerBounds(result);

    const r = this._renderer;
    // Layers are about a pixel tall at thumbnail size; rendering at twice the
    // size and averaging down avoids moire in the layer lines.
    const big = size * THUMB_SUPERSAMPLE;
    this._ensureThumbTargets(big);
    const cam = this._thumbCamera ||= new THREE.PerspectiveCamera(30, 1, 1, 5000);
    cam.up.copy(UP);
    cam.fov = 30;
    cam.aspect = 1;
    const fit = fitView(bounds, defaultDirection(), size, size, size, 30, 0.9);
    cam.position.copy(fit.position);
    cam.lookAt(fit.target);
    setClipping(cam, fit.position.distanceTo(fit.target), bounds);
    cam.updateProjectionMatrix();

    // Swap in the thumbnail's state, render, and put everything back before
    // anything else can draw.
    const saved = {
      geometry: this._mesh.geometry, visible: this._mesh.visible, bead: this._uniforms.uBead.value.clone(),
      halfPx: this._uniforms.uHalfPx.value.clone(), mask: this._uniforms.uMask.value, seam: this._seam.visible, bed: this._bedGroup.visible,
      shadow: { visible: this._shadow.visible, position: this._shadow.position.clone(), scale: this._shadow.scale.clone() },
      target: r.getRenderTarget(),
    };
    try {
      if (own) this._mesh.geometry = own;
      this._mesh.visible = true;
      this._setBeadUniform(result);
      this._uniforms.uMask.value = 0;
      // Level of detail by the pixels of the final, averaged-down image.
      this._uniforms.uHalfPx.value.set(size / 2, size / 2);
      this._seam.visible = false;
      this._bedGroup.visible = false;
      placeShadow(this._shadow, bounds);
      r.setRenderTarget(this._thumbHdr);
      r.clear();
      this._renderWith(cam, fit.target);
      this._outputPass.render(r, this._thumbOut, this._thumbHdr);
    } finally {
      this._mesh.geometry = saved.geometry;
      this._mesh.visible = saved.visible;
      this._uniforms.uBead.value.copy(saved.bead);
      this._uniforms.uHalfPx.value.copy(saved.halfPx);
      this._uniforms.uMask.value = saved.mask;
      this._seam.visible = saved.seam;
      this._bedGroup.visible = saved.bed;
      this._shadow.visible = saved.shadow.visible;
      this._shadow.position.copy(saved.shadow.position);
      this._shadow.scale.copy(saved.shadow.scale);
      r.setRenderTarget(saved.target);
    }

    const pixels = new Uint8Array(big * big * 4);
    if (r.readRenderTargetPixelsAsync) await r.readRenderTargetPixelsAsync(this._thumbOut, 0, 0, big, big, pixels);
    else r.readRenderTargetPixels(this._thumbOut, 0, 0, big, big, pixels);
    return pixelsToBlob(pixels, size, THUMB_SUPERSAMPLE);
  }

  /** Releases the GPU resources and listeners. The canvas stays. */
  dispose() {
    this._disposed = true;
    cancelAnimationFrame(this._raf);
    this._resizeObserver?.disconnect();
    this._canvas.removeEventListener('dblclick', this._onDblClick);
    this._canvas.removeEventListener('webglcontextlost', this._onLost);
    this._canvas.removeEventListener('webglcontextrestored', this._onRestored);
    this._controls.dispose();
    this._afterRender.clear();
    this.setBed(null);
    this._mesh.geometry.dispose();
    this._material.dispose();
    this._shadow.geometry.dispose();
    this._shadow.material.map.dispose();
    this._shadow.material.dispose();
    this._seam.geometry.dispose();
    this._seam.material.dispose();
    this._envTexture?.dispose();
    this._pmrem?.dispose();
    this._thumbHdr?.dispose();
    this._thumbOut?.dispose();
    this._outputPass?.dispose();
    this._renderer.dispose();
  }

  // ---------------------------------------------------------------- internals

  _frame() {
    this._raf = 0;
    if (this._lost || this._disposed) return;
    // With damping, update() keeps reporting motion until the orbit settles.
    const moving = this._controls.update();
    this._renderNow();
    if (moving) this.requestRender();
  }

  /** Renders the main view immediately (tests and timing use this too). */
  _renderNow() {
    if (this._lost) return;
    setClipping(this._camera, this._camera.position.distanceTo(this._controls.target), this._bounds, this._bed);
    this._camera.updateProjectionMatrix();
    this._renderer.setRenderTarget(null);
    this._renderer.getDrawingBufferSize(this._uniforms.uHalfPx.value).multiplyScalar(0.5);
    this._renderWith(this._camera, this._controls.target);
    for (const fn of this._afterRender) {
      try { fn(); } catch (err) { console.error(err); }
    }
  }

  _renderWith(camera, lookAt) {
    camera.updateMatrixWorld();
    // Key light from above and to the left of the camera.
    const right = this._v.setFromMatrixColumn(camera.matrixWorld, 0);
    const target = this._key.target.position.copy(lookAt);
    this._key.position.copy(camera.position).sub(target).normalize()
      .addScaledVector(right, -0.55).addScaledVector(UP, 0.9).normalize()
      .multiplyScalar(1000).add(target);
    this._key.target.updateMatrixWorld();
    this._renderer.render(this._scene, camera);
  }

  _setBeadUniform(result) {
    const w = result.beadWidthMm > 0 ? result.beadWidthMm : 3;
    const h = result.layerHeightMm > 0 ? result.layerHeightMm : 1.5;
    this._uniforms.uBead.value.set(w, h * HEIGHT_OVERLAP);
  }

  _region() {
    const { width, height } = this._size;
    const v = this._viewport;
    if (!v) return { x: 0, y: 0, width, height };
    const x = THREE.MathUtils.clamp(v.x, 0, width - 1);
    const y = THREE.MathUtils.clamp(v.y, 0, height - 1);
    return { x, y, width: Math.max(1, Math.min(v.width, width - x)), height: Math.max(1, Math.min(v.height, height - y)) };
  }

  /**
   * Moves the projection centre to the middle of the viewport region with a
   * view offset: the canvas is a window into a larger virtual image whose
   * centre is the region's centre. The pixel scale stays that of FOV over the
   * canvas height, whatever the region.
   */
  _updateProjection() {
    const { width: W, height: H } = this._size;
    const reg = this._region();
    const cx = reg.x + reg.width / 2, cy = reg.y + reg.height / 2;
    const fullW = 2 * Math.max(cx, W - cx), fullH = 2 * Math.max(cy, H - cy);
    const cam = this._camera;
    cam.aspect = fullW / fullH;
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * fullH / H));
    cam.setViewOffset(fullW, fullH, fullW / 2 - cx, fullH / 2 - cy, W, H);
    cam.updateProjectionMatrix();
    // OrbitControls pans by fov over the element height; undo the wider fov.
    this._controls.panSpeed = H / fullH;
  }

  _buildSeam(result) {
    const seam = result.seamLine;
    const old = this._seam.geometry;
    this._seam.geometry = new THREE.BufferGeometry();
    old.dispose();
    if (!seam || seam.length < 6) {
      this._seam.visible = false;
      return;
    }
    const w = this._uniforms.uBead.value.x;
    const h = result.layerHeightMm > 0 ? result.layerHeightMm : 1.5;
    const out = new Float32Array(seam.length);
    // One point per layer (~100), so a JS loop is fine here.
    for (let i = 0; i < seam.length; i += 3) {
      const x = seam[i], y = seam[i + 1];
      const len = Math.hypot(x, y) || 1;
      const push = w / 2 + 0.8;
      out[i] = x + (x / len) * push;
      out[i + 1] = y + (y / len) * push;
      out[i + 2] = seam[i + 2] - h / 2;
    }
    this._seam.geometry.setAttribute('position', new THREE.BufferAttribute(out, 3));
    this._seam.computeLineDistances();
    this._seam.visible = this._seamVisible;
  }

  _initEnvironment() {
    this._envTexture?.dispose();
    this._pmrem?.dispose();
    this._pmrem = new THREE.PMREMGenerator(this._renderer);
    const room = new RoomEnvironment();
    this._envTexture = this._pmrem.fromScene(room, 0.04).texture;
    room.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    this._scene.environment = this._envTexture;
  }

  _ensureThumbTargets(size) {
    if (this._thumbHdr && this._thumbHdr.width === size) return;
    this._thumbHdr?.dispose();
    this._thumbOut?.dispose();
    // Render linear HDR with MSAA, then tone map and encode sRGB in a second
    // pass: three only applies those when drawing to the screen.
    this._thumbHdr = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, samples: 4 });
    this._thumbOut = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType });
    this._outputPass ||= new OutputPass();
  }
}

// ------------------------------------------------------------------ helpers

/**
 * Two rings of a unit superellipse cross-section (x along the side, y up,
 * z = ring 0 at the segment start, 1 at its end), smooth normals, and flat
 * caps that close the open ends of a bead run (mitred joints hide them).
 */
function templateData() {
  const pos = new Float32Array(2 * SIDES * 3);
  const nrm = new Float32Array(2 * SIDES * 3);
  const e = 2 / SHAPE_EXP, f = 2 * (SHAPE_EXP - 1) / SHAPE_EXP;
  const spow = (v, p) => Math.sign(v) * Math.abs(v) ** p;
  for (let ring = 0; ring < 2; ring++) {
    for (let k = 0; k < SIDES; k++) {
      const a = (2 * Math.PI * k) / SIDES;
      const c = Math.cos(a), s = Math.sin(a);
      const o = (ring * SIDES + k) * 3;
      pos[o] = 0.5 * spow(c, e);
      pos[o + 1] = 0.5 * spow(s, e);
      pos[o + 2] = ring;
      // Gradient of |2x|^n + |2y|^n, which is the outward normal.
      const nx = spow(c, f), ny = spow(s, f), nl = Math.hypot(nx, ny) || 1;
      nrm[o] = nx / nl;
      nrm[o + 1] = ny / nl;
    }
  }
  const idx = [];
  for (let k = 0; k < SIDES; k++) {
    const a0 = k, b0 = (k + 1) % SIDES, a1 = a0 + SIDES, b1 = b0 + SIDES;
    idx.push(a0, b1, b0, a0, a1, b1);
  }
  for (let k = 1; k < SIDES - 1; k++) {
    idx.push(0, k, k + 1);                                // start cap faces back
    idx.push(SIDES, SIDES + k + 1, SIDES + k);            // end cap faces forward
  }
  return { position: pos, normal: nrm, index: new Uint16Array(idx) };
}

let templateArrays = null;

/**
 * Instanced geometry over a toolpath. Two memcpy-style copies pad the arrays
 * by one point at each end so every segment can read both neighbours; there
 * is no per-segment JavaScript.
 * @param {PreviewResult} result
 * @returns {THREE.InstancedBufferGeometry | null}
 */
function buildGeometry(result) {
  const positions = result?.positions;
  const n = positions ? Math.floor(positions.length / 3) : 0;
  if (n < 2) return null;
  templateArrays ||= templateData();
  const pos = new Float32Array(3 * (n + 2));
  pos.set(positions.subarray(0, 3), 0);
  pos.set(positions.subarray(0, 3 * n), 3);
  pos.set(positions.subarray(3 * n - 3, 3 * n), 3 * (n + 1));
  const kinds = new Uint8Array(n + 2);
  if (result.kinds) kinds.set(result.kinds.subarray(0, n), 1);
  else kinds.fill(1, 2, n + 1);
  const issues = result.issues && result.issues.length >= n ? result.issues : new Uint8Array(n);

  const g = new THREE.InstancedBufferGeometry();
  // Own attribute objects per geometry (over shared arrays): disposing one
  // geometry deletes its GL buffers, and a shared attribute would leave the
  // other geometry's vertex array pointing at a deleted buffer.
  g.setIndex(new THREE.BufferAttribute(templateArrays.index, 1));
  g.setAttribute('position', new THREE.BufferAttribute(templateArrays.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(templateArrays.normal, 3));
  const pBuf = new THREE.InstancedInterleavedBuffer(pos, 3, 1);
  g.setAttribute('aPrev', new THREE.InterleavedBufferAttribute(pBuf, 3, 0));
  g.setAttribute('aStart', new THREE.InterleavedBufferAttribute(pBuf, 3, 3));
  g.setAttribute('aEnd', new THREE.InterleavedBufferAttribute(pBuf, 3, 6));
  g.setAttribute('aNext', new THREE.InterleavedBufferAttribute(pBuf, 3, 9));
  // Overlapping reads (stride 1, three components) give each segment the
  // kinds of its previous, own and next move from one byte array.
  const kBuf = new THREE.InstancedInterleavedBuffer(kinds, 1, 1);
  g.setAttribute('aKinds', new THREE.InterleavedBufferAttribute(kBuf, 3, 1));
  const iBuf = new THREE.InstancedInterleavedBuffer(issues, 1, 1);
  g.setAttribute('aIssue', new THREE.InterleavedBufferAttribute(iBuf, 1, 1));
  g.instanceCount = n - 1;
  return g;
}

/** The centreline bounds grown by half a bead: roughly the outer surface. */
function outerBounds(result) {
  const w = result.beadWidthMm > 0 ? result.beadWidthMm : 3;
  let min = result.bounds?.min, max = result.bounds?.max;
  if (!min || !max) {
    // No bounds given (should not happen): scan once rather than fail.
    const p = result.positions;
    min = [Infinity, Infinity, Infinity];
    max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        if (p[i + a] < min[a]) min[a] = p[i + a];
        if (p[i + a] > max[a]) max[a] = p[i + a];
      }
    }
  }
  return {
    min: new THREE.Vector3(min[0] - w / 2, min[1] - w / 2, 0),
    max: new THREE.Vector3(max[0] + w / 2, max[1] + w / 2, Math.max(max[2], 1)),
  };
}

function defaultDirection() {
  const c = Math.cos(DEFAULT_ELEVATION);
  return new THREE.Vector3(Math.sin(DEFAULT_AZIMUTH) * c, -Math.cos(DEFAULT_AZIMUTH) * c, Math.sin(DEFAULT_ELEVATION));
}

/**
 * Camera distance that fits the pot (sampled as its bounding elliptic
 * cylinder) into a region of the given size, looking along -dir.
 * @param {{ min: THREE.Vector3, max: THREE.Vector3 }} b
 * @param {THREE.Vector3} dir unit vector from the target towards the camera
 * @param {number} regionW region size, px
 * @param {number} regionH
 * @param {number} canvasH the height the fov spans, px
 */
function fitView(b, dir, regionW, regionH, canvasH, fov = FOV, margin = FIT_MARGIN) {
  const target = new THREE.Vector3().addVectors(b.min, b.max).multiplyScalar(0.5);
  const ex = (b.max.x - b.min.x) / 2, ey = (b.max.y - b.min.y) / 2;
  const fwd = dir.clone().negate();
  let right = new THREE.Vector3().crossVectors(fwd, UP);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const focal = (canvasH / 2) / Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const hw = (regionW / 2) * margin, hh = (regionH / 2) * margin;
  const q = new THREE.Vector3();
  let dist = 1;
  for (let i = 0; i < 32; i++) {
    const a = (2 * Math.PI * i) / 32;
    for (const z of [b.min.z, b.max.z]) {
      q.set(target.x + ex * Math.cos(a), target.y + ey * Math.sin(a), z).sub(target);
      const toward = q.dot(dir);
      dist = Math.max(dist, toward + (focal * Math.abs(q.dot(right))) / hw, toward + (focal * Math.abs(q.dot(up))) / hh);
    }
  }
  return { target, position: target.clone().addScaledVector(dir, dist) };
}

/** Tight near/far planes around the scene keep the depth buffer precise at any zoom. */
function setClipping(camera, dist, bounds, bed) {
  let radius = 200;
  if (bounds) radius = bounds.max.distanceTo(bounds.min) / 2 + 10;
  if (bed) radius = Math.max(radius, Math.hypot(bed.widthMm, bed.depthMm) / 2 + 10);
  camera.near = Math.max(0.5, dist - 2 * radius, dist * 0.01);
  camera.far = dist + 2 * radius;
}

/** A soft radial shadow under the pot: a transparent plane, no shadow maps. */
function makeContactShadow() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(10,30,30,0.42)');
  g.addColorStop(0.38, 'rgba(10,30,30,0.30)');
  g.addColorStop(0.62, 'rgba(10,30,30,0.10)');
  g.addColorStop(1, 'rgba(10,30,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  mesh.renderOrder = -1;
  mesh.visible = false;
  return mesh;
}

function placeShadow(shadow, b) {
  const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2;
  shadow.position.set(cx, cy, -0.1);
  shadow.scale.set((b.max.x - b.min.x) * 1.7, (b.max.y - b.min.y) * 1.7, 1);
  shadow.visible = true;
}

/**
 * RGBA rows from WebGL (bottom-up, premultiplied, ss times the size) to an
 * image Blob: box-filtered down, flipped, and un-premultiplied.
 */
async function pixelsToBlob(pixels, size, ss = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const big = size * ss, n = ss * ss;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < ss; j++) {
        // WebGL rows run bottom-up.
        let o = ((big - 1 - (y * ss + j)) * big + x * ss) * 4;
        for (let i = 0; i < ss; i++, o += 4) {
          r += pixels[o]; g += pixels[o + 1]; b += pixels[o + 2]; a += pixels[o + 3];
        }
      }
      const d = (y * size + x) * 4;
      const k = a > 0 ? 255 / a : 0;
      img.data[d] = Math.min(255, r * k);
      img.data[d + 1] = Math.min(255, g * k);
      img.data[d + 2] = Math.min(255, b * k);
      img.data[d + 3] = a / n;
    }
  }
  ctx.putImageData(img, 0, 0);
  const toBlob = (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await toBlob('image/webp', 0.9);
  if (webp && webp.type === 'image/webp') return webp;
  return (await toBlob('image/png')) || webp;
}
