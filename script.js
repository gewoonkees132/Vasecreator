import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';
import { OBJExporter } from 'OBJExporter';

const Utils = {
  debounce: (func, wait) => {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  },
  lerp: (start, end, t) => start + (end - start) * t,
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  createCanvasTexture: (() => {
    const textureCache = new Map();
    return (text, options = {}) => {
      const { fontSize = 24, fontFamily = 'Inter, sans-serif', color = '#000', padding = 5 } = options;
      const cacheKey = `${text}-${fontSize}-${fontFamily}-${color}-${padding}`;
      if (textureCache.has(cacheKey)) {
        return textureCache.get(cacheKey);
      }
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const textFont = `${fontSize}px ${fontFamily}`;
      ctx.font = textFont;
      const textWidth = ctx.measureText(text).width;
      const canvasWidth = textWidth + padding * 2;
      const canvasHeight = fontSize * 2;
      const pixelRatio = Math.min(window.devicePixelRatio, 2);
      canvas.width = canvasWidth * pixelRatio;
      canvas.height = canvasHeight * pixelRatio;
      ctx.scale(pixelRatio, pixelRatio);
      ctx.font = textFont;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, canvasWidth / 2, canvasHeight / 2);
      const texture = new THREE.CanvasTexture(canvas);
      textureCache.set(cacheKey, texture);
      return texture;
    };
  })(),
};

class ModuleBase {
  constructor(app) {
    this.app = app;
    this.config = app.config;
    this.state = app.state;
    this.THREE = THREE;
  }
}

class UnifiedEventHandler {
  constructor(app) {
    this.app = app;
    this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this.eventMap = {
      start: this.isTouchDevice ? 'touchstart' : 'mousedown',
      move: this.isTouchDevice ? 'touchmove' : 'mousemove',
      end: this.isTouchDevice ? 'touchend' : 'mouseup',
    };
  }

  addEventListener(element, type, handler) {
    const eventName = this.eventMap[type];
    const options = { passive: type !== 'start' && type !== 'end' };
    element.addEventListener(eventName, (event) => {
      handler(this.normalizeEvent(event));
    }, options);
  }

  normalizeEvent(event) {
    if (this.isTouchDevice) {
      const touch = event.type === 'touchend' ? event.changedTouches[0] : event.touches[0];
      const normalized = {
        clientX: touch.clientX,
        clientY: touch.clientY,
        preventDefault: () => event.preventDefault(),
      };
      return normalized;
    }
    return event;
  }
}

class SubtitleAnimator {
  constructor() {
    this.subtitles = ["Your Vase.", "Your Design.", "Create it.", "A vase for every style"];
    this.element = document.getElementById('subtitle');
    this.subtitleIndex = 0;
    if (this.element) {
      this.element.style.transition = 'opacity 1s';
    }
    this.typingSpeed = 50;
  }

  animate() {
    if (!this.element) return;
    this.element.style.opacity = 0;
    setTimeout(() => {
      this.element.textContent = this.subtitles[this.subtitleIndex];
      this.element.style.opacity = 1;
      setTimeout(() => {
        this.subtitleIndex = (this.subtitleIndex + 1) % this.subtitles.length;
        this.animate();
      }, 1500 + this.subtitles[this.subtitleIndex].length * this.typingSpeed);
    }, 500);
  }

  start() {
    this.animate();
  }
}

class ConfigurationManager extends ModuleBase {
  constructor(app) {
    super(app);
    this.colorCache = new Map();
    this.fetchCSSVariables();
    this.createMaterials();
    this.initConfig();
  }

  fetchCSSVariables() {
    const rootStyles = getComputedStyle(document.documentElement);
    const getCSS = (variable) => {
      if (this.colorCache.has(variable)) return this.colorCache.get(variable);
      let color = rootStyles.getPropertyValue(variable).trim();
      if (color.startsWith('rgba(')) {
        const match = color.match(/rgba\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
          color = `rgb(${match[1]}, ${match[2]}, ${match[3]})`;
        }
      }
      this.colorCache.set(variable, color);
      return color;
    };
    this.app.cssVars = {
      colorPrimary: getCSS('--color-primary'),
      colorPrimaryLight: getCSS('--color-primary-light'),
      colorPrimaryDark: getCSS('--color-primary-dark'),
      colorBackground: getCSS('--color-background'),
      colorBorder: getCSS('--color-border'),
      colorText: getCSS('--color-text'),
      colorTextSecondary: getCSS('--color-text-secondary'),
      colorSurface: getCSS('--color-surface'),
      colorControlPoint: getCSS('--color-text'),
      colorControlLine: getCSS('--color-primary'),
      colorHover: getCSS('--color-primary-light'),
      colorDimensionLine: getCSS('--color-primary'),
      colorDimensionText: getCSS('--color-dimension-text'),
      colorCurveLine: getCSS('--color-primary'),
      colorBoundingBox: getCSS('--color-primary'),
      colorProfilePlane: getCSS('--color-primary-light'),
      colorCanvasBackground: getCSS('--color-background'),
    };
  }

  createMaterial(type, options = {}) {
    const materialTypes = {
      meshStandard: (opts) => new this.THREE.MeshStandardMaterial(opts),
      meshBasic: (opts) => new this.THREE.MeshBasicMaterial(opts),
      lineBasic: (opts) => new this.THREE.LineBasicMaterial(opts),
    };
    return (materialTypes[type] || (() => new this.THREE.Material()))(Object.assign({}, options));
  }

  createMaterials() {
    const css = this.app.cssVars;
    this.app.materials = {
      pot: this.createMaterial('meshStandard', { color: css.colorPrimary }),
      controlPoint: this.createMaterial('meshBasic', { color: css.colorControlPoint, opacity: 1 }),
      controlLine: this.createMaterial('lineBasic', { color: css.colorControlLine }),
      hover: this.createMaterial('meshBasic', { color: css.colorHover }),
      base: this.createMaterial('meshStandard', { color: css.colorPrimaryDark, metalness: 0.1 }),
      profilePlane: this.createMaterial('meshBasic', { color: css.colorProfilePlane }),
      curveLine: this.createMaterial('lineBasic', { color: css.colorCurveLine, linewidth: 2 }),
      boundingBox: this.createMaterial('lineBasic', { color: css.colorBoundingBox }),
      dimensionLine: this.createMaterial('lineBasic', { color: css.colorDimensionLine }),
      dimensionHandle: this.createMaterial('meshBasic', { color: css.colorControlPoint }),
      dimensionHandleHover: this.createMaterial('meshBasic', { color: css.colorPrimary }),
    };
  }

  initConfig() {
    this.app.config = {
      curve: { tension: 0.5, type: 'spline', filletRadius: 0.5, segments: 40, heightSegments: 80, wallThickness: 0.04 },
      base: { filletRadius: 0.4 },
      dimensions: { width: 1, depth: 1 },
      drainageHoleScale: 0.5,
      materials: this.app.materials,
      display: { showProfilePlane: true, showControlPoints: true, showGrid: true, showBoundingBox: true },
      animation: { duration: 0.15, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      unitToMm: 50,
    };
  }

  setConfigValue(path, value) {
    const parts = path.split('.');
    const key = parts.pop();
    const target = parts.reduce((obj, k) => obj[k] || (obj[k] = {}), this.app.config);
    target[key] = value;
  }
}

class StateManager extends ModuleBase {
  constructor(app) {
    super(app);
    this.initState();
  }

