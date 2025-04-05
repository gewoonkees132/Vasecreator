import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.175.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.175.0/examples/jsm/controls/OrbitControls.js';
import { OBJExporter } from 'https://cdn.jsdelivr.net/npm/three@0.175.0/examples/jsm/exporters/OBJExporter.js';


function checkWebGLSupport() {
    try {
        const canvas = document.createElement('canvas');

        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        return !!(gl && gl instanceof WebGLRenderingContext);
    } catch (e) {
        return false;
    }
}

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
      const { fontSize = 30, fontFamily = 'Inter, sans-serif', color = '#000', padding = 5 } = options;
      const cacheKey = `${text}-${fontSize}-${fontFamily}-${color}-${padding}`;
      if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const textFont = `${fontSize}px ${fontFamily}`;
      ctx.font = textFont;
      const textWidth = ctx.measureText(text).width;
      const canvasWidth = textWidth + padding * 2;
      const canvasHeight = fontSize * 24 + padding;
      const pixelRatio = Math.min(window.devicePixelRatio, 1);
      canvas.width = canvasWidth * pixelRatio;
      canvas.height = canvasHeight * pixelRatio;
      ctx.scale(pixelRatio, pixelRatio);
      ctx.font = textFont;
      ctx.fillStyle = "--colorText";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, canvasWidth / 2, canvasHeight / 2);
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      textureCache.set(cacheKey, texture);
      return texture;
    };
  })(),
  disposeObject3D: (object) => {
    if (!object) return;
    if (object.geometry) {
      object.geometry.dispose();
    }
    if (object.material) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => {
        Object.keys(material).forEach(key => {
          const value = material[key];
          if (value && typeof value === 'object' && value.isTexture) {
            value.dispose();
          }
        });
        material.dispose();
      });
    }
    if (object.children) {

      for (let i = object.children.length - 1; i >= 0; i--) {
        Utils.disposeObject3D(object.children[i]);
      }
    }
  }
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
    this.listeners = [];
  }

  addEventListener(element, type, handler) {
    const eventName = this.eventMap[type];
    const boundHandler = (event) => handler(this.normalizeEvent(event));

    const options = (type === 'start' || type === 'move') ? { passive: false } : { passive: true };

    element.addEventListener(eventName, boundHandler, options);
    this.listeners.push({ element, eventName, boundHandler, options });
  }

  normalizeEvent(event) {
    if (this.isTouchDevice && event.touches) {
      const touch = event.type === 'touchend' ? event.changedTouches[0] : event.touches[0];
      if (touch) {
        return {
          clientX: touch.clientX,
          clientY: touch.clientY,
          preventDefault: () => event.preventDefault(),
          identifier: touch.identifier
        };
      } else {

        return { clientX: 0, clientY: 0, preventDefault: () => {}, identifier: null };
      }
    }

    return {
        clientX: event.clientX,
        clientY: event.clientY,
        preventDefault: () => event.preventDefault(),
        identifier: -1
    };
  }

  removeAllListeners() {
    this.listeners.forEach(({ element, eventName, boundHandler, options }) => {
      element.removeEventListener(eventName, boundHandler, options);
    });
    this.listeners = [];
  }
}


class SubtitleAnimator {
  constructor() {
    this.subtitles = ["Your Vase.", "Your Design.", "Create it.", "A vase for every style"];
    this.element = document.getElementById('subtitle');
    this.subtitleIndex = 0;
    if (this.element) this.element.style.transition = 'opacity 0.6s ease-in-out';
    this.timeoutId1 = null;
    this.timeoutId2 = null;
  }

  animate() {
    if (!this.element || document.hidden) return;
    this.element.style.opacity = 0;
    clearTimeout(this.timeoutId1);
    clearTimeout(this.timeoutId2);

    this.timeoutId1 = setTimeout(() => {
      if (!this.element || document.hidden) return;
      this.element.textContent = this.subtitles[this.subtitleIndex];
      this.element.style.opacity = 1;

      this.timeoutId2 = setTimeout(() => {
        if (document.hidden) return;
        this.subtitleIndex = (this.subtitleIndex + 1) % this.subtitles.length;
        this.animate();
      }, 2000);
    }, 600);
  }

  start() {
    this.animate();
  }

  stop() {
      clearTimeout(this.timeoutId1);
      clearTimeout(this.timeoutId2);


  }
}


class ConfigurationManager extends ModuleBase {
  constructor(app) {
    super(app);
    this.fetchCSSVariables();
    this.createMaterials();
    this.initConfig();
  }

  fetchCSSVariables() {
    const rootStyles = getComputedStyle(document.documentElement);
    const getCSS = (variable) => {
      let color = rootStyles.getPropertyValue(variable).trim();

      if (color.startsWith('rgba')) {

          color = color.replace(/rgba?\(/, 'rgb(').replace(/,\s*[\d.]+\)$/, ')');
      }
      return color || '#ff00ff';
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
      colorControlPoint: getCSS('--color-control-point'),
      colorControlLine: getCSS('--color-control-line'),
      colorHover: getCSS('--color-hover'),
      colorDimensionLine: getCSS('--color-dimension-line'),
      colorDimensionText: getCSS('--color-dimension-text'),
      colorCurveLine: getCSS('--color-curve-line'),
      colorBoundingBox: getCSS('--color-bounding-box'),
      colorCanvasBackground: getCSS('--color-background'),
      dimensionHandle: getCSS('--color-dimension-handle'),
      dimensionHandleHover: getCSS('--color-dimension-handle-hover'),
    };
  }

  createMaterial(type, options = {}) {
      const MaterialClass = this.THREE[type];
      if (!MaterialClass) {
          console.warn(`Material type "${type}" not found in THREE. Using MeshBasicMaterial as fallback.`);
          return new this.THREE.MeshBasicMaterial({ color: 0xff00ff });
      }
      return new MaterialClass(options);
  }

  createMaterials() {
    const css = this.app.cssVars;
    this.app.materials = {
      pot: this.createMaterial('MeshStandardMaterial', { color: css.colorPrimary, side: THREE.DoubleSide }),
      controlPoint: this.createMaterial('MeshBasicMaterial', { color: css.colorControlPoint, depthTest: false }),
      controlLine: this.createMaterial('LineBasicMaterial', { color: css.colorControlLine, depthTest: false }),
      hover: this.createMaterial('MeshBasicMaterial', { color: css.colorHover, depthTest: false }),
      curveLine: this.createMaterial('LineBasicMaterial', { color: css.colorCurveLine, depthTest: false }),
      boundingBox: this.createMaterial('LineBasicMaterial', { color: css.colorBoundingBox }),
      dimensionLine: this.createMaterial('LineBasicMaterial', { color: css.colorDimensionLine, depthTest: false }),
      dimensionHandle: this.createMaterial('MeshBasicMaterial', { color: css.dimensionHandle, depthTest: false }),
      dimensionHandleHover: this.createMaterial('MeshBasicMaterial', { color: css.dimensionHandleHover, depthTest: false }),
    };
  }

  initConfig() {
    this.app.config = {

      curve: { tension: 0.5, type: 'spline', filletRadius: 0.5, segments: 20, heightSegments: 60, wallThickness: 0.04 },
      base: { filletRadius: 0.8 },
      dimensions: { width: 1, depth: 1 },
      drainageHoleScale: 0.5,
      materials: this.app.materials,
      display: { showProfilePlane: false, showControlPoints: true, showGrid: true, showBoundingBox: true },
      unitToMm: 50,
    };
  }

  setConfigValue(path, value) {
    const parts = path.split('.');
    const key = parts.pop();
    let target = this.app.config;
    try {

        for (const k of parts) {
            if (!target[k]) target[k] = {};
            target = target[k];
        }
        const currentValue = target[key];

        if (typeof currentValue === 'number' && typeof value === 'string') {
            const parsedValue = parseFloat(value);
            if (!isNaN(parsedValue)) {
                value = parsedValue;
            } else {
                 console.warn(`setConfigValue: Could not parse string "${value}" as number for key "${key}"`);
                 return;
            }
        } else if (typeof currentValue === 'boolean' && typeof value !== 'boolean') {

             value = Boolean(value);
        }

        target[key] = value;
    } catch (error) {

        console.error(`setConfigValue failed for path "${path}":`, error);
    }
  }
}


class StateManager extends ModuleBase {
  constructor(app) {
    super(app);
    this.initState();
  }

  initState() {

    const initialControlPoints = [
      new this.THREE.Vector2(0.1, 0.0),
      new this.THREE.Vector2(0.22, 0.2),
      new this.THREE.Vector2(0.3, 0.5),
      new this.THREE.Vector2(0.2, 0.8),
      new this.THREE.Vector2(0.3, 1.0),
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
      minY: 0,
      lastVerticalOffset: 0,
      clock: new this.THREE.Clock(),
    };

    this.app.state.controlPointsGroup.name = "ControlPointsGroup";
    this.app.state.dimensionLinesGroup.name = "DimensionLinesGroup";
  }
}


class SceneManager extends ModuleBase {
  constructor(app) {
    super(app);
    this.initScene();
    this.setupLights();
  }

