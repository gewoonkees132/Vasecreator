// The bead renderer: draws the pot exactly as the nozzle lays it, one bead
// per path segment (design §9.7, research §8.2).
//
// Vertex pulling: the GPU reads the toolpath straight from the positions
// array. Each segment (point i → i+1) is one instance of a small template: a
// few rings of a rounded cross-section along the segment, plus flat caps. The
// vertex shader lays the rings on a smooth curve through the segment and its
// two neighbours (a centripetal Catmull-Rom spline), so a bead flows through
// the toolpath points the way soft clay does instead of turning sharp
// corners. Neighbouring segments agree on the curve's direction at the point
// they share, so their end rings coincide and beads join without gaps,
// bulges or creases. Segments that carry no bead collapse. setToolpath()
// therefore does no per-segment work in JavaScript at all.
//
// Shading: a studio light rig (a soft key light raking in from the upper
// left, a weak fill, a rim light and a dim environment) that turns with the
// view like a turntable in a photo studio, so the relief always reads. The
// fragment shader darkens the grooves between layers and the inside of tight
// turns (an analytic ambient occlusion: the cross-section and the curve's
// bend say where neighbouring clay hides the light), which costs nothing per
// toolpath change.
//
// Rendering is on demand only (research §9.2): on camera moves (while damping
// settles), new toolpaths, highlight and marker changes, and resizes.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PAINT_AROUND, PAINT_UP, PAINT_SIZE } from '../core/paint.js';

/**
 * Geometry level of detail: sides around the bead cross-section and ring
 * steps along each segment. One bead is 2·sides·steps + 2·(sides − 2)
 * triangles. The richest detail that keeps the whole pot within the triangle
 * budget is used: phones and tablets (coarse pointer or a small screen) get
 * a smaller budget. With one step a bead is straight and mitred at the
 * joints (the curve still sets the joint's direction); with more it follows
 * the curve. Beads that many are only a few pixels tall, where the shading
 * LOD below has already flattened most of their relief. Coarser rings are
 * scaled to the full one's width and height, so layers still overlap and the
 * pot keeps its size. Display only: the toolpath and the G-code don't change.
 */
const DETAILS = [
  { sides: 12, steps: 10 },
  { sides: 10, steps: 6 },
  { sides: 10, steps: 4 },
  { sides: 10, steps: 3 },
  { sides: 8, steps: 2 },
  { sides: 6, steps: 2 },
  { sides: 6, steps: 1 },
];
const FULL_SIDES = 10;
const TRIANGLE_BUDGET_COMPACT = 1.8e6;
const TRIANGLE_BUDGET_ANY = 6e6;
/** Thumbnails are a few hundred pixels: a modest template is plenty. */
const THUMB_DETAIL = DETAILS[2];
/** Once switched down, switch back up only when the count drops this far below the limit, so a drag near it doesn't flicker. */
const LOD_HYSTERESIS = 0.9;
/** Superellipse exponent of the cross-section: 2 is an ellipse, higher is a flatter, squarer (squashed clay) bead. */
const SHAPE_EXP = 2.2;
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

/** A matte, slightly warm white, like bisque-fired clay. */
const COLOR_BEAD = '#f3f0ea';
const COLOR_WARNING = '#e0a100';
const COLOR_ERROR = '#d64545';
// Dashed and lighter than the solid profile line, so the two never read as one (C13).
const COLOR_SEAM = 'rgb(93,138,139)';
/** The paint's wash over the beads where the Pattern is taken away, and the brush's ring (D87). */
const COLOR_PAINT_TINT = 'rgb(18,47,45)';
const COLOR_PAINT_RING = 'rgb(38,120,210)';
/** How far the wall surface lies outside the plain wall's beads, mm. */
const WALL_CLEARANCE = 0.3;
/** How much nearer than the Pattern's reach the wall surface is drawn, mm, so the beads never cut into the wash. */
const WALL_DEPTH_SLACK = 2;