  initState() {
    const initialControlPoints = [
      new this.THREE.Vector2(0.2 / 0.6, 0.0),
      new this.THREE.Vector2(0.4 / 0.6, 0.3),
      new this.THREE.Vector2(0.5 / 0.6, 0.6),
      new this.THREE.Vector2(0.45 / 0.6, 0.9),
      new this.THREE.Vector2(0.3 / 0.6, 1.2),
    ];
    this.app.state = {
      controlPoints: initialControlPoints,
      controlPointMeshes: [],
      controlPointsGroup: new this.THREE.Group(),
      flowerpotMesh: null,
      raycaster: new this.THREE.Raycaster(),
      draggingPoint: null,
      hoveredPoint: null,
      curveLine: null,
      boundingBoxHelper: null,
      dimensionLinesGroup: new this.THREE.Group(),
      dimensionHandles: [],
      dimensionHandleHovered: null,
      draggingDimensionHandle: null,
      dimensionTypeDragging: null,
      initialDimensionDragValue: null,
      minY: 0,
      clock: new this.THREE.Clock(),
    };
    this.app.state.raycaster.near = 0.1;
    this.app.state.raycaster.far = 100;
  }
}

class SceneManager extends ModuleBase {
    constructor(app) {
      super(app);
      this.initScene();
      this.setupLights();
      this.setupEventListeners();
    }

    initScene() {
      const { container } = this.app.DOM;
      const clientWidth = container.clientWidth;
      const clientHeight = container.clientHeight;
      this.app.scene = new this.THREE.Scene();
      this.app.camera = new this.THREE.PerspectiveCamera(65, clientWidth / clientHeight, 0.1, 1000);
      this.app.camera.position.set(2, 2, 2);
      this.app.renderer = new this.THREE.WebGLRenderer({
        canvas: this.app.DOM.canvas,
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
      this.app.renderer.debug.checkShaderErrors = false;
      this.app.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.app.renderer.setSize(clientWidth, clientHeight);
      this.app.renderer.shadowMap.enabled = true;
      this.app.renderer.shadowMap.type = this.THREE.PCFSoftShadowMap;
      this.app.renderer.outputEncoding = this.THREE.sRGBEncoding;
      this.app.renderer.toneMapping = this.THREE.ACESFilmicToneMapping;
      this.app.renderer.toneMappingExposure = 1.5;
      this.app.controls = new OrbitControls(this.app.camera, this.app.renderer.domElement);
      Object.assign(this.app.controls, {
        enableDamping: true,
        dampingFactor: 0.08,
        screenSpacePanning: true,
        minDistance: 1,
        maxDistance: 10,
        maxPolarAngle: Math.PI / 2,
        rotateSpeed: 0.9,
      });
      this.app.scene.add(this.app.state.controlPointsGroup);
      this.app.scene.add(this.app.state.dimensionLinesGroup);
      const grid = new this.THREE.GridHelper(5, 50, this.app.cssVars.colorTextSecondary, this.app.cssVars.colorBorder);
      grid.material.transparent = true;
      grid.material.opacity = 0.10;
      this.app.scene.add(grid);
    }

  setupLights() {
    const { cssVars, scene } = this.app;
    this.app.ambientLight = this.app.ambientLight || new this.THREE.AmbientLight(cssVars.colorSurface, 0.6);
    this.app.ambientLight.color.set(cssVars.colorSurface);
    this.app.ambientLight.intensity = 0.6;
    scene.add(this.app.ambientLight);

    this.app.mainLight = this.app.mainLight || new this.THREE.DirectionalLight(cssVars.colorPrimaryLight, 0.6);
    this.app.mainLight.position.set(1, 2, 3);
    this.app.mainLight.color.set(cssVars.colorPrimaryLight);
    scene.add(this.app.mainLight);

    this.app.fillLight = this.app.fillLight || new this.THREE.DirectionalLight(cssVars.colorPrimaryLight, 0.4);
    this.app.fillLight.position.set(-1, 0, -2);
    this.app.fillLight.color.set(cssVars.colorPrimaryLight);
    scene.add(this.app.fillLight);

    this.app.rimLight = this.app.rimLight || new this.THREE.DirectionalLight(cssVars.colorSurface, 0.3);
    this.app.rimLight.position.set(0, 3, -2);
    this.app.rimLight.color.set(cssVars.colorSurface);
    scene.add(this.app.rimLight);
  }

  setupEventListeners() {
    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);
  }

  handleResize() {
    const { container } = this.app.DOM;
    const clientWidth = container.clientWidth;
    const clientHeight = container.clientHeight;
    this.app.camera.aspect = clientWidth / clientHeight;
    this.app.camera.updateProjectionMatrix();
    this.app.renderer.setSize(clientWidth, clientHeight);
    this.app.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }
}

class InputManager extends ModuleBase {
  constructor(app) {
    super(app);
    this.eventHandler = new UnifiedEventHandler(app);
    this.mousePosition = new this.THREE.Vector2();
    this.planeIntersectionPoint = new this.THREE.Vector3();
    this.dragOffset = new this.THREE.Vector3();
    this.setupEventListeners();
  }

  setupEventListeners() {
    const domEl = this.app.renderer.domElement;
    this.eventHandler.addEventListener(domEl, 'start', this.onStart.bind(this));
    this.eventHandler.addEventListener(domEl, 'move', this.onMove.bind(this));
    this.eventHandler.addEventListener(domEl, 'end', this.onEnd.bind(this));
    this.eventHandler.addEventListener(window, 'end', this.onEnd.bind(this));
  }

  onStart(event) {
    event.preventDefault();
    const hits = this.getIntersection(event, this.state.controlPointMeshes.concat(this.state.dimensionHandles));
    if (hits.length > 0) {
      const hitObject = hits[0].object;
      if (hitObject.userData.type === 'controlPoint') {
        this.state.draggingPoint = hitObject;
        this.app.controls.enabled = false;
        document.body.style.cursor = 'grabbing';
        const originalScale = hitObject.scale.x;
        this.animateScale(hitObject, originalScale * 1.2, () => this.animateScale(hitObject, originalScale));
      } else if (hitObject.userData.type === 'dimensionHandle') {
        this.state.draggingDimensionHandle = hitObject;
        this.state.dimensionTypeDragging = hitObject.userData.dimensionType;
        this.state.initialDimensionDragValue = hitObject.position.clone();
        this.app.controls.enabled = false;
        document.body.style.cursor = 'ew-resize';
        hitObject.material = this.config.materials.dimensionHandleHover;
        const intersection = hits[0].point;
        this.dragOffset.subVectors(this.state.initialDimensionDragValue, intersection);
      }
    }
  }

  onMove(event) {
    if (this.state.draggingPoint) {
      this.handleControlPointDrag(event);
    } else if (this.state.draggingDimensionHandle) {
      this.handleDimensionHandleDrag(event);
    } else {
      this.updateHoverStates(event);
    }
  }