  initScene() {
    const { container, canvas } = this.app.DOM;
    if (!container || !canvas) {

        console.error("SceneManager: Canvas container or canvas element not found!");
        return;
    }
    const clientWidth = container.clientWidth;
    const clientHeight = container.clientHeight;


    this.app.scene = new this.THREE.Scene();
    this.app.scene.background = null;


    this.app.camera = new this.THREE.PerspectiveCamera(65, clientWidth / clientHeight, 0.1, 100);
    this.app.camera.position.set(1.2, 1.2, -1.2);


    this.app.renderer = new this.THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });

    this.app.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.app.renderer.setSize(clientWidth, clientHeight);


    this.app.renderer.outputColorSpace = this.THREE.SRGBColorSpace;
    this.app.renderer.toneMapping = this.THREE.ACESFilmicToneMapping;
    this.app.renderer.toneMappingExposure = 1.5;


    this.app.renderer.shadowMap.enabled = true;
    this.app.renderer.shadowMap.type = this.THREE.PCFSoftShadowMap;


    this.app.controls = new OrbitControls(this.app.camera, this.app.renderer.domElement);
    Object.assign(this.app.controls, {
      enableDamping: true,
      dampingFactor: 0.05,
      screenSpacePanning: true,
      minDistance: 0.5,
      maxDistance: 15,
      maxPolarAngle: Math.PI / 1.9,
      rotateSpeed: 0.8,
    });
    this.app.controls.target.set(0, 0.5, 0);
    this.app.controls.update();


    this.app.scene.add(this.app.state.controlPointsGroup);
    this.app.scene.add(this.app.state.dimensionLinesGroup);


    const gridColor = new THREE.Color(this.app.cssVars.colorTextSecondary);
    const gridCenterLineColor = new THREE.Color(this.app.cssVars.colorBorder);
    this.app.gridHelper = new this.THREE.GridHelper(2, 50, gridCenterLineColor, gridColor);
    this.app.gridHelper.material.opacity = 0.20;
    this.app.gridHelper.material.transparent = true;
    this.app.gridHelper.visible = this.app.config.display.showGrid;
    this.app.gridHelper.renderOrder = -1;
    this.app.scene.add(this.app.gridHelper);
  }

  setupLights() {
    const { cssVars, scene } = this.app;
    const lightColor = new THREE.Color(cssVars.colorPrimaryLight);
    const ambientColor = new THREE.Color(cssVars.colorSurface);
    const groundColor = new THREE.Color(cssVars.colorBackground);


    this.app.ambientLight = this.app.ambientLight || new this.THREE.AmbientLight(ambientColor, 2.0);
    if (!scene.getObjectByName("ambientLight")) {
        this.app.ambientLight.name = "ambientLight";
        scene.add(this.app.ambientLight);
    }
    this.app.ambientLight.color.set(ambientColor);
    this.app.ambientLight.intensity = 2.0;


    this.app.mainLight = this.app.mainLight || new this.THREE.DirectionalLight(lightColor, 8.0);
    if (!scene.getObjectByName("mainLight")) {
        this.app.mainLight.name = "mainLight";
        scene.add(this.app.mainLight);
    }
    this.app.mainLight.position.set(2, 3, 2);
    this.app.mainLight.color.set(lightColor);
    this.app.mainLight.intensity = 10.0;
    this.app.mainLight.castShadow = true;

    this.app.mainLight.shadow.mapSize.width = 512;
    this.app.mainLight.shadow.mapSize.height = 512;
    this.app.mainLight.shadow.camera.near = 0.1;
    this.app.mainLight.shadow.camera.far = 10;
    this.app.mainLight.shadow.bias = -0.002;


    this.app.hemiLight = this.app.hemiLight || new THREE.HemisphereLight(ambientColor, groundColor, 0.9);
    if (!scene.getObjectByName("hemiLight")) {
        this.app.hemiLight.name = "hemiLight";
        scene.add(this.app.hemiLight);
    }
    this.app.hemiLight.color.set(ambientColor);
    this.app.hemiLight.groundColor.set(groundColor);
    this.app.hemiLight.intensity = 0.9;
  }

  handleResize() {
    const { container } = this.app.DOM;
    if (!container) return;
    const clientWidth = container.clientWidth;
    const clientHeight = container.clientHeight;


    this.app.camera.aspect = clientWidth / clientHeight;
    this.app.camera.updateProjectionMatrix();


    this.app.renderer.setSize(clientWidth, clientHeight);
    this.app.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  setGridVisible(visible) {
      if (this.app.gridHelper) {
          this.app.gridHelper.visible = visible;
      }
      this.app.config.display.showGrid = visible;
  }
}


class InputManager extends ModuleBase {
  constructor(app) {
    super(app);
    this.eventHandler = new UnifiedEventHandler(app);
    this.mousePosition = new this.THREE.Vector2();
    this.planeIntersectionPoint = new this.THREE.Vector3();
    this.dragOffset = new this.THREE.Vector3();

    this.interactionPlane = new this.THREE.Plane(new this.THREE.Vector3(0, 0, 1), 0);

    this.groundPlane = new this.THREE.Plane(new this.THREE.Vector3(0, 1, 0), 0);
    this.lastClientX = 0;
    this.lastClientY = 0;
    this.setupEventListeners();
  }

  setupEventListeners() {
    const domEl = this.app.renderer.domElement;
    this.eventHandler.addEventListener(domEl, 'start', this.onStart.bind(this));
    this.eventHandler.addEventListener(window, 'move', this.onMove.bind(this));
    this.eventHandler.addEventListener(window, 'end', this.onEnd.bind(this));
  }

  updateMousePosition(event) {
      this.lastClientX = event.clientX;
      this.lastClientY = event.clientY;
      const rect = this.app.renderer.domElement.getBoundingClientRect();

      this.mousePosition.set(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
  }

  getIntersection(objects) {
    this.state.raycaster.setFromCamera(this.mousePosition, this.app.camera);

    const visibleObjects = objects.filter(obj => obj.visible && obj.parent?.visible);
    return this.state.raycaster.intersectObjects(visibleObjects, false);
  }

  getPlaneIntersection(plane, targetVector) {
    this.state.raycaster.setFromCamera(this.mousePosition, this.app.camera);

    return this.state.raycaster.ray.intersectPlane(plane, targetVector);
  }

  onStart(event) {
    this.updateMousePosition(event);

    const interactables = [
        ...(this.config.display.showControlPoints ? this.state.controlPointMeshes : []),
        ...this.state.dimensionHandles
    ];
    const hits = this.getIntersection(interactables);

    if (hits.length > 0) {
      const hitObject = hits[0].object;
      let handled = false;


      if (hitObject.userData.type === 'controlPoint' && this.config.display.showControlPoints) {
        event.preventDefault();
        this.state.draggingPoint = hitObject;
        this.app.controls.enabled = false;
        document.body.style.cursor = 'grabbing';


        if (this.getPlaneIntersection(this.interactionPlane, this.planeIntersectionPoint)) {
             this.dragOffset.subVectors(hitObject.position, this.planeIntersectionPoint);
        } else {
             this.dragOffset.set(0,0,0);
        }

        const originalScale = hitObject.userData.originalScale || 1;
        hitObject.userData.originalScale = originalScale;
        this.animateScale(hitObject, originalScale * 1.3);
        handled = true;
      }

      else if (hitObject.userData.type === 'dimensionHandle') {
        event.preventDefault();
        this.state.draggingDimensionHandle = hitObject;
        this.state.dimensionTypeDragging = hitObject.userData.dimensionType;
        this.app.controls.enabled = false;

        document.body.style.cursor = hitObject.userData.dimensionType === 'width' ? 'ew-resize' : 'ns-resize';

        this.groundPlane.constant = this.state.lastVerticalOffset;

        if (this.getPlaneIntersection(this.groundPlane, this.planeIntersectionPoint)) {
            this.dragOffset.subVectors(hitObject.position, this.planeIntersectionPoint);
        } else {
             this.dragOffset.set(0,0,0);
        }

        hitObject.material = this.config.materials.dimensionHandleHover;
        handled = true;
      }

    }
  }

  onMove(event) {
    this.updateMousePosition(event);

    if (this.state.draggingPoint) {
      event.preventDefault();
      this.handleControlPointDrag();
    } else if (this.state.draggingDimensionHandle) {
      event.preventDefault();
      this.handleDimensionHandleDrag();
    } else {

      this.updateHoverStates();
    }
  }

  onEnd() {
    let wasDragging = false;


    if (this.state.draggingPoint) {
      if (this.state.draggingPoint.userData.originalScale) {

           this.animateScale(this.state.draggingPoint, this.state.draggingPoint.userData.originalScale);
      }
      this.state.draggingPoint = null;
      wasDragging = true;
    }


    if (this.state.draggingDimensionHandle) {

      if (this.state.dimensionHandleHovered !== this.state.draggingDimensionHandle) {
           this.state.draggingDimensionHandle.material = this.config.materials.dimensionHandle;
      }
      this.state.draggingDimensionHandle = null;
      this.state.dimensionTypeDragging = null;
      wasDragging = true;
    }


    if (wasDragging) {
      this.app.controls.enabled = true;

      this.updateMousePosition({ clientX: this.lastClientX, clientY: this.lastClientY });
      this.updateHoverStates();

       if (!this.state.hoveredPoint && !this.state.dimensionHandleHovered) {
            document.body.style.cursor = 'default';
       }
    }
  }

  handleControlPointDrag() {

    if (!this.getPlaneIntersection(this.interactionPlane, this.planeIntersectionPoint)) return;

    const index = this.state.draggingPoint.userData.index;

    if (index === undefined || index < 0 || index >= this.state.controlPoints.length) {
        console.error("Dragging point has invalid index:", index);
        return;
    }


    const targetPos = this.planeIntersectionPoint.add(this.dragOffset);

    const targetVisualX = Utils.clamp(targetPos.x, 0.01 * this.config.dimensions.width, 1.5 * this.config.dimensions.width);

    const targetVisualY = Utils.clamp(targetPos.y, 0, 3);

    const finalVisualY = index === 0 ? 0 : targetVisualY;


    this.state.controlPoints[index].set(targetVisualX / this.config.dimensions.width, finalVisualY);

    this.state.draggingPoint.position.set(targetVisualX, finalVisualY, 0);


    this.app.updateControlPointVisuals();
    this.app.generateFlowerpot();
  }


  handleDimensionHandleDrag() {

    this.groundPlane.constant = this.state.lastVerticalOffset;

    if (!this.getPlaneIntersection(this.groundPlane, this.planeIntersectionPoint)) return;


    const targetPos = this.planeIntersectionPoint.add(this.dragOffset);
    let needsUpdate = false;

    const MIN_DIM = 0.1;
    const MAX_DIM = 3.0;

    if (this.state.dimensionTypeDragging === 'width') {
        const handlePosition = this.state.draggingDimensionHandle.userData.handlePosition;
        const currentWidth = this.config.dimensions.width;
        let desiredHandleX = targetPos.x;
        let newWidth;


        if (handlePosition === 'end') {
            newWidth = Math.max(MIN_DIM, desiredHandleX * 2);
        } else {
            newWidth = Math.max(MIN_DIM, -desiredHandleX * 2);
        }
        newWidth = Utils.clamp(newWidth, MIN_DIM, MAX_DIM);


        if (Math.abs(newWidth - currentWidth) > 0.001) {
          this.app.configurationManager.setConfigValue('dimensions.width', newWidth);

          if (this.app.DOM.controls.widthSlider) {
               this.app.DOM.controls.widthSlider.value = newWidth;

               this.app.uiController.updateSliderDisplay(this.app.DOM.controls.widthSlider, this.app.DOM.valueDisplays.width, () => this.app.uiController.getFormattedDimension('x'));
          }
          needsUpdate = true;
      }
    } else if (this.state.dimensionTypeDragging === 'depth') {
        const handlePosition = this.state.draggingDimensionHandle.userData.handlePosition;
        const currentDepth = this.config.dimensions.depth;
        let desiredHandleZ = targetPos.z;
        let newDepth;


        if (handlePosition === 'end') {
            newDepth = Math.max(MIN_DIM, desiredHandleZ * 2);
        } else {
            newDepth = Math.max(MIN_DIM, -desiredHandleZ * 2);
        }
        newDepth = Utils.clamp(newDepth, MIN_DIM, MAX_DIM);


        if (Math.abs(newDepth - currentDepth) > 0.001) {
          this.app.configurationManager.setConfigValue('dimensions.depth', newDepth);

          if (this.app.DOM.controls.depthSlider) {
              this.app.DOM.controls.depthSlider.value = newDepth;

              this.app.uiController.updateSliderDisplay(this.app.DOM.controls.depthSlider, this.app.DOM.valueDisplays.depth, () => this.app.uiController.getFormattedDimension('z'));
          }
          needsUpdate = true;
      }
    }


    if (needsUpdate) {
        this.app.generateFlowerpot();
    }
  }

  updateHoverStates() {

      const interactables = [
          ...(this.config.display.showControlPoints ? this.state.controlPointMeshes : []),
          ...this.state.dimensionHandles
      ].filter(obj => obj.visible && obj.parent?.visible);

      const intersects = this.getIntersection(interactables);
      let currentHoverObject = intersects.length > 0 ? intersects[0].object : null;
      let isHoveringSomething = false;


      const previousHoveredPoint = this.state.hoveredPoint;
      let nextHoveredPoint = null;

      if (currentHoverObject && currentHoverObject.userData.type === 'controlPoint') {
          isHoveringSomething = true;
          nextHoveredPoint = currentHoverObject;
          document.body.style.cursor = 'grab';
      }


      if (previousHoveredPoint && previousHoveredPoint !== nextHoveredPoint) {
          previousHoveredPoint.scale.setScalar(previousHoveredPoint.userData.originalScale || 1);
          previousHoveredPoint.material = this.config.materials.controlPoint;
      }


      if (nextHoveredPoint && nextHoveredPoint !== previousHoveredPoint) {
          const originalScale = nextHoveredPoint.userData.originalScale || 1;
          nextHoveredPoint.userData.originalScale = originalScale;
          nextHoveredPoint.scale.setScalar(originalScale * 1.1);
          nextHoveredPoint.material = this.config.materials.hover;
      }
      this.state.hoveredPoint = nextHoveredPoint;


      const previousHoveredHandle = this.state.dimensionHandleHovered;
      let nextHoveredHandle = null;

      if (currentHoverObject && currentHoverObject.userData.type === 'dimensionHandle') {
          isHoveringSomething = true;
          nextHoveredHandle = currentHoverObject;

          document.body.style.cursor = nextHoveredHandle.userData.dimensionType === 'width' ? 'ew-resize' : 'ns-resize';
      }


      if (previousHoveredHandle && previousHoveredHandle !== nextHoveredHandle && previousHoveredHandle !== this.state.draggingDimensionHandle) {
          previousHoveredHandle.material = this.config.materials.dimensionHandle;
      }


      if (nextHoveredHandle && nextHoveredHandle !== previousHoveredHandle && nextHoveredHandle !== this.state.draggingDimensionHandle) {
          nextHoveredHandle.material = this.config.materials.dimensionHandleHover;
      }
      this.state.dimensionHandleHovered = nextHoveredHandle;


      if (!isHoveringSomething && !this.state.draggingPoint && !this.state.draggingDimensionHandle) {
          document.body.style.cursor = 'default';
      }
  }


  animateScale(point, targetScale, onComplete = null) {
    const startScale = point.scale.x;
    const duration = 150;
    const startTime = performance.now();


    if (point.userData.animationFrameId) {
        cancelAnimationFrame(point.userData.animationFrameId);
        point.userData.animationFrameId = null;
    }

    const animateStep = (currentTime) => {
      const elapsed = currentTime - startTime;
      let progress = Math.min(elapsed / duration, 1);

      progress = 1 - Math.pow(1 - progress, 3);
      const currentScale = Utils.lerp(startScale, targetScale, progress);

      point.scale.setScalar(currentScale);

      if (progress < 1) {

        point.userData.animationFrameId = requestAnimationFrame(animateStep);
      } else {

        point.userData.animationFrameId = null;
        if (onComplete) {
          onComplete();
        }
      }
    };


    point.userData.animationFrameId = requestAnimationFrame(animateStep);
  }


  destroy() {
    this.eventHandler.removeAllListeners();

    this.state.controlPointMeshes.forEach(mesh => {
        if (mesh.userData.animationFrameId) {
            cancelAnimationFrame(mesh.userData.animationFrameId);
        }
    });

    document.body.style.cursor = 'default';
  }
}


class RenderManager extends ModuleBase {
  constructor(app) {
    super(app);
    this.animate = this.animate.bind(this);
  }