// The wall surface (paint and brush mark): clear where the overlay is white,
// darker the blacker it is, and fainter outside the Pattern's range, where
// the paint is kept but has nothing to act on. It lies on the plain wall's
// outer face, so it keeps the pot's outline, and is drawn uBias mm nearer in
// depth only, so the Pattern's raised beads don't poke through the wash.
const WALL_VERT = /* glsl */`
uniform float uBias;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vec4 nearer = projectionMatrix * vec4(mv.xy, mv.z + uBias, 1.0);
  gl_Position.z = nearer.z / nearer.w * gl_Position.w;
}`;
const WALL_FRAG = /* glsl */`
uniform sampler2D uPaint;
uniform vec2 uRange;
uniform vec3 uTint;
uniform vec3 uRing;
uniform vec4 uBrush;
uniform float uBand;
varying vec2 vUv;
void main() {
  float paint = texture2D(uPaint, vUv).r;
  float inRange = step(uRange.x, vUv.y) * step(vUv.y, uRange.y);
  float alpha = (1.0 - paint) * mix(0.16, 0.42, inRange);
  vec3 color = uTint;
  if (uBrush.z > 0.0) {
    float du = fract(vUv.x - uBrush.x + 0.5) - 0.5;
    float dv = (vUv.y - uBrush.y) / uBrush.w;
    float d = uBand > 0.5 ? abs(dv) : length(vec2(du / uBrush.z, dv));
    float w = max(fwidth(d) * 1.5, 1e-4);
    float ring = 1.0 - smoothstep(0.0, w, abs(d - 1.0));
    color = mix(color, uRing, ring);
    alpha = max(alpha, ring * 0.95);
  }
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(color, alpha);
}`;

/**
 * The light rig, by angle around the pot from the camera (degrees, positive
 * towards the camera's right) and height above the horizon. The key rakes
 * across the surface from the upper left, so ribs and layers cast soft
 * shading; the fill keeps the shadow side from going black; the rim light
 * from behind separates the silhouette from the background.
 */