  onEnd() {
    if (this.state.draggingPoint) {
      this.state.draggingPoint = null;
      this.app.controls.enabled = true;
      document.body.style.cursor = 'default';
    }
    if (this.state.draggingDimensionHandle) {
      this.state.draggingDimensionHandle.material = this.config.materials.dimensionHandle;
      this.state.draggingDimensionHandle = null;
      this.state.dimensionTypeDragging = null;
      this.state.initialDimensionDragValue = null;
      this.app.controls.enabled = true;
      document.body.style.cursor = 'default';
    }
  }

  getMousePosition(event) {
    const rect = this.app.renderer.domElement.getBoundingClientRect();
    this.mousePosition.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    return this.mousePosition;
  }

  getIntersection(event, objects) {
    const mouse = this.getMousePosition(event);
    this.state.raycaster.setFromCamera(mouse, this.app.camera);
    return this.state.raycaster.intersectObjects(objects, false);
  }

  getPlaneIntersection(event, planeNormal, planeConstant) {
    const mouse = this.getMousePosition(event);
    this.state.raycaster.setFromCamera(mouse, this.app.camera);
    const plane = new this.THREE.Plane(planeNormal, planeConstant);
    return this.state.raycaster.ray.intersectPlane(plane, this.planeIntersectionPoint)
      ? this.planeIntersectionPoint : null;
  }

  handleControlPointDrag(event) {
    const intersection = this.getPlaneIntersection(event, new this.THREE.Vector3(0, 0, 1), 0);
    if (!intersection) return;
    const index = this.state.draggingPoint.userData.index;
    const clampedX = Utils.clamp(intersection.x / this.config.dimensions.width, 0.01, 1);
    const clampedY = Utils.clamp(intersection.y, 0, 3);
    const finalY = index === 0 ? 0 : clampedY;
    this.state.controlPoints[index].set(clampedX, finalY);
    const targetX = this.app.scaleX(clampedX);
    const targetY = finalY;
    this.state.draggingPoint.position.x += (targetX - this.state.draggingPoint.position.x) * 0.6;
    this.state.draggingPoint.position.y += (targetY - this.state.draggingPoint.position.y) * 0.6;
    this.app.updateControlLinesAndCurve();
    this.app.generateFlowerpot();
  }

  handleDimensionHandleDrag(event) {
    const planeNormal = new this.THREE.Vector3(0, 1, 0);
    const intersection = this.getPlaneIntersection(event, planeNormal, this.state.minY);
    if (!intersection) return;
    let delta;
    if (this.state.dimensionTypeDragging === 'width') {
      delta = (intersection.x + this.dragOffset.x) - this.state.initialDimensionDragValue.x;
      const newWidth = Math.max(0.1, this.config.dimensions.width + delta);
      this.app.configurationManager.setConfigValue('dimensions.width', newWidth);
      this.app.DOM.controls.widthSlider.value = newWidth;
      this.state.initialDimensionDragValue.x += delta;
    } else if (this.state.dimensionTypeDragging === 'depth') {
      delta = (intersection.z + this.dragOffset.z) - this.state.initialDimensionDragValue.z;
      const newDepth = Math.max(0.1, this.config.dimensions.depth + delta);
      this.app.configurationManager.setConfigValue('dimensions.depth', newDepth);
      this.app.DOM.controls.depthSlider.value = newDepth;
      this.state.initialDimensionDragValue.z += delta;
    }
    this.app.generateFlowerpot();
  }

  updateHoverStates(event) {
    if (this.state.hoveredPoint) {
      this.state.hoveredPoint.scale.set(1, 1, 1);
      this.state.hoveredPoint.material = this.config.materials.controlPoint;
      this.state.hoveredPoint = null;
      document.body.style.cursor = 'default';
    }
    if (this.state.dimensionHandleHovered) {
      this.state.dimensionHandleHovered.material = this.config.materials.dimensionHandle;
      this.state.dimensionHandleHovered = null;
      document.body.style.cursor = 'default';
    }
    this.updateHoverState(event, this.state.controlPointMeshes, 'hoveredPoint', 'grab', 'controlPoint');
    if (!this.state.hoveredPoint) {
      this.updateHoverState(event, this.state.dimensionHandles, 'dimensionHandleHovered', 'ew-resize', 'dimensionHandle');
    }
  }

  updateHoverState(event, objects, hoverProp, cursor, type) {
    const intersects = this.getIntersection(event, objects);
    if (intersects.length > 0) {
      const obj = intersects[0].object;
      if (obj.userData.type === type && this.state[hoverProp] !== obj) {
        this.state[hoverProp] = obj;
        obj.scale.set(1.1, 1.1, 1.1);
        obj.material = this.config.materials.hover;
        document.body.style.cursor = cursor;
      }
    }
  }

  animateScale(point, targetScale, onComplete = null) {
    const startScale = point.scale.x;
    const duration = 100;
    const startTime = performance.now();
    const animateStep = (currentTime) => {
      const progress = Math.min((currentTime - startTime) / duration, 1);
      const current = Utils.lerp(startScale, targetScale, progress);
      point.scale.set(current, current, current);
      if (progress < 1) {
        requestAnimationFrame(animateStep);
      } else if (onComplete) {
        onComplete();
      }
    };
    requestAnimationFrame(animateStep);
  }
}

class RenderManager extends ModuleBase {
  constructor(app) {
    super(app);
    this.lastTime = performance.now();
    this.animate = this.animate.bind(this);
  }

  startAnimation() {
    requestAnimationFrame(this.animate);
  }

  animate() {
    this.app.animationRequestId = requestAnimationFrame(this.animate);
    const currentTime = performance.now();
    const deltaTime = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;

    this.app.controls.update();
    this.app.dynamicBackground.animate(deltaTime);

    this.app.renderer.render(this.app.scene, this.app.camera);
  }
}

class ExportManager extends ModuleBase {
  exportToObj() {
    try {
      if (!this.app.state.flowerpotMesh) throw new Error('No flowerpot mesh to export.');

      const exportMesh = this.app.state.flowerpotMesh.clone();
      exportMesh.geometry = exportMesh.geometry.clone();

      const scaleFactor = this.app.config.unitToMm;
      const scaleMatrix = new this.THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor);

      const rotationMatrix = new this.THREE.Matrix4().makeRotationX(Math.PI / 2);
      const finalMatrix = new this.THREE.Matrix4().multiplyMatrices(rotationMatrix, scaleMatrix);
      exportMesh.geometry.applyMatrix4(finalMatrix);

      const exporter = new OBJExporter();
      const result = exporter.parse(exportMesh);

      const blob = new Blob([result], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'flowerpot.obj';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 100);

    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export OBJ file. Please try again.');
    } finally {
    }
  }
}

class ResourceManager extends ModuleBase {
  cleanupPreviousMeshes() {
    const { scene, state } = this.app;

    if (state.flowerpotMesh) {
      scene.remove(state.flowerpotMesh);
      state.flowerpotMesh.geometry.dispose();
      Array.isArray(state.flowerpotMesh.material)
        ? state.flowerpotMesh.material.forEach(m => m.dispose())
        : state.flowerpotMesh.material.dispose();
      state.flowerpotMesh = null;
    }

    if (state.boundingBoxHelper) {
      scene.remove(state.boundingBoxHelper);
      state.boundingBoxHelper = null;
    }

    state.dimensionLinesGroup.children.forEach(child => {
      if (child.material?.map) child.material.map.dispose();
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        Array.isArray(child.material)
          ? child.material.forEach(m => m.dispose())
          : child.material.dispose();
      }
    });
    state.dimensionLinesGroup.clear();