  startAnimation() {

    if (this.app.animationRequestId) return;
    this.app.animationRequestId = requestAnimationFrame(this.animate);
  }

  stopAnimation() {
      if (this.app.animationRequestId) {
          cancelAnimationFrame(this.app.animationRequestId);
          this.app.animationRequestId = null;
      }
  }

  animate() {

    this.app.animationRequestId = requestAnimationFrame(this.animate);


    if (!document.hidden) {

        this.app.controls.update();

        if (this.app.dynamicBackground && typeof this.app.dynamicBackground.animate === 'function') {
            this.app.dynamicBackground.animate();
        }

        this.app.renderer.render(this.app.scene, this.app.camera);
    }
  }
}


class ExportManager extends ModuleBase {
  exportToObj() {
    try {

      if (!this.app.state.flowerpotMesh || !this.app.state.flowerpotMesh.geometry) {
        throw new Error('Flowerpot mesh or geometry is not available for export.');
      }


      const exportMesh = this.app.state.flowerpotMesh.clone();
      exportMesh.geometry = this.app.state.flowerpotMesh.geometry.clone();


      const scaleFactor = this.app.config.unitToMm || 1;
      const scaleMatrix = new this.THREE.Matrix4().makeScale(scaleFactor, scaleFactor, scaleFactor);

      const rotationMatrix = new this.THREE.Matrix4().makeRotationX(Math.PI / 2);

      const finalMatrix = new this.THREE.Matrix4().multiplyMatrices(rotationMatrix, scaleMatrix);


      exportMesh.geometry.applyMatrix4(finalMatrix);

      exportMesh.geometry.computeBoundingBox();
      exportMesh.geometry.computeBoundingSphere();


      const exporter = new OBJExporter();
      const result = exporter.parse(exportMesh);


      const blob = new Blob([result], { type: 'model/obj' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'flowerpot.obj';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 100);



    } catch (error) {
      console.error('OBJ Export failed:', error);

      alert(`Failed to export OBJ file: ${error.message || 'Unknown error'}`);
    }
  }
}


class ResourceManager extends ModuleBase {
  cleanupObjectResources(object) {

      Utils.disposeObject3D(object);
  }


  cleanupPreviousMeshes() {
    const { scene, state } = this.app;


    if (state.flowerpotMesh) {
      scene.remove(state.flowerpotMesh);
      this.cleanupObjectResources(state.flowerpotMesh);
      state.flowerpotMesh = null;
    }


    if (state.boundingBoxHelper) {
      scene.remove(state.boundingBoxHelper);

      state.boundingBoxHelper = null;
    }


    Utils.disposeObject3D(state.dimensionLinesGroup);
    state.dimensionLinesGroup.clear();


    state.dimensionHandles.forEach(handle => {
      scene.remove(handle);
      this.cleanupObjectResources(handle);
    });
    state.dimensionHandles = [];


    Utils.disposeObject3D(state.controlPointsGroup);
    state.controlPointsGroup.clear();
    state.controlPointMeshes = [];


    if (state.curveLine) {
      scene.remove(state.curveLine);
      this.cleanupObjectResources(state.curveLine);
      state.curveLine = null;
    }
  }


  disposeAll() {
      this.cleanupPreviousMeshes();


      if (this.app.dimensionModule && this.app.dimensionModule.handleGeometry) {
          this.app.dimensionModule.handleGeometry.dispose();
          this.app.dimensionModule.handleGeometry = null;
      }

      if (this.app.flowerpotApp && this.app.flowerpotApp.pointGeometry) {
           this.app.flowerpotApp.pointGeometry.dispose();
           this.app.flowerpotApp.pointGeometry = null;
       }


       if (Utils.textureCache && Utils.textureCache.size > 0) {
            Utils.textureCache.forEach(texture => texture.dispose());
            Utils.textureCache.clear();
       }


      if (this.app.config && this.app.config.materials) {
          Object.values(this.app.config.materials).forEach(material => {
              if (material && typeof material.dispose === 'function') {
                  material.dispose();
              }
          });
          this.app.config.materials = {};
      }


       if (this.app.dimensionModule && this.app.dimensionModule.dimensionTextMaterialCache) {
            this.app.dimensionModule.dimensionTextMaterialCache.forEach(material => {
                if (material && typeof material.dispose === 'function') {
                     material.dispose();
                }
            });
            this.app.dimensionModule.dimensionTextMaterialCache.clear();
       }
  }
}


class UIController extends ModuleBase {
  constructor(app) {
    super(app);
    this.setupUIEventListeners();
    this.setupToggleListeners();
    this.updateAllValueDisplays();
  }