const LIGHTS = [
  { name: 'key', color: 0xfffaf3, intensity: 3.0, azimuth: -60, elevation: 35 },
  { name: 'fill', color: 0xe8eef5, intensity: 0.3, azimuth: 70, elevation: 10 },
  { name: 'rim', color: 0xffffff, intensity: 0.6, azimuth: 150, elevation: 35 },
];
const ENVIRONMENT_INTENSITY = 0.24;

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
uniform float uMitre;    // 1: one ring step, straight beads mitred at the joints
uniform float uTopZ;     // the top of the highest bead (mm)
varying float vHighlight;
varying vec2 vBdN;       // cross-section normal: x across, y along the stacking direction
varying float vBdCav;    // how far the bead bends towards this side, 1 = folds over
varying vec2 vBdOcc;     // groove occlusion weight below, above (the top layer has none above)
// Horizontal normal of a direction; a vertical move has none, so any
// horizontal side will do.
vec3 bdSideOf( vec3 t ) {
  vec3 s = cross( t, vec3( 0.0, 0.0, 1.0 ) );
  float l = length( s );
  return l > 1e-4 ? s / l : vec3( 1.0, 0.0, 0.0 );
}
// Centripetal Catmull-Rom from p1 to p2 (t in 0..1) as a cubic Hermite:
// position and velocity. Centripetal knots never overshoot or loop, even
// next to a much shorter or longer segment.
void bdCurve( vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t, out vec3 pos, out vec3 vel ) {
  float d0 = sqrt( max( length( p1 - p0 ), 1e-6 ) );
  float d1 = sqrt( max( length( p2 - p1 ), 1e-6 ) );
  float d2 = sqrt( max( length( p3 - p2 ), 1e-6 ) );
  vec3 m1 = ( ( p1 - p0 ) / d0 - ( p2 - p0 ) / ( d0 + d1 ) + ( p2 - p1 ) / d1 ) * d1;
  vec3 m2 = ( ( p2 - p1 ) / d1 - ( p3 - p1 ) / ( d1 + d2 ) + ( p3 - p2 ) / d2 ) * d1;
  float t2 = t * t, t3 = t2 * t;
  pos = ( 2.0 * t3 - 3.0 * t2 + 1.0 ) * p1 + ( t3 - 2.0 * t2 + t ) * m1 + ( 3.0 * t2 - 2.0 * t3 ) * p2 + ( t3 - t2 ) * m2;
  vel = ( 6.0 * t2 - 6.0 * t ) * ( p1 - p2 ) + ( 3.0 * t2 - 4.0 * t + 1.0 ) * m1 + ( 3.0 * t2 - 2.0 * t ) * m2;
}
// The bend at p1: towards the centre of the circle through p0, p1 and p2,
// 1 / radius long. Both segments meeting at p1 work it out alike, so the
// shading that uses it has no step there (the curve's own bend does).
vec3 bdBend( vec3 p0, vec3 p1, vec3 p2 ) {
  vec3 a = p0 - p1, b = p2 - p1, n = cross( a, b );
  float nn = dot( n, n );
  if ( nn < 1e-10 ) return vec3( 0.0 );
  vec3 c = cross( dot( a, a ) * b - dot( b, b ) * a, n ) / ( 2.0 * nn );
  return c / max( dot( c, c ), 1e-6 );
}
`;

// beginnormal_vertex runs before begin_vertex, so the whole frame is built
// here and reused for the position below.
const VERT_NORMAL = /* glsl */`
vec3 bdDir = aEnd - aStart;
float bdLen = length( bdDir );
bool bdLive = aKinds.y > 0.5 && bdLen > 1e-5;
vec3 bdT = bdLive ? bdDir / bdLen : vec3( 1.0, 0.0, 0.0 );
// Join a neighbour only if it carries a bead and doesn't turn back on
// itself; hairpins get open ends. Both segments at a joint decide alike. A
// curved bead rounds even a sharp zigzag into a smooth bump (the fold on the
// inside of the turn stays hidden in the clay, as with a round nozzle); a
// mitre would stick out past 120 degrees.
vec3 bdA = aStart - aPrev;
vec3 bdB = aNext - aEnd;
float bdLa = length( bdA ), bdLb = length( bdB );
float bdTurn = uMitre > 0.5 ? -0.5 : -0.97;
bool bdJoinS = aKinds.x > 0.5 && bdLa > 1e-5 && dot( bdA, bdT ) > bdTurn * bdLa;
bool bdJoinE = aKinds.z > 0.5 && bdLb > 1e-5 && dot( bdB, bdT ) > bdTurn * bdLb;
// An open end carries straight on, so the curve leaves it along the segment.
vec3 bdP0 = bdJoinS ? aPrev : aStart - bdDir;
vec3 bdP3 = bdJoinE ? aNext : aEnd + bdDir;
vec3 bdPos, bdVel;
bdCurve( bdP0, aStart, aEnd, bdP3, position.z, bdPos, bdVel );
float bdV2 = dot( bdVel, bdVel );
vec3 bdTan = bdV2 > 1e-12 ? bdVel * inversesqrt( bdV2 ) : bdT;
vec3 bdKappa = mix( bdBend( bdP0, aStart, aEnd ), bdBend( aStart, aEnd, bdP3 ), position.z );
bool bdAtStart = position.z < 0.001;
bool bdAtEnd = position.z > 0.999;
bool bdOpen = ( bdAtStart && !bdJoinS ) || ( bdAtEnd && !bdJoinE );
// Rings stand square to the curve. One step: square to the segment, and slid
// onto the plane square to the curve at the joint (a mitre), so both
// neighbours land on the same ring there.
bool bdMitred = uMitre > 0.5 && !bdOpen && ( bdAtStart || bdAtEnd );
vec3 bdF = uMitre > 0.5 ? bdT : bdTan;
vec3 bdSide = bdSideOf( bdF );
vec3 bdUp = cross( bdSide, bdF );
// Shade with the curve's own frame: both neighbours agree on it at a joint,
// so the joints don't show as stripes.
vec3 bdNSide = bdSideOf( bdTan );
vec3 bdNUp = cross( bdNSide, bdTan );
// z is the top of the bead, so its centre is half a layer lower.
float bdLayer = uBead.y / ${HEIGHT_OVERLAP.toFixed(3)};
vec3 bdCentre = bdPos - vec3( 0.0, 0.0, 0.5 * bdLayer );
// Level of detail: how many pixels apart this bead and its neighbours land
// on screen. Wall beads stack a layer apart; base beads lie side by side.
bool bdBase = abs( aKinds.y - 3.0 ) < 0.5;
float bdPitch = bdBase ? uBead.x : bdLayer;
vec3 bdStep = ( bdBase ? bdNSide : bdNUp ) * bdPitch;
vec4 bdClip = projectionMatrix * modelViewMatrix * vec4( bdCentre, 1.0 );
vec4 bdDClip = projectionMatrix * modelViewMatrix * vec4( bdStep, 0.0 );
float bdW = max( bdClip.w, 1e-3 );
float bdPx = length( ( bdDClip.xy * bdW - bdClip.xy * bdDClip.w ) / ( bdW * bdW ) * uHalfPx );
// Seen from above, the layers of a flared wall spread sideways more than up.
// Allow for a flare of up to about 45 degrees, so bowls and flared rims seen
// from above keep their relief.
if ( !bdBase ) bdPx = max( bdPx, bdPitch * abs( normalize( cameraPosition - bdCentre ).z ) * projectionMatrix[1][1] * uHalfPx.y / bdW );
float bdFine = smoothstep( ${LOD_FLAT_PX.toFixed(3)}, ${LOD_FULL_PX.toFixed(3)}, bdPx );
float bdDetail = mix( ${LOD_HINT.toFixed(3)}, 1.0, bdFine );
// The template normal belongs to a unit shape; scaling it to width x height
// needs the inverse-transpose, i.e. a divide. Easing the relief off is the
// same as shading a bead stretched along the stacking direction: walls lose
// their up/down tilt, base beads their sideways one.
vec2 bdTrue = normalize( normal.xy / uBead );
vec2 bdN = normalize( normal.xy * ( bdBase
  ? vec2( bdDetail / uBead.x, 1.0 / uBead.y )
  : vec2( 1.0 / uBead.x, bdDetail / uBead.y ) ) );