    state.dimensionHandles.forEach(handle => {
      scene.remove(handle);
      if (handle.material) {
          Array.isArray(handle.material)
            ? handle.material.forEach(m => m.dispose())
            : handle.material.dispose();
      }
    });
    state.dimensionHandles = [];

    state.controlPointMeshes = [];
    state.controlPointsGroup.clear();
  }
}

class UIController extends ModuleBase {
  constructor(app) {
    super(app);
    this.setupUIEventListeners();
    this.setupToggleListeners();
  }

  updateDimensionDisplays() {
    const { width: widthDisplay, depth: depthDisplay } = this.app.DOM.valueDisplays;
    if (this.app.state.flowerpotMesh) {
      const box = new this.THREE.Box3().setFromObject(this.app.state.flowerpotMesh);
      const size = box.getSize(new this.THREE.Vector3());
      const unitFactor = this.app.config.unitToMm;
      if (widthDisplay) {
        widthDisplay.textContent = (size.x * unitFactor).toFixed(1) + ' mm';
      }
      if (depthDisplay) {
        depthDisplay.textContent = (size.z * unitFactor).toFixed(1) + ' mm';
      }
    } else {
      if (widthDisplay) widthDisplay.textContent = 'N/A';
      if (depthDisplay) depthDisplay.textContent = 'N/A';
    }
  }

  setupUIEventListeners() {
    const DOM = this.app.DOM;

    const sliders = [
      { element: DOM.controls.baseFilletRadius, prop: 'base.filletRadius', display: DOM.valueDisplays.baseFilletRadius, format: v => Math.round(100 * v) + '%'  },
      { element: DOM.controls.wallThicknessSlider, prop: 'curve.wallThickness', display: DOM.valueDisplays.wallThickness, format: v => Math.round(100 * v) + ' mm'},
      { element: DOM.controls.drainageHoleScaleSlider, prop: 'drainageHoleScale', display: DOM.valueDisplays.drainageHoleScale, format: v => Math.round(100 * v) + '%'},
      { element: DOM.controls.widthSlider, prop: 'dimensions.width', display: DOM.valueDisplays.width, format: () => this.getFormattedDimension('x') },
      { element: DOM.controls.depthSlider, prop: 'dimensions.depth', display: DOM.valueDisplays.depth, format: () => this.getFormattedDimension('z') },
      { element: DOM.controls.tension, prop: 'curve.tension', display: DOM.valueDisplays.tension, format: v => v.toFixed(2) },
      { element: DOM.controls.filletRadius, prop: 'curve.filletRadius', display: DOM.valueDisplays.filletRadius, format: v => v.toFixed(2) },
    ];

    sliders.forEach(slider => {
      if (!slider.element) return;

      const updateHandler = Utils.debounce(e => {
        const value = parseFloat(e.target.value) || 0;
        this.app.configurationManager.setConfigValue(slider.prop, value);
        this.app.generateFlowerpot();
      }, 0.01);

      const displayUpdateHandler = e => {
        const value = parseFloat(e.target.value) || 0;
        if (slider.display) slider.display.textContent = slider.format(value);
      };

      slider.element.addEventListener('input', updateHandler);
      slider.element.addEventListener('input', displayUpdateHandler);

      if (slider.display) {
        const initial = parseFloat(slider.element.value) || 0;
        slider.display.textContent = slider.format(initial);
      }
    });

    if (DOM.controls.curveType) {
        DOM.controls.curveType.addEventListener('change', e => {
          const type = e.target.value;
          this.app.configurationManager.setConfigValue('curve.type', type);
          if (DOM.controls.filletControls) DOM.controls.filletControls.style.display = type === 'polyline' ? 'block' : 'none';
          if (DOM.controls.tension?.parentElement) DOM.controls.tension.parentElement.style.display = type === 'spline' ? 'block' : 'none';
          this.app.generateFlowerpot();
        });
        const initialType = DOM.controls.curveType.value;
        if (DOM.controls.filletControls) DOM.controls.filletControls.style.display = initialType === 'polyline' ? 'block' : 'none';
        if (DOM.controls.tension?.parentElement) DOM.controls.tension.parentElement.style.display = initialType === 'spline' ? 'block' : 'none';
    }

    if (DOM.buttons.addPoint) DOM.buttons.addPoint.addEventListener('click', () => this.app.addControlPoint());
    if (DOM.buttons.removePoint) DOM.buttons.removePoint.addEventListener('click', () => this.app.removeControlPoint());
    if (DOM.buttons.download) DOM.buttons.download.addEventListener('click', () => this.app.exportManager.exportToObj());
  }

  getFormattedDimension(axis) {
      if (this.app.state.flowerpotMesh) {
        const box = new this.THREE.Box3().setFromObject(this.app.state.flowerpotMesh);
        const size = box.getSize(new this.THREE.Vector3());
        const unitFactor = this.app.config.unitToMm;
        return (size[axis] * unitFactor).toFixed(1) + ' mm';
      }
      return 'N/A';
  }

  setupToggleListeners() {
    const { logoButton, introText, closeIntro, ctaButton, settingsButton, sidebar } = this.app.DOM;

    if (logoButton && introText && ctaButton) {
      logoButton.setAttribute("aria-expanded", "true");
      const toggleIntro = () => {
        const isHidden = introText.classList.toggle("hidden");
        logoButton.setAttribute("aria-expanded", !isHidden);
      };
      logoButton.addEventListener("click", toggleIntro);
      ctaButton.addEventListener("click", toggleIntro);
      if (closeIntro) {
        closeIntro.addEventListener("click", () => {
          introText.classList.add("hidden");
          logoButton.setAttribute("aria-expanded", "false");
        });
      }
    }

    if (settingsButton && sidebar) {
      settingsButton.addEventListener("click", () => {
        const isHidden = sidebar.getAttribute("aria-hidden") === "true";
        sidebar.setAttribute("aria-hidden", !isHidden);
    });
    }
  }

  destroy() {
  }
}


class GeometryModule extends ModuleBase {
  getCurvePoints() {
      const { Vector2, Vector3, CatmullRomCurve3 } = this.THREE;
      const points3D = this.state.controlPoints.map(controlPoint =>
          new Vector3(controlPoint.x * this.config.dimensions.width, controlPoint.y, 0)
      );

      if (this.config.curve.type === 'spline') {
          const curve = new CatmullRomCurve3(points3D, false, 'catmullrom', this.config.curve.tension);
          return curve.getPoints(50).map(p => new Vector2(p.x / this.config.dimensions.width, p.y));
      } else {
          return this.getPolylinePointsWithFillets().map(p => new Vector2(p.x / this.config.dimensions.width, p.y));
      }
  }