  setupUIEventListeners() {
    const DOM = this.app.DOM;
    const config = this.app.config;

    const sliderConfigs = [
      { element: DOM.controls.baseFilletRadius, prop: 'base.filletRadius', display: DOM.valueDisplays.baseFilletRadius, format: v => `${Math.round(v * 100)}%` },
      { element: DOM.controls.wallThicknessSlider, prop: 'curve.wallThickness', display: DOM.valueDisplays.wallThickness, format: v => `${(v * this.config.unitToMm).toFixed(1)} mm` },
      { element: DOM.controls.drainageHoleScaleSlider, prop: 'drainageHoleScale', display: DOM.valueDisplays.drainageHoleScale, format: v => `${Math.round(v * 100)}%` },
      { element: DOM.controls.widthSlider, prop: 'dimensions.width', display: DOM.valueDisplays.width, format: () => this.getFormattedDimension('x') },
      { element: DOM.controls.depthSlider, prop: 'dimensions.depth', display: DOM.valueDisplays.depth, format: () => this.getFormattedDimension('z') },
      { element: DOM.controls.tension, prop: 'curve.tension', display: DOM.valueDisplays.tension, format: v => v.toFixed(2) },
      { element: DOM.controls.filletRadius, prop: 'curve.filletRadius', display: DOM.valueDisplays.filletRadius, format: v => v.toFixed(2) },
    ];

    sliderConfigs.forEach(cfg => {
      if (cfg.element) {

        const initialValue = this.getConfigValueByPath(cfg.prop);
        if (initialValue !== undefined) {
          cfg.element.value = initialValue;
        } else {

            this.app.configurationManager.setConfigValue(cfg.prop, parseFloat(cfg.element.value));
        }

        this.setupSlider(cfg);
      } else {

        console.warn(`UI Slider element for "${cfg.prop}" not found.`);
      }
    });


    if (DOM.controls.curveType) {
      DOM.controls.curveType.value = config.curve.type || 'spline';
      DOM.controls.curveType.addEventListener('change', e => {
        const type = e.target.value;
        this.app.configurationManager.setConfigValue('curve.type', type);
        this.toggleCurveControlsVisibility(type);
        this.app.generateFlowerpot();
      });
      this.toggleCurveControlsVisibility(DOM.controls.curveType.value);
    } else {
         console.warn("Curve type dropdown ('curve-type') not found.");
    }


    if (DOM.buttons.addPoint) DOM.buttons.addPoint.addEventListener('click', () => this.app.addControlPoint());
    if (DOM.buttons.removePoint) DOM.buttons.removePoint.addEventListener('click', () => this.app.removeControlPoint());
    if (DOM.buttons.download) DOM.buttons.download.addEventListener('click', () => this.app.exportManager.exportToObj());


    if (DOM.buttons.addPointExternal) {
        DOM.buttons.addPointExternal.addEventListener('click', () => this.app.addControlPoint());
    }
    if (DOM.buttons.removePointExternal) {
        DOM.buttons.removePointExternal.addEventListener('click', () => this.app.removeControlPoint());
    }
  }


  getConfigValueByPath(path) {
      return path.split('.').reduce((obj, key) => (obj && obj[key] !== undefined) ? obj[key] : undefined, this.app.config);
  }


  setupSlider({ element, prop, display, format }) {

    const updateValueAndRegenerate = Utils.debounce(value => {
      this.app.configurationManager.setConfigValue(prop, value);
      this.app.generateFlowerpot();
    }, 150);


    const handleInput = e => {
      const value = parseFloat(e.target.value) || 0;

      this.updateSliderDisplay(element, display, format);

      updateValueAndRegenerate(value);
    };

    element.addEventListener('input', handleInput);
  }


  updateSliderDisplay(sliderElement, displayElement, formatFunction) {
      if (displayElement && sliderElement) {
           const value = parseFloat(sliderElement.value) || 0;
           try {

                displayElement.textContent = formatFunction(value);
           } catch (error) {

               console.error(`Error formatting display for slider "${sliderElement.id}":`, error);
               displayElement.textContent = "Error";
           }
      }
  }



  updateAllValueDisplays() {
    const DOM = this.app.DOM;

    const sliderConfigs = [
      { element: DOM.controls.baseFilletRadius, display: DOM.valueDisplays.baseFilletRadius, format: v => `${Math.round(100 * v)}%` },
      { element: DOM.controls.wallThicknessSlider, display: DOM.valueDisplays.wallThickness, format: v => `${(v * this.config.unitToMm).toFixed(1)} mm` },
      { element: DOM.controls.drainageHoleScaleSlider, display: DOM.valueDisplays.drainageHoleScale, format: v => `${Math.round(100 * v)}%` },
      { element: DOM.controls.widthSlider, display: DOM.valueDisplays.width, format: () => this.getFormattedDimension('x') },
      { element: DOM.controls.depthSlider, display: DOM.valueDisplays.depth, format: () => this.getFormattedDimension('z') },
      { element: DOM.controls.tension, display: DOM.valueDisplays.tension, format: v => v.toFixed(2) },
      { element: DOM.controls.filletRadius, display: DOM.valueDisplays.filletRadius, format: v => v.toFixed(2) },
    ];
    sliderConfigs.forEach(cfg => {
      if (cfg.element && cfg.display) {
        this.updateSliderDisplay(cfg.element, cfg.display, cfg.format);
      }
    });
  }


  toggleCurveControlsVisibility(curveType) {
      const { filletControls, tension } = this.app.DOM.controls;

      const tensionControlContainer = tension?.closest('.control-group');

      if (filletControls) {

          filletControls.style.display = curveType === 'polyline' ? 'block' : 'none';
      }

      if (tensionControlContainer) {

          tensionControlContainer.style.display = curveType === 'spline' ? 'block' : 'none';
      } else if (tension) {

           console.warn("Tension slider found, but its parent '.control-group' container was not. Cannot toggle visibility correctly.");
      }
  }


  getFormattedDimension(axis) {
    if (this.app.state.flowerpotMesh && this.app.state.flowerpotMesh.geometry?.boundingBox) {
      const size = new this.THREE.Vector3();
       this.app.state.flowerpotMesh.geometry.boundingBox.getSize(size);
      const unitFactor = this.app.config.unitToMm || 1;
      const dimensionValue = size[axis] * unitFactor;
      return `${dimensionValue.toFixed(1)} mm`;
    }
    return 'N/A';
  }


  setupToggleListeners() {
    const { logoButton, introText, closeIntro, ctaButton, settingsButton, sidebar } = this.app.DOM;


    if (logoButton && introText) {

      logoButton.setAttribute("aria-expanded", !introText.classList.contains("hidden"));
      const toggleIntro = () => {
        const isHidden = introText.classList.toggle("hidden");
        logoButton.setAttribute("aria-expanded", String(!isHidden));
      };

      logoButton.addEventListener("click", toggleIntro);
      if (ctaButton) ctaButton.addEventListener("click", toggleIntro);

      if (closeIntro) {
        closeIntro.addEventListener("click", () => {
          introText.classList.add("hidden");
          logoButton.setAttribute("aria-expanded", "false");
        });
      }
    }


    if (settingsButton && sidebar) {
       const toggleSidebar = () => {
           const currentState = sidebar.getAttribute("data-state") || "hidden";
           const nextState = currentState === "hidden" ? "visible" : "hidden";
           sidebar.setAttribute("data-state", nextState);
           settingsButton.setAttribute("aria-expanded", String(nextState === "visible"));
       };
       settingsButton.addEventListener("click", toggleSidebar);

       const initialState = sidebar.getAttribute("data-state") || "hidden";
       settingsButton.setAttribute("aria-expanded", String(initialState === "visible"));
    }
  }


  updateDimensionDisplays() {
    const { width: widthDisplay, depth: depthDisplay } = this.app.DOM.valueDisplays;
     if (widthDisplay && this.app.DOM.controls.widthSlider) {

         this.updateSliderDisplay(this.app.DOM.controls.widthSlider, widthDisplay, () => this.getFormattedDimension('x'));
     }

     if (depthDisplay && this.app.DOM.controls.depthSlider) {
         this.updateSliderDisplay(this.app.DOM.controls.depthSlider, depthDisplay, () => this.getFormattedDimension('z'));
     }
  }


  destroy() {


  }
}


class GeometryModule extends ModuleBase {


  getCurvePoints() {
    const { Vector3, CatmullRomCurve3 } = this.THREE;


    const points3D = this.state.controlPoints.map(cp =>
      new Vector3(
        cp.x * this.config.dimensions.width,
        cp.y,
        0
      )
    );

    let curvePathPoints;
    if (this.config.curve.type === 'spline') {

      if (points3D.length < 2) return [];
      const curve = new CatmullRomCurve3(
          points3D,
          false,
          'catmullrom',
          this.config.curve.tension
      );
      curvePathPoints = curve.getPoints(50);
    } else {

      if (points3D.length < 1) return [];
      curvePathPoints = this.getPolylinePointsWithFillets();
    }

    const currentWidth = this.config.dimensions.width || 1;
    return curvePathPoints.map(p => new this.THREE.Vector2(p.x / currentWidth, p.y));
  }