vec3 objectNormal = bdNSide * bdN.x + bdNUp * bdN.y;
// Ambient occlusion terms, eased off with the relief. Neighbouring layers
// (base: neighbouring rings) hide the light from the bead's top and bottom;
// nothing lies on the top layer.
vBdN = bdBase ? bdTrue.yx : bdTrue;
bool bdTop = !bdBase && bdCentre.z > uTopZ - 1.02 * bdLayer;
vBdOcc = vec2( 1.0, bdTop ? 0.0 : 1.0 ) * bdFine;
// On the inside of a turn, the bead's own clay hides the light.
vBdCav = dot( bdKappa, bdNSide * ( position.x * uBead.x ) + bdNUp * ( position.y * uBead.y ) ) * bdFine;
vHighlight = ( uMask != 0 && ( int( aIssue + 0.5 ) & uMask ) != 0 ) ? 1.0 : 0.0;
`;

const VERT_POSITION = /* glsl */`
vec3 bdOff = bdSide * ( position.x * uBead.x ) + bdUp * ( position.y * uBead.y );
// Mitred: slide the ring along the segment onto the plane square to the
// curve. Open end (start or end of a bead run, a hairpin): a short stub.
float bdC = max( dot( bdT, bdTan ), 0.5 );
float bdAlong = bdMitred ? - dot( bdOff, bdTan ) / bdC : bdOpen ? ( bdAtEnd ? 0.35 : -0.35 ) * uBead.y : 0.0;
vec3 transformed = bdLive ? bdCentre + bdOff + bdF * bdAlong : vec3( 0.0 );
`;

const FRAG_PARS = /* glsl */`
uniform vec3 uHighlightColor;
varying float vHighlight;
varying vec2 vBdN;
varying float vBdCav;
varying vec2 vBdOcc;
`;

// After three's lights: scale the light by the occlusion. Indirect light is
// hidden fully, direct light (which has no shadow map) partly.
const FRAG_OCCLUSION = /* glsl */`
#include <aomap_fragment>
{
  vec2 bdN = vBdN / max( length( vBdN ), 1e-4 );
  float bdGroove = smoothstep( 0.6, 1.0, abs( bdN.y ) ) * ( bdN.y > 0.0 ? vBdOcc.y : vBdOcc.x );
  float bdCav = smoothstep( 0.0, 1.0, vBdCav );
  float bdAO = ( 1.0 - 0.4 * bdGroove ) * ( 1.0 - 0.5 * bdCav );
  reflectedLight.indirectDiffuse *= bdAO;
  reflectedLight.indirectSpecular *= bdAO;
  reflectedLight.directDiffuse *= mix( 1.0, bdAO, 0.4 );
  reflectedLight.directSpecular *= bdAO;
}
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
    this._detail = DETAILS[0];

    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this._renderer.setClearColor(0x000000, 0);
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral keeps whites white; ACES would turn the pot grey-yellow.
    this._renderer.toneMapping = THREE.NeutralToneMapping;
    this._renderer.toneMappingExposure = 1.0;

    this._scene = new THREE.Scene();
    // RoomEnvironment is y-up; turn it so its ceiling lights sit above the pot.
    this._scene.environmentRotation.set(Math.PI / 2, 0, 0);
    this._scene.environmentIntensity = ENVIRONMENT_INTENSITY;
    this._initEnvironment();

    // The studio lights turn with the view (placed in _renderWith), like a
    // pot on a turntable: whichever side you look at is lit the same way.
    this._lights = LIGHTS.map((spec) => {
      const light = new THREE.DirectionalLight(spec.color, spec.intensity);
      light.name = spec.name;
      this._scene.add(light, light.target);
      return { light, spec };
    });

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
      uMitre: { value: 0 },
      uTopZ: { value: 1e9 },
      uHighlightColor: { value: new THREE.Color(COLOR_WARNING) },
    };
    this._material = new THREE.MeshStandardMaterial({ color: COLOR_BEAD, roughness: 0.82, metalness: 0 });
    this._material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this._uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
        .replace('#include <beginnormal_vertex>', VERT_NORMAL)
        .replace('#include <begin_vertex>', VERT_POSITION);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );',
          'vec4 diffuseColor = vec4( mix( diffuse, uHighlightColor, vHighlight ), opacity );')
        .replace('#include <aomap_fragment>', FRAG_OCCLUSION);
    };
    this._material.customProgramCacheKey = () => 'vc-beads-3';

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

    // The plain wall as a surface just outside the beads (result.wallGrid):
    // unseen, it is what a pointer hits when painting (pickWall); in Paint
    // mode it shows the paint as a dark wash and the brush as a ring (D86, D87).
    this._paintData = new Uint8Array(PAINT_SIZE).fill(255);
    this._paintTexture = new THREE.DataTexture(this._paintData, PAINT_AROUND, PAINT_UP, THREE.RedFormat, THREE.UnsignedByteType);
    this._paintTexture.wrapS = THREE.RepeatWrapping;
    this._paintTexture.wrapT = THREE.ClampToEdgeWrapping;
    this._paintTexture.magFilter = this._paintTexture.minFilter = THREE.LinearFilter;
    this._paintTexture.needsUpdate = true;
    this._wallUniforms = {
      uPaint: { value: this._paintTexture },
      uRange: { value: new THREE.Vector2(0, 1) },
      uTint: { value: new THREE.Color(COLOR_PAINT_TINT) },
      uRing: { value: new THREE.Color(COLOR_PAINT_RING) },
      uBrush: { value: new THREE.Vector4(0, 0, 0, 0) },
      uBand: { value: 0 },
      uBias: { value: WALL_DEPTH_SLACK },
    };
    this._wall = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
      uniforms: this._wallUniforms, vertexShader: WALL_VERT, fragmentShader: WALL_FRAG,
      transparent: true, depthWrite: false, side: THREE.FrontSide, toneMapped: false,
    }));
    this._wall.frustumCulled = false;
    this._wall.visible = false;
    this._wall.renderOrder = 2;
    this._wallReady = false;
    this._paintVisible = false;
    this._scene.add(this._wall);

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
  /** @returns {{ x: number, y: number, width: number, height: number }} the free region the pot is fitted in (CSS px, canvas coordinates) */
  get region() { return this._region(); }

  /**
   * Shows a new toolpath. Takes ownership of the typed arrays. Never moves
   * the camera (D20), except for the very first toolpath.
   * @param {PreviewResult | null} result
   */
  setToolpath(result) {
    const n = result?.positions ? Math.floor(result.positions.length / 3) : 0;
    this._detail = detailFor(n - 1, this._detail);
    const geometry = result ? buildGeometry(result, this._detail) : null;
    this._mesh.geometry.dispose();
    this._mesh.geometry = geometry || new THREE.InstancedBufferGeometry();
    this._mesh.visible = !!geometry;
    this._result = geometry ? result : null;
    if (geometry) {
      this._setBeadUniform(result);
      this._bounds = outerBounds(result);
      placeShadow(this._shadow, this._bounds);
      this._buildSeam(result);
      this._buildWall(result.wallGrid);
      if (!this._everFitted) {
        this._everFitted = true;
        this.fitCamera();
      }
    } else {
      this._bounds = null;
      this._shadow.visible = false;
      this._seam.visible = false;
      this._wallReady = false;
      this._wall.visible = false;
    }
    this.requestRender();
  }

  /**
   * Shows the paint on the pot, or hides it (Paint mode, D87). Hidden, the
   * wall can still be picked.
   * @param {boolean} visible
   */
  setPaintVisible(visible) {
    this._paintVisible = !!visible;
    this._wall.visible = this._paintVisible && this._wallReady;
    this.requestRender();
  }

  /**
   * The overlay to show (core/paint.js): PAINT_AROUND × PAINT_UP cells, row 0
   * at the bottom; null is white. The cells are copied.
   * @param {Uint8Array | null} cells
   * @param {{ fromV?: number, toV?: number }} [range] the Pattern's range as shares of the height; outside it the wash is fainter
   */
  setPaint(cells, { fromV = 0, toV = 1 } = {}) {
    if (cells && cells.length === PAINT_SIZE) this._paintData.set(cells);
    else this._paintData.fill(255);
    this._paintTexture.needsUpdate = true;
    this._wallUniforms.uRange.value.set(fromV, toV);
    if (this._wall.visible) this.requestRender();
  }

  /**
   * The brush's ring on the wall, or none.
   * @param {{ u: number, v: number, ru: number, rv: number, band?: boolean } | null} mark
   *   its middle and its radii as shares of the way round and of the height; band: a level band instead of a ring
   */
  setBrushMark(mark) {
    const b = this._wallUniforms.uBrush.value;
    const had = b.z > 0;
    if (mark && mark.ru > 0 && mark.rv > 0) b.set(mark.u, mark.v, mark.ru, mark.rv);
    else b.set(0, 0, 0, 0);
    this._wallUniforms.uBand.value = mark?.band ? 1 : 0;
    if (this._wall.visible && (had || b.z > 0)) this.requestRender();
  }

  /**
   * The spot on the outside of the wall under a pointer: its place round the
   * pot and its height as a share of the pot's, or null beside the pot and
   * on its inside.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{ u: number, v: number, point: THREE.Vector3 } | null}
   */
  pickWall(clientX, clientY) {
    if (!this._wallReady) return null;
    this.rayFromClient(clientX, clientY, this._pickRay ||= new THREE.Ray());
    const hit = this._raycaster.intersectObject(this._wall, false)[0];
    if (!hit?.uv) return null;
    return { u: hit.uv.x - Math.floor(hit.uv.x), v: Math.min(Math.max(hit.uv.y, 0), 1), point: hit.point };
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
   * phone, between the top bar and the controls area; desktop, between the
   * left panel and the right column.
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
    const own = result === this._result ? null : buildGeometry(result, THUMB_DETAIL);
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
      halfPx: this._uniforms.uHalfPx.value.clone(), mask: this._uniforms.uMask.value, seam: this._seam.visible, bed: this._bedGroup.visible, wall: this._wall.visible,
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
      this._wall.visible = false;
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
      this._wall.visible = saved.wall;
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
    this._wall.geometry.dispose();
    this._wall.material.dispose();
    this._paintTexture.dispose();
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
    // The camera's direction around the pot; looking straight down, the
    // direction the top of the screen points away from.
    const view = this._v.copy(camera.position).sub(lookAt);
    view.z = 0;
    if (view.lengthSq() < 1e-6) view.setFromMatrixColumn(camera.matrixWorld, 1).negate().setZ(0);
    if (view.lengthSq() < 1e-6) view.set(0, -1, 0);
    view.normalize();
    const az0 = Math.atan2(view.y, view.x);
    for (const { light, spec } of this._lights) {
      const az = az0 + THREE.MathUtils.degToRad(spec.azimuth);
      const el = THREE.MathUtils.degToRad(spec.elevation);
      light.target.position.copy(lookAt);
      light.position.set(Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el))
        .multiplyScalar(1000).add(lookAt);
      light.target.updateMatrixWorld();
    }
    const geometry = this._mesh.geometry;
    this._uniforms.uMitre.value = geometry.userData.steps === 1 ? 1 : 0;
    this._uniforms.uTopZ.value = geometry.userData.topZ ?? 1e9;
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

  /**
   * The wall surface from the engine's grid of the plain wall: every point
   * moved out to the plain wall's outer face, a column repeated to close the ring, and (u, v)
   * as texture coordinates. Faces point outwards, so only the outside of the
   * wall is hit and drawn.
   */
  _buildWall(grid) {
    const ok = grid && grid.around >= 3 && grid.up >= 1 && grid.positions?.length === (grid.up + 1) * grid.around * 3;
    this._wallReady = !!ok;
    this._wall.visible = this._paintVisible && this._wallReady;
    if (!ok) return;
    const { around, up, positions } = grid;
    const cols = around + 1;
    const count = (up + 1) * cols;
    let g = this._wall.geometry;
    if (g.userData.key !== `${around}x${up}`) {
      g.dispose();
      g = this._wall.geometry = new THREE.BufferGeometry();
      g.userData.key = `${around}x${up}`;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      const uv = new Float32Array(count * 2);
      for (let r = 0; r <= up; r++) {
        for (let c = 0; c < cols; c++) {
          uv[(r * cols + c) * 2] = c / around;
          uv[(r * cols + c) * 2 + 1] = r / up;
        }
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.userData.ccw = null;
    }
    const pos = g.getAttribute('position');
    const out = pos.array;
    const half = this._uniforms.uBead.value.x / 2;
    const push = half + WALL_CLEARANCE;
    this._wallUniforms.uBias.value = Math.max(0, (grid.reachMm > 0 ? grid.reachMm : 0) - half) + WALL_DEPTH_SLACK;
    for (let r = 0; r <= up; r++) {
      for (let c = 0; c < cols; c++) {
        const s = (r * around + (c % around)) * 3;
        const d = (r * cols + c) * 3;
        const x = positions[s], y = positions[s + 1];
        const len = Math.hypot(x, y) || 1;
        out[d] = x + (x / len) * push;
        out[d + 1] = y + (y / len) * push;
        out[d + 2] = positions[s + 2];
      }
    }
    pos.needsUpdate = true;
    // Which way round u runs (the bottom ring's signed area) decides the winding.
    let area = 0;
    for (let c = 0; c < around; c++) {
      const a = c * 3, b = ((c + 1) % around) * 3;
      area += positions[a] * positions[b + 1] - positions[b] * positions[a + 1];
    }
    const ccw = area >= 0;
    if (g.userData.ccw !== ccw) {
      g.userData.ccw = ccw;
      const index = new Uint16Array(up * around * 6);
      let o = 0;
      for (let r = 0; r < up; r++) {
        for (let c = 0; c < around; c++) {
          const p00 = r * cols + c, p01 = p00 + 1, p10 = p00 + cols, p11 = p10 + 1;
          if (ccw) { index[o++] = p00; index[o++] = p01; index[o++] = p11; index[o++] = p00; index[o++] = p11; index[o++] = p10; }
          else { index[o++] = p00; index[o++] = p11; index[o++] = p01; index[o++] = p00; index[o++] = p10; index[o++] = p11; }
        }
      }
      g.setIndex(new THREE.BufferAttribute(index, 1));
    }
    g.computeBoundingSphere();
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
 * Rings of a unit superellipse cross-section (x along the side, y up, z = how
 * far along the segment, 0 to 1), smooth normals, and flat caps that close
 * the open ends of a bead run (joints hide them).
 * @param {{ sides: number, steps: number }} detail
 */
function templateData({ sides, steps }) {
  const rings = steps + 1;
  const pos = new Float32Array(rings * sides * 3);
  const nrm = new Float32Array(rings * sides * 3);
  const e = 2 / SHAPE_EXP, f = 2 * (SHAPE_EXP - 1) / SHAPE_EXP;
  const spow = (v, p) => Math.sign(v) * Math.abs(v) ** p;
  // Half the width and height a ring of this many sides reaches.
  const extent = (n) => {
    let x = 0, y = 0;
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n;
      x = Math.max(x, 0.5 * Math.abs(Math.cos(a)) ** e);
      y = Math.max(y, 0.5 * Math.abs(Math.sin(a)) ** e);
    }
    return { x, y };
  };
  // A coarser ring is stretched to the full one's extent (the full one is
  // left exactly as it is), with its normals corrected for the stretch.
  const want = extent(FULL_SIDES), have = extent(sides);
  const sx = want.x / have.x, sy = want.y / have.y;
  for (let ring = 0; ring < rings; ring++) {
    for (let k = 0; k < sides; k++) {
      const a = (2 * Math.PI * k) / sides;
      const c = Math.cos(a), s = Math.sin(a);
      const o = (ring * sides + k) * 3;
      pos[o] = 0.5 * spow(c, e) * sx;
      pos[o + 1] = 0.5 * spow(s, e) * sy;
      // Rings bunch up towards the toolpath points, where a zigzag bends hardest.
      pos[o + 2] = 0.5 - 0.5 * Math.cos((Math.PI * ring) / steps);
      // Gradient of |2x|^n + |2y|^n, which is the outward normal.
      const nx = spow(c, f) / sx, ny = spow(s, f) / sy, nl = Math.hypot(nx, ny) || 1;
      nrm[o] = nx / nl;
      nrm[o + 1] = ny / nl;
    }
  }
  const idx = [];
  for (let ring = 0; ring < steps; ring++) {
    for (let k = 0; k < sides; k++) {
      const a0 = ring * sides + k, b0 = ring * sides + (k + 1) % sides, a1 = a0 + sides, b1 = b0 + sides;
      idx.push(a0, b1, b0, a0, a1, b1);
    }
  }
  const last = steps * sides;
  for (let k = 1; k < sides - 1; k++) {
    idx.push(0, k, k + 1);                                // start cap faces back
    idx.push(last, last + k + 1, last + k);               // end cap faces forward
  }
  return { position: pos, normal: nrm, index: new Uint16Array(idx) };
}

/** Template arrays by detail, built on first use. */
const templates = new Map();

/** Triangles one bead of this detail is drawn with. */
const trianglesOf = ({ sides, steps }) => 2 * sides * steps + 2 * (sides - 2);

/**
 * The richest detail whose beads fit the device's triangle budget (see
 * DETAILS).
 * @param {number} segments
 * @param {{ sides: number, steps: number }} current the detail in use, for the hysteresis
 */
function detailFor(segments, current) {
  const budget = isCompactDevice() ? TRIANGLE_BUDGET_COMPACT : TRIANGLE_BUDGET_ANY;
  const at = DETAILS.indexOf(current);
  for (let i = 0; i < DETAILS.length - 1; i++) {
    // Stepping up from a coarser detail needs some room to spare.
    const limit = budget * (at > i ? LOD_HYSTERESIS : 1);
    if (segments * trianglesOf(DETAILS[i]) <= limit) return DETAILS[i];
  }
  return DETAILS[DETAILS.length - 1];
}

/** A phone or tablet: touch as the main pointer, or a small screen. */
function isCompactDevice() {
  if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return true;
  const s = typeof screen === 'object' && screen ? Math.min(screen.width, screen.height) : 0;
  return s > 0 && s < 600;
}

/**
 * Instanced geometry over a toolpath. Two memcpy-style copies pad the arrays
 * by one point at each end so every segment can read both neighbours; there
 * is no per-segment JavaScript.
 * @param {PreviewResult} result
 * @param {{ sides: number, steps: number }} [detail] of the bead template
 * @returns {THREE.InstancedBufferGeometry | null}
 */
function buildGeometry(result, detail = DETAILS[0]) {
  const positions = result?.positions;
  const n = positions ? Math.floor(positions.length / 3) : 0;
  if (n < 2) return null;
  if (!templates.has(detail)) templates.set(detail, templateData(detail));
  const templateArrays = templates.get(detail);
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
  g.userData.steps = detail.steps;
  // Nothing lies on the top layer, so its top isn't shaded as a groove.
  g.userData.topZ = result.bounds?.max?.[2] ?? Infinity;
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