  getPolylinePointsWithFillets() {
      const { Vector2, MathUtils } = this.THREE;
      if (this.state.controlPoints.length < 2 || this.config.curve.filletRadius < 0.01) {
          return this.state.controlPoints.map(p => new Vector2(p.x * this.config.dimensions.width, p.y));
      }

      const result = [new Vector2(this.state.controlPoints[0].x * this.config.dimensions.width, this.state.controlPoints[0].y)];

      for (let i = 1; i < this.state.controlPoints.length - 1; i++) {
          const points = this.calculateFilletPoints(i);
          result.push(...points);
      }

      result.push(new Vector2(
          this.state.controlPoints[this.state.controlPoints.length - 1].x * this.config.dimensions.width,
          this.state.controlPoints[this.state.controlPoints.length - 1].y
      ));

      return result;
  }

  calculateFilletPoints(i) {
      const { Vector2, MathUtils } = this.THREE;
      const prev = new Vector2(this.state.controlPoints[i - 1].x * this.config.dimensions.width, this.state.controlPoints[i - 1].y);
      const current = new Vector2(this.state.controlPoints[i].x * this.config.dimensions.width, this.state.controlPoints[i].y);
      const next = new Vector2(this.state.controlPoints[i + 1].x * this.config.dimensions.width, this.state.controlPoints[i + 1].y);

      const prevTangent = new Vector2().subVectors(prev, current).normalize();
      const nextTangent = new Vector2().subVectors(next, current).normalize();

      const angle = Math.acos(MathUtils.clamp(prevTangent.dot(nextTangent), -1, 1));
      const filletDist = this.config.curve.filletRadius / Math.tan(angle / 2);
      const limit = Math.min(current.distanceTo(prev), current.distanceTo(next)) * 0.49;
      const clampedFilletDist = Math.min(filletDist, limit);

      const tangentPoint1 = new Vector2().addVectors(current, prevTangent.clone().multiplyScalar(clampedFilletDist));
      const tangentPoint2 = new Vector2().addVectors(current, nextTangent.clone().multiplyScalar(clampedFilletDist));

      const points = [tangentPoint1];
      const steps = Math.max(2, Math.ceil(angle * 8));

      for (let j = 1; j < steps; j++) {
          const t = j / steps;
          const lerpVector = new Vector2().lerpVectors(prevTangent, nextTangent, t).normalize();
          const arcPoint = new Vector2().addVectors(current, lerpVector.multiplyScalar(clampedFilletDist));
          points.push(arcPoint);
      }

      points.push(tangentPoint2);
      return points;
  }

  createRoundedRect(x, y, width, depth, baseFilletRadius) {
      const { Shape } = this.THREE;
      const maxPossibleRadius = Math.min(width, depth);
      const adjustedRadius = Math.min(baseFilletRadius, maxPossibleRadius);

      const shape = new Shape();
      shape.moveTo(x - width + adjustedRadius, y - depth);
      shape.lineTo(x + width - adjustedRadius, y - depth);
      shape.quadraticCurveTo(x + width, y - depth, x + width, y - depth + adjustedRadius);
      shape.lineTo(x + width, y + depth - adjustedRadius);
      shape.quadraticCurveTo(x + width, y + depth, x + width - adjustedRadius, y + depth);
      shape.lineTo(x - width + adjustedRadius, y + depth);
      shape.quadraticCurveTo(x - width, y + depth, x - width, y + depth - adjustedRadius);
      shape.lineTo(x - width, y - depth + adjustedRadius);
      shape.quadraticCurveTo(x - width, y - depth, x - width + adjustedRadius, y - depth);

      return shape;
  }

  generateThickFlowerpotGeometry(baseShapePoints, curvePoints, minY, curveHeight, wallThickness) {
      const vertices = [];
      const faces = [];
      const heightSegments = this.config.curve.heightSegments || 40;
      const { Vector2 } = this.THREE;
      const innerCurvePoints = this.generateInnerProfileCurve(curvePoints, wallThickness);
      const basePointCount = baseShapePoints.length;
      const pointsPerSlice = basePointCount * 2;
      const drainageHoleScale = this.config.drainageHoleScale;
      const drainageHolePoints = baseShapePoints.map(point =>
          new Vector2(point.x * drainageHoleScale, point.y * drainageHoleScale)
      );

      for (let i = 0; i <= heightSegments; i++) {
          const sliceHeight = i / heightSegments;
          const curveY = sliceHeight * curveHeight + minY;
          const actualHeight = curveY - minY;
          const outerRadius = this.findRadiusAtHeight(curvePoints, curveY);

          baseShapePoints.forEach(basePoint => {
              vertices.push(basePoint.x * outerRadius, actualHeight, basePoint.y * outerRadius);
          });

          if (curveY < minY + wallThickness) {
              const bottomOuterRadius = this.findRadiusAtHeight(curvePoints, minY);
              drainageHolePoints.forEach(drainPoint => {
                  vertices.push(drainPoint.x * bottomOuterRadius, actualHeight, drainPoint.y * bottomOuterRadius);
              });
          } else {
              const innerRadius = this.findRadiusAtHeight(innerCurvePoints, curveY);
              baseShapePoints.forEach(basePoint => {
                  vertices.push(basePoint.x * innerRadius, actualHeight, basePoint.y * innerRadius);
              });
          }
      }

      this.generateSideFaces(faces, heightSegments, basePointCount, pointsPerSlice);

      this.generateTopFaces(faces, heightSegments, basePointCount, pointsPerSlice);
      this.generateBottomFaces(faces, basePointCount);

      return { vertices, faces };
  }

  generateSideFaces(faces, heightSegments, basePointCount, pointsPerSlice) {
      for (let i = 0; i < heightSegments; i++) {
          for (let j = 0; j < basePointCount; j++) {
              const nextJ = (j + 1) % basePointCount;

              const outerA = i * pointsPerSlice + j;
              const outerB = i * pointsPerSlice + nextJ;
              const outerC = (i + 1) * pointsPerSlice + nextJ;
              const outerD = (i + 1) * pointsPerSlice + j;
              faces.push(outerA, outerD, outerB, outerB, outerD, outerC);

              const innerA = i * pointsPerSlice + basePointCount + j;
              const innerB = i * pointsPerSlice + basePointCount + nextJ;
              const innerC = (i + 1) * pointsPerSlice + basePointCount + nextJ;
              const innerD = (i + 1) * pointsPerSlice + basePointCount + j;
              faces.push(innerA, innerB, innerD, innerB, innerC, innerD);
          }
      }
  }

  generateTopFaces(faces, heightSegments, basePointCount, pointsPerSlice) {
      const topSliceIndex = heightSegments * pointsPerSlice;

      for (let j = 0; j < basePointCount; j++) {
          const nextJ = (j + 1) % basePointCount;
          const topOuterA = topSliceIndex + j;
          const topOuterB = topSliceIndex + nextJ;
          const topInnerA = topSliceIndex + basePointCount + j;
          const topInnerB = topSliceIndex + basePointCount + nextJ;

          faces.push(topOuterA, topInnerA, topOuterB, topOuterB, topInnerA, topInnerB);
      }
  }