  getPolylinePointsWithFillets() {
      const { Vector2 } = this.THREE;

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
      const prevCp = this.state.controlPoints[i - 1];
      const currentCp = this.state.controlPoints[i];
      const nextCp = this.state.controlPoints[i + 1];


      const prev = new Vector2(prevCp.x * this.config.dimensions.width, prevCp.y);
      const current = new Vector2(currentCp.x * this.config.dimensions.width, currentCp.y);
      const next = new Vector2(nextCp.x * this.config.dimensions.width, nextCp.y);


      const prevTangent = new Vector2().subVectors(prev, current).normalize();
      const nextTangent = new Vector2().subVectors(next, current).normalize();


      const angle = Math.acos(MathUtils.clamp(prevTangent.dot(nextTangent), -1, 1));
      if (angle < 0.001) return [current];


      const filletDist = this.config.curve.filletRadius / Math.tan(angle / 2);


      const limit = Math.min(current.distanceTo(prev), current.distanceTo(next)) * 0.499;
      const clampedFilletDist = Math.min(filletDist, limit);

      if (clampedFilletDist < 0.001) {
          return [current];
      }


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



  createBaseShape(widthFactor, depthFactor, baseFilletRadius) {
    const { Shape, MathUtils } = this.THREE;
    const halfWidth = widthFactor / 2;
    const halfDepth = depthFactor / 2;

    const maxRadiusPossible = Math.min(halfWidth, halfDepth);

    const radius = MathUtils.clamp(baseFilletRadius * maxRadiusPossible, 0, maxRadiusPossible);

    const shape = new Shape();


    shape.moveTo(-halfWidth + radius, halfDepth);

    shape.lineTo(halfWidth - radius, halfDepth);

    if (radius > 0) shape.quadraticCurveTo(halfWidth, halfDepth, halfWidth, halfDepth - radius);
    else shape.lineTo(halfWidth, halfDepth);

    shape.lineTo(halfWidth, -halfDepth + radius);

    if (radius > 0) shape.quadraticCurveTo(halfWidth, -halfDepth, halfWidth - radius, -halfDepth);
    else shape.lineTo(halfWidth, -halfDepth);

    shape.lineTo(-halfWidth + radius, -halfDepth);

    if (radius > 0) shape.quadraticCurveTo(-halfWidth, -halfDepth, -halfWidth, -halfDepth + radius);
    else shape.lineTo(-halfWidth, -halfDepth);

    shape.lineTo(-halfWidth, halfDepth - radius);

    if (radius > 0) shape.quadraticCurveTo(-halfWidth, halfDepth, -halfWidth + radius, halfDepth);
    else shape.lineTo(-halfWidth, halfDepth);

    return shape;
  }


  generateThickFlowerpotGeometry(baseShapePoints, profileCurvePoints, wallThickness) {

    const vertices = [];
    const indices = [];
    const { Vector2, MathUtils } = this.THREE || {};
    const clamp = MathUtils?.clamp || function(value, min, max) { return Math.max(min, Math.min(value, max)); };
    const MIN_RADIUS_FACTOR = 0.001;
    const heightSegments = Math.max(1, this.config?.curve?.heightSegments || 40);
    const basePointCount = baseShapePoints?.length || 0;


    if (!Vector2 || basePointCount < 3 ||
        !profileCurvePoints || profileCurvePoints.length < 2 ||
        !wallThickness || wallThickness <= 0) {
        console.warn("Insufficient or invalid data for flowerpot geometry generation.", {
            baseShapePoints: baseShapePoints?.length,
            profileCurvePoints: profileCurvePoints?.length,
            wallThickness: wallThickness,
            hasVector2: !!Vector2
        });
        return { vertices, indices };
    }


    let minY = profileCurvePoints[0].y;
    let maxY = profileCurvePoints[0].y;
    profileCurvePoints.forEach(p => {
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    });
    const curveHeight = Math.max(0, maxY - minY);
    if (curveHeight <= 0) {
         console.warn("Profile curve has zero or negative height.");
         return { vertices, indices };
    }


    const innerProfileCurvePoints = this.generateInnerProfileCurve(
        profileCurvePoints,
        wallThickness,
        minY,
        MIN_RADIUS_FACTOR
    );
    if (!innerProfileCurvePoints || innerProfileCurvePoints.length < 2) {
        console.warn("Failed to generate inner profile curve.");
        return { vertices, indices };
    }


    const drainageHoleScale = clamp(this.config?.drainageHoleScale ?? 0, 0, 1);
    const bottomThickness = wallThickness;
    const chamferHeight = bottomThickness * 0.5;


    let vertexCount = 0;
    let outerBottomStartIdx = vertexCount;


    const outerRadiusAtBottom = this.findRadiusAtHeight(profileCurvePoints, minY);
    baseShapePoints.forEach(bp => {
        vertices.push(bp.x * outerRadiusAtBottom, minY, bp.y * outerRadiusAtBottom);
        vertexCount++;
    });


    let innerBottomStartIdx = vertexCount;
    const innerRadiusAtBottom = this.findRadiusAtHeight(innerProfileCurvePoints, minY);
    baseShapePoints.forEach(bp => {
        vertices.push(bp.x * innerRadiusAtBottom, minY, bp.y * innerRadiusAtBottom);
        vertexCount++;
    });


    let drainageHoleBottomStartIdx = vertexCount;
    const drainageHoleRadius = innerRadiusAtBottom * drainageHoleScale;
    baseShapePoints.forEach(bp => {
        vertices.push(bp.x * drainageHoleRadius, minY, bp.y * drainageHoleRadius);
        vertexCount++;
    });


    let drainageHoleTopStartIdx = vertexCount;
    baseShapePoints.forEach(bp => {
        vertices.push(bp.x * drainageHoleRadius, minY + chamferHeight, bp.y * drainageHoleRadius);
        vertexCount++;
    });


    let innerTopStartIdx = vertexCount;
    baseShapePoints.forEach(bp => {
        vertices.push(bp.x * innerRadiusAtBottom, minY + bottomThickness, bp.y * innerRadiusAtBottom);
        vertexCount++;
    });


    let sliceStartIndices = [];
    for (let i = 0; i <= heightSegments; i++) {
        const sliceStartIdx = vertexCount;
        sliceStartIndices.push(sliceStartIdx);

        const t = i / heightSegments;

        const currentY = minY + bottomThickness + t * (curveHeight - bottomThickness);
        const outerRadiusFactor = this.findRadiusAtHeight(profileCurvePoints, currentY);


        baseShapePoints.forEach(bp => {
            vertices.push(bp.x * outerRadiusFactor, currentY, bp.y * outerRadiusFactor);
            vertexCount++;
        });


        const innerRadiusFactor = this.findRadiusAtHeight(innerProfileCurvePoints, currentY);
        baseShapePoints.forEach(bp => {
            vertices.push(bp.x * innerRadiusFactor, currentY, bp.y * innerRadiusFactor);
            vertexCount++;
        });
    }



    for (let j = 0; j < basePointCount; j++) {
        const nextJ = (j + 1) % basePointCount;


        indices.push(outerBottomStartIdx + j, innerBottomStartIdx + j, outerBottomStartIdx + nextJ);
        indices.push(outerBottomStartIdx + nextJ, innerBottomStartIdx + j, innerBottomStartIdx + nextJ);


        indices.push(innerBottomStartIdx + j, drainageHoleBottomStartIdx + j, innerBottomStartIdx + nextJ);
        indices.push(innerBottomStartIdx + nextJ, drainageHoleBottomStartIdx + j, drainageHoleBottomStartIdx + nextJ);


        indices.push(drainageHoleBottomStartIdx + j, drainageHoleTopStartIdx + j, drainageHoleBottomStartIdx + nextJ);
        indices.push(drainageHoleBottomStartIdx + nextJ, drainageHoleTopStartIdx + j, drainageHoleTopStartIdx + nextJ);


        indices.push(drainageHoleTopStartIdx + j, innerTopStartIdx + j, drainageHoleTopStartIdx + nextJ);
        indices.push(drainageHoleTopStartIdx + nextJ, innerTopStartIdx + j, innerTopStartIdx + nextJ);
    }


    const firstSliceOuterStartIdx = sliceStartIndices[0];
    for (let j = 0; j < basePointCount; j++) {
        const nextJ = (j + 1) % basePointCount;
        indices.push(outerBottomStartIdx + j, outerBottomStartIdx + nextJ, firstSliceOuterStartIdx + j);
        indices.push(outerBottomStartIdx + nextJ, firstSliceOuterStartIdx + nextJ, firstSliceOuterStartIdx + j);
    }


    const firstSliceInnerStartIdx = sliceStartIndices[0] + basePointCount;
    for (let j = 0; j < basePointCount; j++) {
        const nextJ = (j + 1) % basePointCount;

        indices.push(innerTopStartIdx + j, firstSliceInnerStartIdx + j, innerTopStartIdx + nextJ);
        indices.push(innerTopStartIdx + nextJ, firstSliceInnerStartIdx + j, firstSliceInnerStartIdx + nextJ);
    }


    for (let i = 0; i < heightSegments; i++) {
        const currentSliceStart = sliceStartIndices[i];
        const nextSliceStart = sliceStartIndices[i + 1];

        for (let j = 0; j < basePointCount; j++) {
            const nextJ = (j + 1) % basePointCount;


            indices.push(currentSliceStart + j, currentSliceStart + nextJ, nextSliceStart + j);
            indices.push(currentSliceStart + nextJ, nextSliceStart + nextJ, nextSliceStart + j);


            const currentInnerIdx = currentSliceStart + basePointCount;
            const nextInnerIdx = nextSliceStart + basePointCount;
            indices.push(currentInnerIdx + j, nextInnerIdx + j, currentInnerIdx + nextJ);
            indices.push(currentInnerIdx + nextJ, nextInnerIdx + j, nextInnerIdx + nextJ);
        }
    }


    const lastSliceStart = sliceStartIndices[heightSegments];
    const lastSliceInnerStart = lastSliceStart + basePointCount;
    for (let j = 0; j < basePointCount; j++) {
        const nextJ = (j + 1) % basePointCount;

        indices.push(lastSliceStart + j, lastSliceStart + nextJ, lastSliceInnerStart + j);
        indices.push(lastSliceStart + nextJ, lastSliceInnerStart + nextJ, lastSliceInnerStart + j);
    }


    return { vertices, indices };
  }


  generateInnerProfileCurve(outerCurvePoints, wallThickness, minY, minRadiusThreshold) {
      const { Vector2 } = this.THREE;
      if (!outerCurvePoints || outerCurvePoints.length === 0 || wallThickness <= 0) return [];


      const yAtThickness = minY + wallThickness;

      const outerRadiusAtThicknessHeight = this.findRadiusAtHeight(outerCurvePoints, yAtThickness);

      const bottomInnerRadius = Math.max(
          outerRadiusAtThicknessHeight - wallThickness,
          minRadiusThreshold
      );


      return outerCurvePoints.map(outerPoint => {
          let innerRadius;

          if (outerPoint.y <= yAtThickness) {
              innerRadius = bottomInnerRadius;
          } else {

              innerRadius = Math.max(outerPoint.x - wallThickness, minRadiusThreshold);
          }

          return new Vector2(innerRadius, outerPoint.y);
      });
  }


  findRadiusAtHeight(curvePoints, targetY) {
    if (!curvePoints || curvePoints.length === 0) return 0;

    targetY = Math.max(curvePoints[0].y, Math.min(targetY, curvePoints[curvePoints.length - 1].y));


    if (targetY <= curvePoints[0].y) return curvePoints[0].x;
    if (targetY >= curvePoints[curvePoints.length - 1].y) return curvePoints[curvePoints.length - 1].x;


    for (let i = 0; i < curvePoints.length - 1; i++) {
        const p1 = curvePoints[i];
        const p2 = curvePoints[i + 1];
        if (targetY >= p1.y && targetY <= p2.y) {

            if (p2.y === p1.y) return p1.x;

            const t = (targetY - p1.y) / (p2.y - p1.y);

            return p1.x + t * (p2.x - p1.x);
        }
    }


    return curvePoints[curvePoints.length - 1].x;
}
}


class DimensionModule extends ModuleBase {
  constructor(app) {
    super(app);
    this.handleGeometry = null;
    this.dimensionTextMaterialCache = new Map();
    this.lastTextScaleFactor = 0.05;
  }


  createOrUpdateBoundingBoxAndDimensions() {

    if (!this.state.flowerpotMesh || !this.state.flowerpotMesh.geometry?.boundingBox) {

        this.clearDimensionElements();
        if (this.state.boundingBoxHelper) {
            this.state.boundingBoxHelper.visible = false;
        }
        return;
    }

    const box = this.state.flowerpotMesh.geometry.boundingBox;


    if (this.config.display.showBoundingBox) {
      if (!this.state.boundingBoxHelper) {

        this.state.boundingBoxHelper = new this.THREE.Box3Helper(box, new THREE.Color(this.app.cssVars.colorBoundingBox));
        this.state.boundingBoxHelper.renderOrder = 0;
        this.state.boundingBoxHelper.name = "BoundingBoxHelper";
        this.app.scene.add(this.state.boundingBoxHelper);
      } else {

        this.state.boundingBoxHelper.box = box;
        this.state.boundingBoxHelper.material.color.set(this.app.cssVars.colorBoundingBox);
      }
      this.state.boundingBoxHelper.visible = true;
    } else if (this.state.boundingBoxHelper) {

      this.state.boundingBoxHelper.visible = false;
    }


    this.clearDimensionElements();

    const { min, max } = box;
    const size = new THREE.Vector3();
    box.getSize(size);


    const lineOffset = size.y * 0.02 + 0.02;
    const textOffsetFactor = 1.5;


    const yPlane = min.y - lineOffset;


    const widthStart = new THREE.Vector3(min.x, yPlane, min.z - lineOffset);
    const widthEnd = new THREE.Vector3(max.x, yPlane, min.z - lineOffset);
    const widthTextPos = new THREE.Vector3((min.x + max.x) / 2, yPlane - lineOffset * 0.5, min.z - lineOffset);
    this.createDimensionLine(widthStart, widthEnd, size.x, widthTextPos, 'width');


    const depthStart = new THREE.Vector3(max.x + lineOffset, yPlane, min.z);
    const depthEnd = new THREE.Vector3(max.x + lineOffset, yPlane, max.z);
    const depthTextPos = new THREE.Vector3(max.x + lineOffset, yPlane - lineOffset * 0.5, (min.z + max.z) / 2);
    this.createDimensionLine(depthStart, depthEnd, size.z, depthTextPos, 'depth');


    const heightStart = new THREE.Vector3(min.x - lineOffset, min.y, min.z - lineOffset);
    const heightEnd = new THREE.Vector3(min.x - lineOffset, max.y, min.z - lineOffset);
    const heightTextPos = new THREE.Vector3(min.x - lineOffset * textOffsetFactor, (min.y + max.y) / 2, min.z - lineOffset);
    this.createDimensionLine(heightStart, heightEnd, size.y, heightTextPos, 'height');
  }


  createDimensionLine(start, end, sizeValue, textPos, type) {

    const geom = new this.THREE.BufferGeometry().setFromPoints([start, end]);
    const line = new this.THREE.Line(geom, this.config.materials.dimensionLine);
    line.renderOrder = 1;
    line.name = `DimensionLine_${type}`;
    this.state.dimensionLinesGroup.add(line);


    this.createDimensionText(sizeValue, textPos, type);


    if (type === 'width' || type === 'depth') {
        const dir = new THREE.Vector3().subVectors(end, start).normalize();

        const handleOffset = window.innerWidth <= 767 ? -0.025 : 0.01;
        const handleStartPos = new THREE.Vector3().copy(start).addScaledVector(dir, -handleOffset);
        const handleEndPos = new THREE.Vector3().copy(end).addScaledVector(dir, handleOffset);


        this.createDimensionHandle(handleStartPos, `${type}-start`);
        this.createDimensionHandle(handleEndPos, `${type}-end`);
    }
  }


  getHandleGeometry() {
      if (!this.handleGeometry) {

          const handleRadius = window.innerWidth <= 767 ? 0.03 : 0.018;
          const handleHeight = handleRadius * 1.5;

          this.handleGeometry = new this.THREE.ConeGeometry(handleRadius, handleHeight, 8);

          this.handleGeometry.translate(0, handleHeight / 2, 0);
      }
      return this.handleGeometry;
  }


  createDimensionHandle(position, type) {
    const geometry = this.getHandleGeometry();

    const handleMesh = new this.THREE.Mesh(geometry, this.config.materials.dimensionHandle.clone());
    handleMesh.position.copy(position);


    const [dimensionType, handlePosition] = type.split('-');
    if (dimensionType === 'width') {

      handleMesh.rotation.z = handlePosition === 'end' ? -Math.PI / 2 : Math.PI / 2;
    } else if (dimensionType === 'depth') {

      handleMesh.rotation.x = handlePosition === 'start' ? -Math.PI / 2 : Math.PI / 2;
    }

    handleMesh.renderOrder = 2;

    handleMesh.userData = { type: 'dimensionHandle', dimensionType, handlePosition };
    handleMesh.name = `DimensionHandle_${type}`;
    this.state.dimensionHandles.push(handleMesh);
    this.app.scene.add(handleMesh);
  }


  createDimensionText(sizeValue, pos, type) {

    const dimensionMM = `${(sizeValue * this.config.unitToMm).toFixed(1)} mm`;

    const texture = Utils.createCanvasTexture(dimensionMM, {
      fontSize: window.innerWidth <= 767 ? 14 : 16,
      color: this.app.cssVars.colorDimensionText,
      padding: window.innerWidth <= 767 ? 3 : 4,
      fontFamily: 'Inter, sans-serif',
    });


    let material = this.dimensionTextMaterialCache.get(texture);
    if (!material) {
        material = new this.THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            sizeAttenuation: false,
        });
        this.dimensionTextMaterialCache.set(texture, material);
    }


    const sprite = new this.THREE.Sprite(material);
    sprite.name = `DimensionText_${type}`;
    sprite.renderOrder = 3;


    const desiredHeightPixels = 14;
    const scaleFactor = desiredHeightPixels / this.app.DOM.container.clientHeight;
    this.lastTextScaleFactor = scaleFactor * 25;

    sprite.scale.set(
        (texture.image.width / texture.image.height) * this.lastTextScaleFactor,
        this.lastTextScaleFactor,
        1.0
    );

    sprite.position.copy(pos);
    this.state.dimensionLinesGroup.add(sprite);
    return sprite;
  }


  clearDimensionElements() {

       Utils.disposeObject3D(this.state.dimensionLinesGroup);
       this.state.dimensionLinesGroup.clear();


       this.state.dimensionHandles.forEach(handle => {
           this.app.scene.remove(handle);
           Utils.disposeObject3D(handle);
       });
       this.state.dimensionHandles = [];
  }
}


class DynamicBackground extends ModuleBase {
  constructor(app) {
    super(app);

    if (!this.app.DOM.container) {
        console.error("DynamicBackground: Container element not found. Cannot initialize.");
        this.isInitialized = false;
        return;
    }
    this.isInitialized = false;
    try {
        this.initProperties();
        this.initRenderer();
        this.initShaders();
        this.createScene();
        this.isInitialized = true;
    } catch (error) {
        console.error("DynamicBackground initialization failed:", error);

        this.dispose();
    }
  }

  initProperties() {
    this.container = this.app.DOM.container;
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;
    this.clock = this.app.state.clock;
    this.mouse = new this.THREE.Vector2(0, 0);
    this.targetMouse = new this.THREE.Vector2(0, 0);
    this.mouseSmoothing = 0.05;
  }

  initRenderer() {
    this.scene = new this.THREE.Scene();

    this.camera = new this.THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.renderer = new this.THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(1);

    Object.assign(this.renderer.domElement.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      zIndex: '-1',
      pointerEvents: 'none',
    });

    this.container.parentNode.insertBefore(this.renderer.domElement, this.container);
  }