  generateBottomFaces(faces, basePointCount) {
      for (let j = 0; j < basePointCount; j++) {
          const nextJ = (j + 1) % basePointCount;
          const bottomOuterA = j;
          const bottomOuterB = nextJ;
          const bottomHoleA = basePointCount + j;
          const bottomHoleB = basePointCount + nextJ;

          faces.push(bottomOuterA, bottomOuterB, bottomHoleA,  bottomHoleA, bottomOuterB, bottomHoleB);
      }
  }

  generateInnerProfileCurve(outerCurvePoints, wallThickness) {
      const { Vector2 } = this.THREE;
      const MIN_RADIUS = 0.01;

      return outerCurvePoints.map(outerPoint => {
          const innerRadius = Math.max(outerPoint.x - wallThickness, MIN_RADIUS);
          return new Vector2(innerRadius, outerPoint.y);
      });
  }

  findRadiusAtHeight(curvePoints, targetY) {
      if (targetY <= curvePoints[0].y) return curvePoints[0].x;
      if (targetY >= curvePoints[curvePoints.length - 1].y) return curvePoints[curvePoints.length - 1].x;

      let low = 0, high = curvePoints.length - 1;
      while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          if (curvePoints[mid].y < targetY) low = mid + 1;
          else high = mid - 1;
      }
      if (low > 0 && low < curvePoints.length) {
          const p1 = curvePoints[low - 1];
          const p2 = curvePoints[low];
          if (p2.y === p1.y) return p1.x;
          const t = (targetY - p1.y) / (p2.y - p1.y);
          return p1.x + t * (p2.x - p1.x);
      }
      return low === 0 ? curvePoints[0].x : curvePoints[curvePoints.length - 1].x;
  }
}


class DimensionModule {
  constructor(app) {
    this.app = app;
    this.config = app.config;
    this.state = app.state;
    this.THREE = app.THREE;
    this.handleGeometry = null;
  }

  createBoundingBoxAndDimensions() {
    if (!this.state.flowerpotMesh) return;

    const box = new THREE.Box3().setFromObject(this.state.flowerpotMesh);

    if (this.config.display.showBoundingBox && this.app.scene) {
        if (this.state.boundingBoxHelper) {
            this.state.boundingBoxHelper.box = box;
        } else {
            this.state.boundingBoxHelper = new THREE.Box3Helper(box, this.config.materials.boundingBox.color);
            this.app.scene.add(this.state.boundingBoxHelper);
        }
        this.state.boundingBoxHelper.visible = true;
    } else if (this.state.boundingBoxHelper) {
        this.state.boundingBoxHelper.visible = false;
    }


    const { min, max } = box;
    const size = box.getSize(new THREE.Vector3());
    const offset = 0.03;

    this.createDimensionLine(
      new THREE.Vector3(min.x, min.y - offset, min.z - offset),
      new THREE.Vector3(max.x, min.y - offset, min.z - offset),
      size.x,
      new THREE.Vector3((min.x + max.x) / 2, min.y - offset * 2, min.z - offset),
      'width'
    );

    this.createDimensionLine(
      new THREE.Vector3(max.x + offset, min.y - offset, min.z),
      new THREE.Vector3(max.x + offset, min.y - offset, max.z),
      size.z,
      new THREE.Vector3(max.x + offset, min.y - offset * 2, (min.z + max.z) / 2),
      'depth'
    );

    this.createDimensionLine(
      new THREE.Vector3(min.x - offset, min.y, min.z - offset),
      new THREE.Vector3(min.x - offset, max.y, min.z - offset),
      size.y,
      new THREE.Vector3(min.x - offset * 2, (min.y + max.y) / 2, min.z - offset),
      'height'
    );
  }

  createDimensionLine(start, end, sizeValue, textPos, type) {
    this.createDimensionText(sizeValue, textPos, this.state.dimensionLinesGroup);

    const geom = new THREE.BufferGeometry().setFromPoints([start, end]);
    const line = new THREE.Line(geom, this.config.materials.dimensionLine);
    this.state.dimensionLinesGroup.add(line);

    if (type === 'width' || type === 'depth') {
      this.createDimensionHandle(start, `${type}-start`);
      this.createDimensionHandle(end, `${type}-end`);
    }
  }

  createDimensionHandle(position, type) {
    let handleRadius;
    if (window.innerWidth <= 767) {
        handleRadius = 0.05;
    } else {
        handleRadius = 0.03;
    }
    const handleHeight = handleRadius * 2;

    const handleGeometry = new THREE.CylinderGeometry(0, handleRadius, handleHeight, 8);
    const handleMesh = new THREE.Mesh(handleGeometry, this.config.materials.dimensionHandle || this.config.materials.controlPoint);
    handleMesh.position.copy(position);
    const [dimensionType, handlePosition] = type.split('-');
    if (dimensionType === 'width') {
        handleMesh.rotation.z = handlePosition === 'end' ? -Math.PI / 2 : Math.PI / 2;
    } else if (dimensionType === 'depth') {
        handleMesh.rotation.x = handlePosition === 'end' ? Math.PI / 2 : -Math.PI / 2;
    }
    handleMesh.userData = {
        type: 'dimensionHandle',
        dimensionType: dimensionType,
        dimensionHandlePosition: handlePosition
    };
    this.state.dimensionHandles.push(handleMesh);
    this.app.scene.add(handleMesh);
}

  createDimensionText(sizeValue, pos, group) {
    const dimensionMM = (sizeValue * this.config.unitToMm).toFixed(1) + ' mm';
    const texture = Utils.createCanvasTexture(dimensionMM, {
      fontSize: window.innerWidth <= 767 ? 18 : 24,
      color: this.app.cssVars.colorDimensionText,
      padding: window.innerWidth <= 767 ? 3 : 5,
    });
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 1;
    sprite.scale.set(0.2, 0.1, 0.1);
    sprite.position.copy(pos);
    group.add(sprite);
    return sprite;
  }
}


class DynamicBackground extends ModuleBase {
    constructor(app) {
      super(app);
      this.initProperties();
      this.initRenderer();
      this.initShaders();
      this.createScene();
    }

    initProperties() {
      this.container = this.app.DOM.container;
      this.width = this.container.clientWidth;
      this.height = this.container.clientHeight;
      this.clock = this.app.state.clock;
      this.THREE = this.app.THREE;

      this.mouse = new this.THREE.Vector2(0, 0);
      this.targetMouse = new this.THREE.Vector2(0, 0);
      this.mouseSmoothing = 0.05;
    }