  initShaders() {

    const color1 = new THREE.Color(this.app.cssVars.colorPrimaryLight);
    const color2 = new THREE.Color(this.app.cssVars.colorPrimary);
    const color3 = new THREE.Color(this.app.cssVars.colorPrimaryDark);


    this.uniforms = {
      u_resolution: { value: new this.THREE.Vector2(this.width, this.height) },
      u_time: { value: 0.0 },
      u_mouse: { value: this.mouse },
      u_color1: { value: color1 },
      u_color2: { value: color2 },
      u_color3: { value: color3 },
      u_colorStops: { value: [0.1, 0.5, 1.0] },
      u_speed: { value: 0.4 },
      u_colorPreservation: { value: 0.4 },
      u_smoothness: { value: 8.0 },
      u_noiseFactor: { value: 0.3 }
    };


    this.material = new this.THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
  }
  getVertexShader() {

    return `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
  }

  getFragmentShader() {

    return `
      precision mediump float;
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
      uniform float u_noiseFactor;


      float smoothstepPoly(float edge0, float edge1, float x) {
          x = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
          return x * x * (3.0 - 2.0 * x);
      }


      float random(vec2 st) {
          return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
      }


      float noise(vec2 st) {
          vec2 i = floor(st);
          vec2 f = fract(st);

          vec2 u = f * f * (3.0 - 2.0 * f);

          return mix( mix( random( i + vec2(0.0,0.0) ),
                           random( i + vec2(1.0,0.0) ), u.x),
                      mix( random( i + vec2(0.0,1.0) ),
                           random( i + vec2(1.0,1.0) ), u.x), u.y);
      }


      vec2 calculateCornerOffset(float t, float mx, float my, float phase) {
          float speedFactor = 0.5;
          float offsetX = sin(t * speedFactor + mx * 0.5 + phase) * 0.3;
          float offsetY = cos(t * speedFactor + my * 0.5 + phase) * 0.3;
          return vec2(offsetX, offsetY);
      }


      vec3 calculateWeights(vec2 st, vec2 pos1, vec2 pos2, vec3 pos3) {

          float dist1 = 1.0 / (distance(st, pos1) * distance(st, pos1) + 0.05);
          float dist2 = 1.0 / (distance(st, pos2) * distance(st, pos2) + 0.05);
          float dist3 = 1.0 / (distance(st, pos3.xy) * distance(st, pos3.xy) + 0.05);
          float totalWeight = dist1 + dist2 + dist3;

          return vec3(dist1, dist2, dist3) / max(totalWeight, 0.001);
      }


       vec3 getGradientColor(float x) {
            vec3 color;
            float stop0 = u_colorStops[0];
            float stop1 = u_colorStops[1];
            float stop2 = u_colorStops[2];


            if (x < stop1) {
                float t = clamp((x - stop0) / max(stop1 - stop0, 0.001), 0.0, 1.0);
                color = mix(u_color1, u_color2, smoothstepPoly(0.0, 1.0, t));
            }

            else {
                float t = clamp((x - stop1) / max(stop2 - stop1, 0.001), 0.0, 1.0);
                color = mix(u_color2, u_color3, smoothstepPoly(0.0, 1.0, t));
            }
            return color;
       }


      void main() {
          vec2 st = vUv;
          float t = u_time * u_speed;

          float mx = u_mouse.x;
          float my = u_mouse.y;


          vec2 offset1 = calculateCornerOffset(t, mx, my, 0.0);
          vec2 offset2 = calculateCornerOffset(t, mx, my, 2.094);
          vec2 offset3 = calculateCornerOffset(t, mx, my, 4.188);
          vec2 pos1 = vec2(0.2, 0.8) + offset1;
          vec2 pos2 = vec2(0.8, 0.2) + offset2;
          vec2 pos3 = vec2(0.5, 0.5) + offset3;


          vec3 weights = calculateWeights(st, pos1, pos2, vec3(pos3, 0.0));
          vec3 weightedColor = u_color1 * weights.x + u_color2 * weights.y + u_color3 * weights.z;


          vec3 gradientColor = getGradientColor(st.x);


          vec3 finalColor = mix(weightedColor, gradientColor, u_colorPreservation);


          float noiseVal = noise(st * 3.0 + t * 0.1);

          float alpha = mix(0.6, 1.0, noiseVal * u_noiseFactor);
          alpha = clamp(alpha, 0.6, 0.9);


          gl_FragColor = vec4(finalColor, alpha);
      }
    `;
  }


  createScene() {

    const geometry = new this.THREE.PlaneGeometry(2, 2);

    this.quad = new this.THREE.Mesh(geometry, this.material);
    this.quad.name = "BackgroundQuad";
    this.scene.add(this.quad);
  }



  handleMouseMove(event) {
      if (!this.isInitialized) return;
      const rect = this.container.getBoundingClientRect();

      this.targetMouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.targetMouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }


  handleResize() {
      if (!this.isInitialized) return;

      this.width = this.container.clientWidth;
      this.height = this.container.clientHeight;

      this.renderer.setSize(this.width, this.height);

      this.uniforms.u_resolution.value.set(this.width, this.height);
  }


  animate() {

      if (!this.isInitialized || document.hidden) return;
      const time = this.clock.getElapsedTime();

      this.mouse.lerp(this.targetMouse, this.mouseSmoothing);

      this.uniforms.u_time.value = time;
      this.uniforms.u_mouse.value.copy(this.mouse);

      this.renderer.render(this.scene, this.camera);
  }


  updateColors() {
      if (!this.isInitialized) return;


  }


  dispose() {
      if (!this.isInitialized) return;
      this.isInitialized = false;

      Utils.disposeObject3D(this.scene);


      if (this.renderer) {
          this.renderer.dispose();
          if (this.renderer.domElement && this.renderer.domElement.parentNode) {
              this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
          }
          this.renderer = null;
      }

      this.scene = null;
      this.camera = null;
      this.material = null;
      this.uniforms = null;
      this.quad = null;
  }
}


class FlowerpotApp {
  constructor() {

    if (!checkWebGLSupport()) {
        console.error("WebGL is not supported or enabled in this browser.");

        const errorDiv = document.createElement('div');
        errorDiv.innerHTML = `
            <h1>WebGL Required</h1>
            <p>This application requires WebGL to display 3D graphics, but it seems your browser does not support it or it's disabled.</p>
            <p>Please try updating your browser or enabling WebGL in your browser settings (hardware acceleration might also need to be enabled).</p>
            <p>Common reasons:</p>
            <ul>
                <li>Using an outdated browser version.</li>
                <li>WebGL is explicitly disabled in browser flags (e.g., chrome://flags or about:config).</li>
                <li>Hardware acceleration is disabled in browser settings.</li>
                <li>Using older or incompatible graphics drivers.</li>
                <li>Running in a virtual machine or remote desktop with limited graphics capabilities.</li>
            </ul>
        `;

        errorDiv.style.cssText = 'position:fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); padding: 20px 30px; background: #fdfdfd; color: #333; z-index: 10000; border-radius: 8px; box-shadow: 0 8px 25px rgba(0,0,0,0.15); font-family: system-ui, sans-serif; line-height: 1.6; max-width: 600px; width: calc(100% - 40px); text-align: left; border: 1px solid #ddd;';
        errorDiv.querySelector('h1').style.cssText = 'margin-top: 0; color: #d9534f; font-size: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 15px;';
        errorDiv.querySelector('ul').style.cssText = 'margin-top: 10px; padding-left: 20px; text-align: left;';
        errorDiv.querySelector('li').style.cssText = 'margin-bottom: 5px;';

        document.body.innerHTML = '';
        document.body.style.backgroundColor = '#f0f4f8';
        document.body.appendChild(errorDiv);
        return;
    }



    this.THREE = THREE;
    this.animationRequestId = null;
    this.pointGeometry = null;
    this.debounceResize = null;



    if (!this.initDOM()) {

      console.error("DOM initialization failed. Aborting FlowerpotApp setup.");
      return;
    }

    try {

        this.initializeModules();

        this.debounceResize = Utils.debounce(this.handleResize.bind(this), 250);

        this.init();

        this.attachEventListeners();

        this.subtitleAnimator = new SubtitleAnimator();
        this.subtitleAnimator.start();
    } catch (error) {
        console.error("Error during FlowerpotApp initialization:", error);

         const errorDiv = document.createElement('div');
         errorDiv.textContent = `Application Initialization Error: ${error.message}. Please check console for details.`;
         errorDiv.style.cssText = 'position:fixed;top:10px;left:10px;padding:15px;background:rgba(255,0,0,0.8);color:white;z-index:1000;border-radius:5px;font-family:sans-serif;max-width: calc(100% - 20px); box-sizing: border-box;';
         document.body.appendChild(errorDiv);
    }
  }


  initDOM() {
    const get = id => document.getElementById(id);
    const query = sel => document.querySelector(sel);
    this.DOM = {
      canvas: get('threejs-canvas'),
      container: get('canvas-container'),
      buttons: {
          download: get('download-button'),
          addPoint: get('add-point-button'),
          removePoint: get('remove-point-button'),
          addPointExternal: get('add-point-button-external'),
          removePointExternal: get('remove-point-button-external')
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
      closeIntro: query('.close-intro'),
      ctaButton: query('.cta-button'),
      settingsButton: get('settings-button'),
      sidebar: query('.sidebar'),
    };

    if (!this.DOM.canvas || !this.DOM.container) {
        console.error("Required canvas ('threejs-canvas') or container ('canvas-container') element not found in the DOM.");
        return false;
    }

    if (!this.DOM.buttons.addPointExternal) {
        console.warn("External Add Point button ('add-point-button-external') not found.");
    }
    if (!this.DOM.buttons.removePointExternal) {
        console.warn("External Remove Point button ('remove-point-button-external') not found.");
    }
    return true;
  }


  initializeModules() {
    this.configurationManager = new ConfigurationManager(this);
    this.stateManager = new StateManager(this);
    this.sceneManager = new SceneManager(this);
    this.geometryModule = new GeometryModule(this);
    this.dimensionModule = new DimensionModule(this);
    this.resourceManager = new ResourceManager(this);
    this.inputManager = new InputManager(this);
    this.renderManager = new RenderManager(this);
    this.exportManager = new ExportManager(this);
    this.uiController = new UIController(this);
    this.dynamicBackground = new DynamicBackground(this);
  }


  init() {
    this.generateFlowerpot();
    this.renderManager.startAnimation();
  }


  attachEventListeners() {
    window.addEventListener('resize', this.debounceResize);

    window.addEventListener('mousemove', this.handleGlobalMouseMove.bind(this));

    document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
  }


  detachEventListeners() {
    window.removeEventListener('resize', this.debounceResize);
    window.removeEventListener('mousemove', this.handleGlobalMouseMove.bind(this));
    document.removeEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
  }


  handleGlobalMouseMove(event) {
      if (this.dynamicBackground && this.dynamicBackground.isInitialized) {
          this.dynamicBackground.handleMouseMove(event);
      }
  }


  handleVisibilityChange() {
       if (document.hidden) {
           this.renderManager.stopAnimation();
           if(this.subtitleAnimator) this.subtitleAnimator.stop();
       } else {
           this.renderManager.startAnimation();
           if(this.subtitleAnimator) this.subtitleAnimator.start();
       }
   }


  scaleX(normalizedX) {
    return normalizedX * (this.config.dimensions.width || 1);
  }


  createOrUpdateLine(existingLine, points, material, parent, renderOrder = 1) {

    if (!points || points.length < 2) {
        if(existingLine) existingLine.visible = false;
        return existingLine;
    }

    if (existingLine) {

      existingLine.geometry.setFromPoints(points);
      existingLine.geometry.computeBoundingSphere();
      existingLine.material = material;
      existingLine.visible = this.config.display.showControlPoints;
    } else {

      const geometry = new this.THREE.BufferGeometry().setFromPoints(points);
      existingLine = new this.THREE.Line(geometry, material);
      existingLine.visible = this.config.display.showControlPoints;
      existingLine.renderOrder = renderOrder;
      (parent || this.scene).add(existingLine);
    }
    return existingLine;
  }


  getControlPointGeometry() {
      if (!this.pointGeometry) {

           const radius = window.innerWidth <= 767 ? 0.025 : 0.018;

           this.pointGeometry = new this.THREE.SphereGeometry(radius, 12, 6);
      }
      return this.pointGeometry;
  }


  createControlPointMeshes() {
    const pointGeometry = this.getControlPointGeometry();


    this.state.controlPoints.forEach((cp, i) => {

      const mesh = new this.THREE.Mesh(pointGeometry, this.config.materials.controlPoint.clone());

      mesh.position.set(this.scaleX(cp.x), cp.y, 0);
      mesh.renderOrder = 2;

      mesh.userData = { index: i, type: 'controlPoint' };
      mesh.name = `ControlPoint_${i}`;
      mesh.visible = this.config.display.showControlPoints;
      this.state.controlPointMeshes.push(mesh);
      this.state.controlPointsGroup.add(mesh);
    });


    const linePoints = this.state.controlPointMeshes.map(m => m.position);

    let connectingLine = this.state.controlPointsGroup.children.find(child => child.userData.type === 'connectingLine');
    connectingLine = this.createOrUpdateLine(
        connectingLine,
        linePoints,
        this.config.materials.controlLine,
        this.state.controlPointsGroup,
        1
        );
    if (connectingLine) {

        connectingLine.userData.type = 'connectingLine';
        connectingLine.name = 'ConnectingLine';
    }
  }


  updateControlPointVisuals() {

      this.state.controlPointsGroup.visible = this.config.display.showControlPoints;
      if(this.state.curveLine) {
          this.state.curveLine.visible = this.config.display.showControlPoints;
      }

      if (!this.config.display.showControlPoints) return;

      let needsLineUpdate = false;

      this.state.controlPointMeshes.forEach((mesh, i) => {
          if (i < this.state.controlPoints.length) {
             const cp = this.state.controlPoints[i];

             const targetX = this.scaleX(cp.x);
             const targetY = i === 0 ? 0 : cp.y;

             if (this.state.draggingPoint !== mesh) {
                if (mesh.position.x !== targetX || mesh.position.y !== targetY) {
                    mesh.position.set(targetX, targetY, 0);
                    needsLineUpdate = true;
                }
             } else {
                 needsLineUpdate = true;
             }
             mesh.visible = true;
          } else {

              mesh.visible = false;
              needsLineUpdate = true;
          }
      });


      if (needsLineUpdate) {
          const linePoints = this.state.controlPointMeshes
              .filter(m => m.visible)
              .map(m => m.position);
          let connectingLine = this.state.controlPointsGroup.children.find(child => child.userData.type === 'connectingLine');
          connectingLine = this.createOrUpdateLine(connectingLine, linePoints, this.config.materials.controlLine, this.state.controlPointsGroup, 1);
          if (connectingLine) connectingLine.userData.type = 'connectingLine';
      }

      this.updateCurveLine();
  }


  updateCurveLine() {
    const curveProfilePoints = this.geometryModule.getCurvePoints();

    const curveWorldPoints = curveProfilePoints.map(p => new this.THREE.Vector3(this.scaleX(p.x), p.y, 0));

    this.state.curveLine = this.createOrUpdateLine(
        this.state.curveLine,
        curveWorldPoints,
        this.config.materials.curveLine,
        this.scene,
        1
    );
    if (this.state.curveLine) this.state.curveLine.name = "ProfileCurveLine";
  }


  generateFlowerpot() {

    this.resourceManager.cleanupPreviousMeshes();



    const baseShape = this.geometryModule.createBaseShape(1.0, 1.0, this.config.base.filletRadius);
    const baseShapePoints = baseShape.getPoints(this.config.curve.segments);

    const profileCurvePoints = this.geometryModule.getCurvePoints();


    if (profileCurvePoints.length < 2 || baseShapePoints.length < 3) {
      console.error("Cannot generate flowerpot: Not enough profile curve points or base shape points.");
      this.uiController.updateDimensionDisplays();
      return;
    }

    this.state.minY = profileCurvePoints.reduce((min, p) => Math.min(min, p.y), Infinity);


    const { vertices, indices } = this.geometryModule.generateThickFlowerpotGeometry(
      baseShapePoints, profileCurvePoints, this.config.curve.wallThickness
    );


    if (vertices.length === 0 || indices.length === 0) {
        console.error("Flowerpot geometry generation resulted in empty vertices or indices.");
        this.uiController.updateDimensionDisplays();
        return;
    }


    const geometry = new this.THREE.BufferGeometry();
    geometry.setAttribute('position', new this.THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();



    geometry.scale(this.config.dimensions.width*2, 1, this.config.dimensions.depth*2);
    geometry.computeBoundingBox();


    let verticalOffset = 0;
    if (geometry.boundingBox) {
        verticalOffset = -geometry.boundingBox.min.y;
        geometry.translate(0, verticalOffset, 0);
        geometry.computeBoundingBox();
        this.state.lastVerticalOffset = verticalOffset;
    } else {
        console.warn("Bounding box not computed before translation. Using last known offset.");
         geometry.translate(0, this.state.lastVerticalOffset, 0);
         geometry.computeBoundingBox();
    }


    this.state.flowerpotMesh = new this.THREE.Mesh(geometry, this.config.materials.pot);
    this.state.flowerpotMesh.castShadow = true;
    this.state.flowerpotMesh.receiveShadow = true;
    this.state.flowerpotMesh.name = "FlowerpotMesh";
    this.state.flowerpotMesh.renderOrder = 0;
    this.scene.add(this.state.flowerpotMesh);



    this.createControlPointMeshes();

    this.updateControlPointVisuals();

    this.dimensionModule.createOrUpdateBoundingBoxAndDimensions();

    this.uiController.updateDimensionDisplays();


    if (geometry.boundingBox) {
        const targetY = (geometry.boundingBox.min.y + geometry.boundingBox.max.y) / 2;

        if (this.controls) {
             this.controls.target.set(0, Math.max(0.1, targetY), 0);
        }
    }
  }


  addControlPoint() {

    const MAX_POINTS = 10;
    if (this.state.controlPoints.length >= MAX_POINTS) {
        console.warn(`Maximum number of control points (${MAX_POINTS}) reached.`);

        return;
    }
    const numPoints = this.state.controlPoints.length;
    let newPt;


    if (numPoints >= 2) {
        const p1 = this.state.controlPoints[numPoints - 2];
        const p2 = this.state.controlPoints[numPoints - 1];

        newPt = new this.THREE.Vector2().lerpVectors(p1, p2, 0.5);
        newPt.y += 0.05;

        this.state.controlPoints.splice(numPoints - 1, 0, newPt);
    }

    else if (numPoints === 1) {

        const last = this.state.controlPoints[0];
        newPt = last.clone().add(new this.THREE.Vector2(0.1, 0.2));
        this.state.controlPoints.push(newPt);
    } else {

        newPt = new this.THREE.Vector2(0.1, 0.0);
        this.state.controlPoints.push(newPt);
        newPt = new this.THREE.Vector2(0.2, 0.5);
        this.state.controlPoints.push(newPt);
    }


    if (newPt) {
        newPt.x = Utils.clamp(newPt.x, 0.01, 1.5);
        newPt.y = Utils.clamp(newPt.y, 0, 3);
    }
    this.generateFlowerpot();
  }


  removeControlPoint() {

    const MIN_POINTS = 2;
    if (this.state.controlPoints.length <= MIN_POINTS) {
        console.warn(`Minimum number of control points (${MIN_POINTS}) required.`);

        return;
    }

    this.state.controlPoints.splice(this.state.controlPoints.length - 2, 1);
    this.generateFlowerpot();
  }


  handleResize() {
    this.sceneManager.handleResize();

    if (this.dynamicBackground && this.dynamicBackground.isInitialized) {
        this.dynamicBackground.handleResize();
    }

    this.generateFlowerpot();
  }


  destroy() {
    this.detachEventListeners();
    if(this.renderManager) this.renderManager.stopAnimation();
    if(this.subtitleAnimator) this.subtitleAnimator.stop();
    if(this.inputManager) this.inputManager.destroy();
    if(this.uiController) this.uiController.destroy();
    if(this.dynamicBackground) this.dynamicBackground.dispose();
    if(this.controls) this.controls.dispose();
    if(this.resourceManager) this.resourceManager.disposeAll();


    if(this.renderer) {
        this.renderer.dispose();


        this.renderer = null;
    }

    Object.keys(this).forEach(key => {
         if (key !== 'THREE') {
             this[key] = null;
         }
    });
  }
}


document.addEventListener('DOMContentLoaded', () => {
    let appInstance = null;
    try {

        appInstance = new FlowerpotApp();
    } catch (error) {

        console.error("Failed to initialize FlowerpotApp:", error);

        const errorDiv = document.createElement('div');
        errorDiv.textContent = `Application Error: ${error.message}. Please check the browser console for more details.`;
        errorDiv.style.cssText = 'position:fixed;top:10px;left:10px;padding:15px;background:rgba(200, 0, 0, 0.9);color:white;z-index:9999;border-radius:5px;font-family:sans-serif;max-width: calc(100% - 20px); box-sizing: border-box;';

        if (!document.body.contains(document.getElementById('threejs-canvas'))) {
             document.body.innerHTML = '';
             document.body.style.backgroundColor = '#f0f4f8';
        }
        document.body.appendChild(errorDiv);
    }


});