    initRenderer() {
      this.scene = new this.THREE.Scene();
      this.camera = new this.THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.renderer = new this.THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
      this.renderer.setSize(this.width, this.height);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      this.container.appendChild(this.renderer.domElement);
      Object.assign(this.renderer.domElement.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        zIndex: '-1',
        pointerEvents: 'none',
      });
    }

    initShaders() {
      this.uniforms = {
        u_resolution: { value: new this.THREE.Vector2(this.width, this.height) },
        u_time: { value: 0.0 },
        u_mouse: { value: this.mouse },
        u_color1: { value: new this.THREE.Color(this.app.cssVars.colorPrimaryLight) },
        u_color2: { value: new this.THREE.Color(this.app.cssVars.colorPrimary) },
        u_color3: { value: new this.THREE.Color(this.app.cssVars.colorPrimaryDark) },
        u_colorStops: { value: [0.1, 0.5, 1.0] },
        u_speed: { value: 0.5 },
        u_colorPreservation: { value: 0.4 },
        u_smoothness: { value: 8 },
      };

      this.material = new this.THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: this.getVertexShader(),
        fragmentShader: this.getFragmentShader(),
        transparent: true,
      });
    }

    getVertexShader() {
      return `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `;
    }

    getFragmentShader() {
        return `
            varying vec2 vUv;
            uniform vec2 u_resolution;
            uniform float u_time;
            uniform vec2 u_mouse;
            uniform vec3 u_color1;
            uniform vec3 u_color2;
            uniform vec3 u_color3;
            uniform float u_colorStops[3];
            uniform float u_speed;
            uniform float u_colorPreservation;
            uniform float u_smoothness;

            float improvedSmoothstep(float edge0, float edge1, float x, float smoothness) {
                x = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
                return pow(x, smoothness) * (smoothness + 1.0) - pow(x, smoothness + 1.0) * smoothness;
            }

            vec2 calculateCornerOffset(float t, float mx, float my, float phase) {
                float offsetX = sin(t + mx + phase) * 0.4;
                float offsetY = cos(t + my + phase) * 0.4;
                return vec2(offsetX, offsetY);
            }

            vec3 calculateWeights(vec2 st, vec2 pos1, vec2 pos2, vec2 pos3) {
                float dist1 = distance(st, pos1);
                float dist2 = distance(st, pos2);
                float dist3 = distance(st, pos3);
                dist1 = 1.0 / (dist1 * dist1 + 0.1);
                dist2 = 1.0 / (dist2 * dist2 + 0.1);
                dist3 = 1.0 / (dist3 * dist3 + 0.1);
                float totalWeight = dist1 + dist2 + dist3;
                if (totalWeight < 0.001) totalWeight = 0.001;
                return vec3(dist1, dist2, dist3) / totalWeight;
            }

            vec3 getGradientColor(float x) {
                vec3 color;
                if (x < u_colorStops[1]) {
                    float t = (x - u_colorStops[0]) / (u_colorStops[1] - u_colorStops[0]);
                    color = mix(u_color1, u_color2, improvedSmoothstep(0.0, 1.0, t, u_smoothness));
                } else {
                    float t = (x - u_colorStops[1]) / (u_colorStops[2] - u_colorStops[1]);
                    color = mix(u_color2, u_color3, improvedSmoothstep(0.0, 1.0, t, u_smoothness));
                }
                return color;
            }

            void main() {
                vec2 st = vUv;
                float t = u_time * u_speed;
                float mx = u_mouse.x * 0.8;
                float my = u_mouse.y * 0.8;
                vec2 offset1 = calculateCornerOffset(t, mx, my, 0.0);
                vec2 offset2 = calculateCornerOffset(t, mx, my, 2.0);
                vec2 offset3 = calculateCornerOffset(t, mx, my, 4.0);
                vec2 pos1 = vec2(0.1, 0.9) + offset1;
                vec2 pos2 = vec2(0.9, 0.1) + offset2;
                vec2 pos3 = vec2(0.1, 0.1) + offset3;
                vec3 weights = calculateWeights(st, pos1, pos2, pos3);
                vec3 gradientColor = getGradientColor(st.x);
                vec3 weightedColor = u_color1 * weights.x + u_color3 * weights.y + u_color2 * weights.z;
                vec3 finalColor = mix(weightedColor, gradientColor, u_colorPreservation);
                float alpha = (weights.x + weights.y + weights.z) / 3.0 * 0.3 + 0.7;
                alpha = clamp(alpha, 0.7, 1.0);
                gl_FragColor = vec4(finalColor, alpha);
            }
        `;
    }

    createScene() {
      const geometry = new this.THREE.PlaneGeometry(2, 2);
      this.quad = new this.THREE.Mesh(geometry, this.material);
      this.scene.add(this.quad);
    }

    handleMouseMove(event) {
      const rect = this.container.getBoundingClientRect();
      this.targetMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.targetMouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    handleResize() {
      this.width = this.container.clientWidth;
      this.height = this.container.clientHeight;
      this.renderer.setSize(this.width, this.height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.uniforms.u_resolution.value.set(this.width, this.height);
    }

    animate() {
      const time = this.clock.getElapsedTime();
      this.uniforms.u_time.value = time;

      this.mouse.lerp(this.targetMouse, this.mouseSmoothing);
      this.uniforms.u_mouse.value.copy(this.mouse);

      this.updateColors();
      this.renderer.render(this.scene, this.camera);
    }

    updateColors() {
      const newC1 = new this.THREE.Color(this.app.cssVars.colorPrimaryLight);
      const newC2 = new this.THREE.Color(this.app.cssVars.colorPrimary);
      const newC3 = new this.THREE.Color(this.app.cssVars.colorPrimaryDark);

      if (!this.uniforms.u_color1.value.equals(newC1)) {
        this.uniforms.u_color1.value.copy(newC1);
      }
      if (!this.uniforms.u_color2.value.equals(newC2)) {
        this.uniforms.u_color2.value.copy(newC2);
      }
      if (!this.uniforms.u_color3.value.equals(newC3)) {
        this.uniforms.u_color3.value.copy(newC3);
      }
    }
  }

class FlowerpotApp {
  constructor() {
    this.THREE = THREE;
    this.animationRequestId = null;
    this.initDOM();
    this.initializeModules();
    this.debounceResize = Utils.debounce(this.handleResize.bind(this), 100);
    this.init();
    this.attachEventListeners();
    this.subtitleAnimator = new SubtitleAnimator();
    this.subtitleAnimator.start();
  }

  initDOM() {
    const get = id => document.getElementById(id);
    this.DOM = {
      canvas: get('threejs-canvas'),
      container: get('canvas-container'),
      buttons: {
        download: get('download-button'),
        addPoint: get('add-point-button'),
        removePoint: get('remove-point-button'),
      },
      controls: {
        tension: get('tension-slider'),
        curveType: get('curve-type'),
        filletRadius: get('fillet-radius'),
        filletControls: get('fillet-controls'),
        baseFilletRadius: get('base-fillet-radius'),
        widthSlider: get('width-slider'),
        depthSlider: get('depth-slider'),
        wallThicknessSlider: get('wall-thickness-slider'),
        drainageHoleScaleSlider: get('drainage-hole-scale-slider'),
      },
      valueDisplays: {
        baseFilletRadius: get('base-fillet-radius-value'),
        wallThickness: get('wall-thickness-value'),
        drainageHoleScale: get('drainage-hole-scale-value'),
        width: get('width-value'),
        depth: get('depth-value'),
        tension: get('tension-value'),
        filletRadius: get('fillet-radius-value'),
      },
      logoButton: get('logo-button'),
      introText: get('intro-text'),
      closeIntro: document.querySelector('.close-intro'),
      ctaButton: document.querySelector('.cta-button'),
      settingsButton: get('settings-button'),
      sidebar: document.querySelector('.sidebar'),
    };
  }

  initializeModules() {
    this.configurationManager = new ConfigurationManager(this);
    this.stateManager = new StateManager(this);
    this.sceneManager = new SceneManager(this);
    this.inputManager = new InputManager(this);
    this.renderManager = new RenderManager(this);
    this.exportManager = new ExportManager(this);
    this.resourceManager = new ResourceManager(this);
    this.geometryModule = new GeometryModule(this);
    this.dimensionModule = new DimensionModule(this);
    this.uiController = new UIController(this);
    this.dynamicBackground = new DynamicBackground(this);
  }

  init() {
    this.createControlPointMeshes();
    this.generateFlowerpot();
    this.renderManager.startAnimation();
  }

  attachEventListeners() {
    window.addEventListener('resize', this.debounceResize);
    window.addEventListener('mousemove', this.dynamicBackground.handleMouseMove.bind(this.dynamicBackground));
  }

  detachEventListeners() {
    window.removeEventListener('resize', this.debounceResize);
    window.removeEventListener('mousemove', this.dynamicBackground.handleMouseMove.bind(this.dynamicBackground));
  }

  scaleX(x) {
    return x * this.config.dimensions.width;
  }

  updateLine(line, pts, material) {
    if (line) {
      if (line.geometry.attributes.position.count === pts.length) {
        line.geometry.setFromPoints(pts);
        line.geometry.attributes.position.needsUpdate = true;
      } else {
        line.geometry.dispose();
        line.geometry = new this.THREE.BufferGeometry().setFromPoints(pts);
      }
      line.material = material;
    } else {
      const geo = new this.THREE.BufferGeometry().setFromPoints(pts);
      line = new this.THREE.Line(geo, material);
      this.scene.add(line);
    }
    return line;
  }

  createControlPointMeshes() {
    const radius = window.innerWidth <= 767 ? 0.05 : 0.03;
    const pointGeometry = new this.THREE.SphereGeometry(radius, 16, 16);

    this.state.controlPoints.forEach((pt, i) => {
      const mesh = new this.THREE.Mesh(pointGeometry, this.config.materials.controlPoint);
      mesh.position.set(this.scaleX(pt.x), pt.y, 0);
      mesh.userData = { index: i, type: 'controlPoint' };
      mesh.visible = this.config.display.showControlPoints;
      this.state.controlPointMeshes.push(mesh);
      this.state.controlPointsGroup.add(mesh);
    });

    const linePoints = this.state.controlPointMeshes.map(m => m.position);
    let lineMesh = this.state.controlPointsGroup.children.find(child => child instanceof this.THREE.Line);
    lineMesh = this.updateLine(lineMesh, linePoints, this.config.materials.controlLine);
    if (lineMesh) {
        lineMesh.visible = this.config.display.showControlPoints;
        if (!this.state.controlPointsGroup.children.includes(lineMesh)) {
            this.state.controlPointsGroup.add(lineMesh);
        }
    }
  }


  updateControlLinesAndCurve() {
    const pts = this.state.controlPointMeshes.map(m => m.position);
    let lineMesh = this.state.controlPointsGroup.children.find(child => child instanceof this.THREE.Line);
    lineMesh = this.updateLine(lineMesh, pts, this.config.materials.controlLine);
    if (lineMesh) {
        lineMesh.visible = this.config.display.showControlPoints;
        if (!this.state.controlPointsGroup.children.includes(lineMesh)) {
            this.state.controlPointsGroup.add(lineMesh);
        }
    }
    this.updateCurveLine();
  }

  updateCurveLine() {
    const pts = this.geometryModule.getCurvePoints().map(p => new this.THREE.Vector3(this.scaleX(p.x), p.y, 0));
    this.state.curveLine = this.updateLine(this.state.curveLine, pts, this.config.materials.curveLine);
  }

  generateFlowerpot() {
    this.resourceManager.cleanupPreviousMeshes();

    const baseShape = this.geometryModule.createRoundedRect(0, 0, 1.0, 1.0, this.config.base.filletRadius);
    const basePts = baseShape.getPoints(this.config.curve.segments);

    const curvePts = this.geometryModule.getCurvePoints();
    if (curvePts.length < 2) {
        console.error("Not enough curve points to generate geometry.");
        return;
    }

    let minY = Infinity, maxY = -Infinity;
    curvePts.forEach(p => { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
    this.state.minY = minY;

    const { vertices, faces } = this.geometryModule.generateThickFlowerpotGeometry(
        basePts,
        curvePts,
        minY,
        maxY - minY,
        this.config.curve.wallThickness
    );

    const geometry = new this.THREE.BufferGeometry();
    geometry.setAttribute('position', new this.THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(faces);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();

    geometry.scale(this.config.dimensions.width, 1, this.config.dimensions.depth);
    geometry.computeBoundingBox();

    this.state.flowerpotMesh = new this.THREE.Mesh(geometry, this.config.materials.pot);
    this.state.flowerpotMesh.castShadow = true;
    this.state.flowerpotMesh.receiveShadow = true;
    this.scene.add(this.state.flowerpotMesh);

    this.createControlPointMeshes();
    this.updateControlLinesAndCurve();

    this.dimensionModule.createBoundingBoxAndDimensions();

    this.uiController.updateDimensionDisplays();
  }


  addControlPoint() {
    if (this.state.controlPoints.length >= 10) return;
    const last = this.state.controlPoints[this.state.controlPoints.length - 1];
    const newPt = last.clone().add(new this.THREE.Vector2(0.1, 0.1));
    newPt.x = Utils.clamp(newPt.x, 0.01, 1);
    newPt.y = Utils.clamp(newPt.y, 0, 3);
    this.state.controlPoints.push(newPt);
    this.generateFlowerpot();
  }

  removeControlPoint() {
    if (this.state.controlPoints.length > 2) {
      this.state.controlPoints.pop();
      this.generateFlowerpot();
    }
  }

  handleResize() {
    this.sceneManager.handleResize();
    this.dynamicBackground.handleResize();
    this.generateFlowerpot();
  }

  destroy() {
    this.detachEventListeners();
    this.uiController.destroy();
    if (this.animationRequestId) cancelAnimationFrame(this.animationRequestId);
    this.renderManager.animate = () => {};

    this.resourceManager.cleanupPreviousMeshes();


    if (this.app.renderer) {
      this.app.renderer.dispose();
      this.app.renderer.forceContextLoss();
    }
    if (this.dynamicBackground.renderer) {
        this.dynamicBackground.renderer.dispose();
        this.dynamicBackground.renderer.forceContextLoss();
        if (this.dynamicBackground.renderer.domElement.parentNode) {
            this.dynamicBackground.renderer.domElement.parentNode.removeChild(this.dynamicBackground.renderer.domElement);
        }
    }

    if (this.DOM.canvas && this.DOM.canvas.parentNode) {
      this.DOM.canvas.parentNode.removeChild(this.DOM.canvas);
    }

    this.app = null;
    this.THREE = null;
  }
}

new FlowerpotApp();