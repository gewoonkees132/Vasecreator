import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';
import { OBJExporter } from 'OBJExporter';

// --- UnifiedEventHandler for handling both mouse and touch events ---
class UnifiedEventHandler {
    constructor(app) {
        this.app = app;
        this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        this.eventMap = {
            start: this.isTouchDevice ? 'touchstart' : 'mousedown',
            move: this.isTouchDevice ? 'touchmove' : 'mousemove',
            end: this.isTouchDevice ? 'touchend' : 'mouseup'
        };
    }

    addEventListener(element, type, handler) {
        element.addEventListener(this.eventMap[type], (event) => {
            const unifiedEvent = this.normalizeEvent(event);
            handler(unifiedEvent);
        });
    }

    normalizeEvent(event) {
        if (this.isTouchDevice) {
            const touch = event.touches[0] || event.changedTouches[0];
            return {
                clientX: touch.clientX,
                clientY: touch.clientY,
                preventDefault: () => event.preventDefault(),
            };
        }
        return event;
    }
}

// --- SubtitleAnimator ---
class SubtitleAnimator {
    constructor() {
        this.subtitles = ["Your Vase.", "Your Design.", "Create it.", "A vase for every style"];
        this.element = document.getElementById('subtitle');
        this.subtitleIndex = 0;
        this.letterIndex = 0;
    }

    animate() {
        this.element.style.opacity = 0;
        setTimeout(() => {
            this.element.textContent = "";
            this.letterIndex = 0;
            this.typeNextLetter();
            this.element.style.opacity = 1;
        }, 500);
    }

    typeNextLetter() {
        if (this.letterIndex < this.subtitles[this.subtitleIndex].length) {
            this.element.textContent += this.subtitles[this.subtitleIndex][this.letterIndex];
            this.letterIndex++;
            setTimeout(() => this.typeNextLetter(), 100);
        } else {
            setTimeout(() => {
                this.subtitleIndex = (this.subtitleIndex + 1) % this.subtitles.length;
                this.animate();
            }, 1000);
        }
    }

    start() {
        this.animate();
    }
}
// Start subtitle animation.
new SubtitleAnimator().start();

// --- ModuleBase ---
class ModuleBase {
    constructor(app) {
        this.app = app;
        this.config = app.config;
        this.state = app.state;
        this.THREE = THREE;
    }
}

// --- ConfigurationManager ---
class ConfigurationManager extends ModuleBase {
    constructor(app) {
        super(app);
        this.fetchCSSVariables();
        this.createMaterials();
        this.initConfig();
    }

    fetchCSSVariables() {
        const getCSSVariable = (variable) => getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
        this.app.cssVars = {
            colorPrimary: getCSSVariable('--color-primary'),
            colorPrimaryLight: getCSSVariable('--color-primary-light'),
            colorPrimaryDark: getCSSVariable('--color-primary-dark'),
            colorBackground: getCSSVariable('--color-background'),
            colorBorder: getCSSVariable('--color-border'),
            colorText: getCSSVariable('--color-text'),
            colorTextSecondary: getCSSVariable('--color-text-secondary'),
            colorSurface: getCSSVariable('--color-surface'),
            colorControlPoint: getCSSVariable('--color-primary-dark'),
            colorControlLine: getCSSVariable('--color-primary'),
            colorHover: getCSSVariable('--color-primary-light'),
            colorDimensionLine: getCSSVariable('--color-primary'),
            colorDimensionText: getCSSVariable('--color-dimension-text'),
            colorCurveLine: getCSSVariable('--color-primary'),
            colorBoundingBox: getCSSVariable('--color-primary'),
            colorProfilePlane: getCSSVariable('--color-primary-light'),
            colorCanvasBackground: getCSSVariable('--color-background'),
        };
    }

    createMaterial(type, options = {}) {
        const baseMaterials = {
            meshStandard: () =>
                new this.THREE.MeshStandardMaterial({
                    roughness: 0.6,
                    metalness: 0.2,
                    envMapIntensity: 0.6,
                    flatShading: false,
                    ...options,
                }),
            meshBasic: () =>
                new this.THREE.MeshBasicMaterial({
                    transparent: true,
                    opacity: 1,
                    ...options,
                }),
            lineBasic: () =>
                new this.THREE.LineBasicMaterial({
                    transparent: true,
                    opacity: 1,
                    linewidth: 1.5,
                    ...options,
                }),
        };
        return baseMaterials[type] ? baseMaterials[type]() : new this.THREE.Material();
    }

    createMaterials() {
        this.app.materials = {
            pot: this.createMaterial('meshStandard', { color: this.app.cssVars.colorPrimary }),
            controlPoint: this.createMaterial('meshBasic', {
                color: this.app.cssVars.colorControlPoint,
                transparent: false,
                opacity: 1,
            }),
            controlLine: this.createMaterial('lineBasic', { color: this.app.cssVars.colorControlLine }),
            hover: this.createMaterial('meshBasic', { color: this.app.cssVars.colorHover, opacity: 1 }),
            base: this.createMaterial('meshStandard', {
                color: this.app.cssVars.colorPrimaryDark,
                roughness: 0.7,
                metalness: 0.1,
            }),
            profilePlane: this.createMaterial('meshBasic', {
                color: this.app.cssVars.colorProfilePlane,
                opacity: 1,
            }),
            curveLine: this.createMaterial('lineBasic', {
                color: this.app.cssVars.colorCurveLine,
                opacity: 1,
                linewidth: 2,
            }),
            boundingBox: this.createMaterial('lineBasic', { color: this.app.cssVars.colorBoundingBox, opacity: 1 }),
            dimensionLine: this.createMaterial('lineBasic', { color: this.app.cssVars.colorDimensionLine, opacity: 1 }),
            dimensionHandle: this.createMaterial('meshBasic', { color: this.app.cssVars.colorControlPoint }),
            dimensionHandleHover: this.createMaterial('meshBasic', { color: this.app.cssVars.colorPrimary, opacity: 1 }),
        };
    }

    initConfig() {
        this.app.config = {
            curve: {
                tension: 0.5,
                type: 'spline',
                filletRadius: 0.5,
                segments: 20,
                heightSegments: 80,
                wallThickness: 0.04,
            },
            base: {
                filletRadius: 0.4,
            },
            dimensions: {
                width: 1,
                depth: 1,
            },
            drainageHoleScale: 0.5,
            materials: this.app.materials,
            display: {
                showProfilePlane: true,
                showControlPoints: true,
                showGrid: true,
                showBoundingBox: true,
            },
            animation: {
                duration: 0.15,
                easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
            },
        };
    }

    setConfigValue(path, value) {
        const parts = path.split('.');
        let current = this.app.config;
        for (let i = 0; i < parts.length - 1; i++) {
            current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = value;
    }
}

// --- StateManager ---
class StateManager extends ModuleBase {
    constructor(app) {
        super(app);
        this.initState();
    }

    initState() {
        this.app.state = {
            controlPoints: [
                new this.THREE.Vector2(0.2 / 0.6, 0.0),
                new this.THREE.Vector2(0.4 / 0.6, 0.3),
                new this.THREE.Vector2(0.5 / 0.6, 0.6),
                new this.THREE.Vector2(0.45 / 0.6, 0.9),
                new this.THREE.Vector2(0.3 / 0.6, 1.2),
            ],
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
            lastTime: 0,
            backgroundGradient: {
                innerColor: new this.THREE.Color(this.app.cssVars.colorBackground),
                outerColor: new this.THREE.Color(this.app.cssVars.colorPrimaryLight),
                intensity: 1,
                center: new this.THREE.Vector2(0, 0),
                radius: 0.5,
            },
        };
    }
}

// --- SceneManager ---
class SceneManager extends ModuleBase {
    constructor(app) {
        super(app);
        this.initScene();
        this.setupLights();
        this.setupEventListeners();
    }

    initScene() {
        const { clientWidth, clientHeight } = this.app.DOM.container;
        this.app.scene = new this.THREE.Scene();
        this.app.camera = new this.THREE.PerspectiveCamera(65, clientWidth / clientHeight, 0.1, 1000);
        this.app.camera.position.set(2, 2, 2);
        this.app.renderer = new this.THREE.WebGLRenderer({
            canvas: this.app.DOM.canvas,
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: true,
        });
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
        const getLerpedColor = (base, target, factor) =>
            new this.THREE.Color(base).lerp(new this.THREE.Color(target), factor);
        const ambientLight = new this.THREE.AmbientLight(
            getLerpedColor(this.app.cssVars.colorSurface, this.app.cssVars.colorPrimaryLight, 0.1),
            0.4
        );
        this.app.scene.add(ambientLight);
        const mainLight = new this.THREE.DirectionalLight(
            getLerpedColor(this.app.cssVars.colorSurface, this.app.cssVars.colorPrimaryLight, 0.05),
            0.8
        );
        mainLight.position.set(1, 2, 3);
        this.app.scene.add(mainLight);
        const fillLight = new this.THREE.DirectionalLight(
            getLerpedColor(this.app.cssVars.colorSurface, this.app.cssVars.colorPrimaryLight, 0.1),
            0.4
        );
        fillLight.position.set(-1, 0, -2);
        this.app.scene.add(fillLight);
        const rimLight = new this.THREE.DirectionalLight(new this.THREE.Color(this.app.cssVars.colorSurface), 0.3);
        rimLight.position.set(0, 3, -2);
        this.app.scene.add(rimLight);
    }

    setupEventListeners() {
        window.addEventListener('resize', () => this.handleResize());
    }

    handleResize() {
        const { clientWidth, clientHeight } = this.app.DOM.container;
        this.app.camera.aspect = clientWidth / clientHeight;
        this.app.camera.updateProjectionMatrix();
        this.app.renderer.setSize(clientWidth, clientHeight);
        this.app.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.app.dynamicBackground.handleResize();
    }
}

// --- InputManager ---
class InputManager extends ModuleBase {
    constructor(app) {
        super(app);
        this.eventHandler = new UnifiedEventHandler(app);
        this.setupEventListeners();
    }

    setupEventListeners() {
        const domEl = this.app.renderer.domElement;
        this.eventHandler.addEventListener(domEl, 'start', (e) => this.onStart(e));
        this.eventHandler.addEventListener(domEl, 'move', (e) => this.onMove(e));
        this.eventHandler.addEventListener(domEl, 'end', (e) => this.onEnd(e));
        this.eventHandler.addEventListener(window, 'end', (e) => this.onEnd(e));
        this.eventHandler.addEventListener(window, 'move', (e) => this.app.dynamicBackground.handleMouseMove(e));
    }

    onStart(event) {
        event.preventDefault();
        const controlIntersections = this.getIntersection(event, this.state.controlPointMeshes);
        if (controlIntersections.length > 0) {
            this.state.draggingPoint = controlIntersections[0].object;
            this.app.controls.enabled = false;
            document.body.style.cursor = 'grabbing';
            const point = this.state.draggingPoint;
            const originalScale = point.scale.x;
            point.scale.set(originalScale * 1.2, originalScale * 1.2, originalScale * 1.2);
            setTimeout(() => point.scale.set(originalScale, originalScale, originalScale), 100);
            return;
        }

        const dimensionIntersections = this.getIntersection(event, this.state.dimensionHandles);
        if (dimensionIntersections.length > 0) {
            this.state.draggingDimensionHandle = dimensionIntersections[0].object;
            this.state.dimensionTypeDragging = this.state.draggingDimensionHandle.userData.dimensionType;
            this.state.initialDimensionDragValue = this.state.draggingDimensionHandle.position.clone();
            this.app.controls.enabled = false;
            document.body.style.cursor = 'ew-resize';
            this.state.draggingDimensionHandle.material = this.config.materials.dimensionHandleHover;
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
            document.body.style.cursor = this.state.hoveredPoint
                ? 'grab'
                : this.state.dimensionHandleHovered
                ? 'ew-resize'
                : 'default';
        }
        if (this.state.draggingDimensionHandle) {
            this.state.draggingDimensionHandle.material = this.config.materials.dimensionHandle;
            this.state.draggingDimensionHandle = null;
            this.state.dimensionTypeDragging = null;
            this.state.initialDimensionDragValue = null;
            this.app.controls.enabled = true;
            document.body.style.cursor = this.state.dimensionHandleHovered ? 'ew-resize' : 'default';
        }
    }

    getMousePosition(event) {
        const rect = this.app.renderer.domElement.getBoundingClientRect();
        return new this.THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
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
        const intersectionPoint = new this.THREE.Vector3();
        return this.state.raycaster.ray.intersectPlane(plane, intersectionPoint)
            ? intersectionPoint
            : null;
    }

    handleControlPointDrag(event) {
        const intersectionPoint = this.getPlaneIntersection(event, new this.THREE.Vector3(0, 0, 1), 0);
        if (!intersectionPoint) return;
        const index = this.state.draggingPoint.userData.index;
        intersectionPoint.x = Math.max(0.01, Math.min(1, intersectionPoint.x / this.config.dimensions.width));
        intersectionPoint.y = Math.max(0, Math.min(3, intersectionPoint.y));
        if (index === 0) intersectionPoint.y = 0;
        this.state.controlPoints[index].set(intersectionPoint.x, intersectionPoint.y);
        const targetX = this.app.scaleX(intersectionPoint.x);
        const targetY = intersectionPoint.y;
        this.state.draggingPoint.position.x += (targetX - this.state.draggingPoint.position.x) * 0.6;
        this.state.draggingPoint.position.y += (targetY - this.state.draggingPoint.position.y) * 0.6;
        this.app.updateControlLinesAndCurve();
        this.app.generateFlowerpot();
    }

    handleDimensionHandleDrag(event) {
        const intersectionPoint = this.getPlaneIntersection(event, new this.THREE.Vector3(0, 1, 0), this.state.minY);
        if (!intersectionPoint) return;
        let delta;
        if (this.state.dimensionTypeDragging === 'width') {
            delta = intersectionPoint.x - this.state.initialDimensionDragValue.x;
            this.app.configurationManager.setConfigValue('dimensions.width', Math.max(0.1, this.config.dimensions.width + delta));
            this.app.DOM.controls.widthSlider.value = this.config.dimensions.width;
            this.state.initialDimensionDragValue.x = intersectionPoint.x;
        } else if (this.state.dimensionTypeDragging === 'depth') {
            delta = intersectionPoint.z - this.state.initialDimensionDragValue.z;
            this.app.configurationManager.setConfigValue('dimensions.depth', Math.max(0.1, this.config.dimensions.depth + delta));
            this.app.DOM.controls.depthSlider.value = this.config.dimensions.depth;
            this.state.initialDimensionDragValue.z = intersectionPoint.z;
        }
        this.app.generateFlowerpot();
    }

    updateHoverStates(event) {
        this.updateHoverState(event, this.state.controlPointMeshes, 'hoveredPoint', 'grab');
        if (!this.state.hoveredPoint) {
            this.updateHoverState(event, this.state.dimensionHandles, 'dimensionHandleHovered', 'ew-resize');
        }
    }

    updateHoverState(event, objects, hoverProperty, cursor) {
        const intersects = this.getIntersection(event, objects);
        if (this.state[hoverProperty] && (!intersects.length || intersects[0].object !== this.state[hoverProperty])) {
            this.state[hoverProperty].scale.set(1, 1, 1);
            this.state[hoverProperty].material = this.config.materials.controlPoint;
            this.state[hoverProperty] = null;
            document.body.style.cursor = 'default';
        }
        if (intersects.length > 0 && this.state[hoverProperty] !== intersects[0].object) {
            if (this.state[hoverProperty]) {
                this.state[hoverProperty].scale.set(1, 1, 1);
                this.state[hoverProperty].material = this.config.materials.controlPoint;
            }
            this.state[hoverProperty] = intersects[0].object;
            this.state[hoverProperty].scale.set(1.1, 1.1, 1.1);
            this.state[hoverProperty].material = this.config.materials.hover;
            document.body.style.cursor = cursor;
        }
    }
}

// --- RenderManager ---
class RenderManager extends ModuleBase {
    constructor(app) {
        super(app);
        this.animate = this.animate.bind(this);
    }

    startAnimation() {
        requestAnimationFrame(this.animate);
    }

    animate() {
        requestAnimationFrame(this.animate);
        this.app.controls.update();
        this.app.dynamicBackground.animate();
        this.app.renderer.render(this.app.scene, this.app.camera);
    }
}

// --- ExportManager ---
class ExportManager extends ModuleBase {
    exportToObj() {
        if (!this.app.state.flowerpotMesh) return;
        const exportMesh = this.app.state.flowerpotMesh.clone();
        exportMesh.geometry = exportMesh.geometry.clone();
        const matrix = new this.THREE.Matrix4().makeScale(100, 100, 100);
        const rotationMatrix = new this.THREE.Matrix4().makeRotationX(Math.PI / 2);
        matrix.multiply(rotationMatrix);
        exportMesh.geometry.applyMatrix4(matrix);
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
    }
}

// --- ResourceManager ---
class ResourceManager extends ModuleBase {
    cleanupPreviousMeshes() {
        if (this.app.state.flowerpotMesh) {
            this.app.scene.remove(this.app.state.flowerpotMesh);
            this.app.state.flowerpotMesh.geometry.dispose();
        }
        if (this.app.state.boundingBoxHelper) {
            this.app.scene.remove(this.app.state.boundingBoxHelper);
        }
        this.app.state.dimensionLinesGroup.clear();
        this.app.state.dimensionHandles.forEach(handle => {
            handle.geometry.dispose();
            this.app.scene.remove(handle);
        });
        this.app.state.dimensionHandles = [];
    }
}

// --- UIController ---
class UIController extends ModuleBase {
    constructor(app) {
        super(app);
        this.setupUIEventListeners();
    }

    setupUIEventListeners() {
        const DOM = this.app.DOM;

        DOM.controls.tension.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.app.configurationManager.setConfigValue('curve.tension', value);
            DOM.controls.tensionValue.textContent = value.toFixed(2);
            this.app.generateFlowerpot();
        });

        const sliders = [
            { element: DOM.controls.filletRadius, configProp: 'curve.filletRadius' },
            { element: DOM.controls.baseFilletRadius, configProp: 'base.filletRadius' },
            { element: DOM.controls.widthSlider, configProp: 'dimensions.width' },
            { element: DOM.controls.depthSlider, configProp: 'dimensions.depth' },
            { element: DOM.controls.wallThicknessSlider, configProp: 'curve.wallThickness' },
            { element: DOM.controls.drainageHoleScaleSlider, configProp: 'drainageHoleScale' }
        ];

        sliders.forEach(slider => {
            slider.element.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value) || 0;
                this.app.configurationManager.setConfigValue(slider.configProp, value);
                this.app.generateFlowerpot();
            });
        });

        DOM.controls.curveType.addEventListener('change', (e) => {
            this.app.configurationManager.setConfigValue('curve.type', e.target.value);
            DOM.controls.filletControls.style.display = this.config.curve.type === 'polyline' ? 'block' : 'none';
            DOM.controls.tension.parentElement.style.display = this.config.curve.type === 'spline' ? 'block' : 'none';
            this.app.generateFlowerpot();
        });

        DOM.buttons.addPoint.addEventListener('click', () => this.app.addControlPoint());
        DOM.buttons.removePoint.addEventListener('click', () => this.app.removeControlPoint());
        DOM.buttons.download.addEventListener('click', () => this.app.exportManager.exportToObj());
    }
}

// --- FlowerpotApp ---
class FlowerpotApp {
    constructor() {
        this.THREE = THREE;
        this.initDOM();
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
        this.init();
    }

    initDOM() {
        const getEl = id => document.getElementById(id);
        this.DOM = {
            canvas: getEl('threejs-canvas'),
            container: getEl('canvas-container'),
            buttons: {
                download: getEl('download-button'),
                addPoint: getEl('add-point-button'),
                removePoint: getEl('remove-point-button'),
            },
            controls: {
                tension: getEl('tension-slider'),
                tensionValue: getEl('tension-value'),
                curveType: getEl('curve-type'),
                filletRadius: getEl('fillet-radius'),
                filletControls: getEl('fillet-controls'),
                baseFilletRadius: getEl('base-fillet-radius'),
                widthSlider: getEl('width-slider'),
                depthSlider: getEl('depth-slider'),
                wallThicknessSlider: getEl('wall-thickness-slider'),
                drainageHoleScaleSlider: getEl('drainage-hole-scale-slider')
            }
        };
    }

    init() {
        this.createControlPointMeshes();
        this.generateFlowerpot();
        this.renderManager.startAnimation();
    }

    scaleX(x) {
        return x * this.config.dimensions.width;
    }

    updateLine(line, points, material) {
        if (line) {
            this.scene.remove(line);
            line.geometry.dispose();
        }
        const geometry = new this.THREE.BufferGeometry().setFromPoints(points);
        const newLine = new this.THREE.Line(geometry, material);
        this.scene.add(newLine);
        return newLine;
    }

    createControlPointMeshes() {
        this.state.controlPointsGroup.clear();
        this.state.controlPointMeshes = [];
        const controlPointGeometry = new this.THREE.SphereGeometry(0.03, 16, 16);
        this.state.controlPoints.forEach((point, index) => {
            const mesh = new this.THREE.Mesh(controlPointGeometry, this.config.materials.controlPoint);
            mesh.position.set(this.scaleX(point.x), point.y, 0);
            mesh.userData = { index, type: 'controlPoint' };
            mesh.visible = this.config.display.showControlPoints;
            this.state.controlPointMeshes.push(mesh);
            this.state.controlPointsGroup.add(mesh);
        });
        const lineMesh = new this.THREE.Line(
            new this.THREE.BufferGeometry().setFromPoints(this.state.controlPointMeshes.map(m => m.position)),
            this.config.materials.controlLine
        );
        lineMesh.visible = this.config.display.showControlPoints;
        this.state.controlPointsGroup.add(lineMesh);
    }

    updateControlLinesAndCurve() {
        this.state.controlPointsGroup.children = this.state.controlPointsGroup.children.filter(
            child => !(child instanceof this.THREE.Line)
        );
        const controlPoints = this.state.controlPointMeshes.map(m => m.position);
        const lineMesh = new this.THREE.Line(
            new this.THREE.BufferGeometry().setFromPoints(controlPoints),
            this.config.materials.controlLine
        );
        lineMesh.visible = this.config.display.showControlPoints;
        this.state.controlPointsGroup.add(lineMesh);
        this.updateCurveLine();
    }

    updateCurveLine() {
        const points = this.geometryModule
            .getCurvePoints()
            .map(p => new this.THREE.Vector3(this.scaleX(p.x), p.y, 0));
        this.state.curveLine = this.updateLine(this.state.curveLine, points, this.config.materials.curveLine);
    }

    generateFlowerpot() {
        this.resourceManager.cleanupPreviousMeshes();
        const baseShape = this.geometryModule.createRoundedRect(
            0,
            0,
            this.config.dimensions.width,
            this.config.dimensions.depth,
            this.config.base.filletRadius
        );
        const baseShapePoints = baseShape.getPoints(this.config.curve.segments);
        const curvePoints = this.geometryModule.getCurvePoints();
        let minY = Infinity,
            maxY = -Infinity;
        curvePoints.forEach(point => {
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        });
        this.state.minY = minY;
        const { vertices, faces } = this.geometryModule.generateThickFlowerpotGeometry(
            baseShapePoints,
            curvePoints,
            minY,
            maxY - minY,
            this.config.curve.wallThickness
        );
        const geometry = new this.THREE.BufferGeometry();
        geometry.setAttribute('position', new this.THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(faces);
        geometry.computeVertexNormals();
        this.state.flowerpotMesh = new this.THREE.Mesh(geometry, this.config.materials.pot);
        this.state.flowerpotMesh.castShadow = true;
        this.state.flowerpotMesh.receiveShadow = true;
        this.scene.add(this.state.flowerpotMesh);
        this.createControlPointMeshes();
        this.updateControlLinesAndCurve();
        const vaseCenter = new this.THREE.Vector3(0, (maxY + minY) / 2, 0);
        this.controls.target.copy(vaseCenter);
        this.camera.lookAt(this.controls.target);
        this.controls.update();
        if (this.config.display.showBoundingBox) {
            this.dimensionModule.createBoundingBoxAndDimensions();
        }
    }

    addControlPoint() {
        if (this.state.controlPoints.length >= 10) return;
        const lastPoint = this.state.controlPoints[this.state.controlPoints.length - 1];
        const newPoint = lastPoint.clone().add(new this.THREE.Vector2(0.1, 0.1));
        newPoint.x = Math.max(0.01, Math.min(1, newPoint.x));
        newPoint.y = Math.max(0, Math.min(1.5, newPoint.y));
        this.state.controlPoints.push(newPoint);
        this.generateFlowerpot();
    }

    removeControlPoint() {
        if (this.state.controlPoints.length > 2) {
            this.state.controlPoints.pop();
            this.generateFlowerpot();
        }
    }
}

// --- GeometryModule ---
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

        // Generate vertices
        for (let i = 0; i <= heightSegments; i++) {
            const sliceHeight = i / heightSegments;
            const curveY = sliceHeight * curveHeight + minY;
            const actualHeight = curveY - minY;
            const outerRadius = this.findRadiusAtHeight(curvePoints, curveY);

            // Add outer shape vertices
            baseShapePoints.forEach(basePoint => {
                vertices.push(basePoint.x * outerRadius, actualHeight, basePoint.y * outerRadius);
            });

            // Add inner shape vertices (drainage hole or inner wall)
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

        // Generate side faces
        this.generateSideFaces(faces, heightSegments, basePointCount, pointsPerSlice);

        // Generate top and bottom faces
        this.generateTopFaces(faces, heightSegments, basePointCount, pointsPerSlice);
        this.generateBottomFaces(faces, basePointCount);

        return { vertices, faces };
    }

    generateSideFaces(faces, heightSegments, basePointCount, pointsPerSlice) {
        for (let i = 0; i < heightSegments; i++) {
            for (let j = 0; j < basePointCount; j++) {
                const nextJ = (j + 1) % basePointCount;

                // Outer wall faces
                const outerA = i * pointsPerSlice + j;
                const outerB = i * pointsPerSlice + nextJ;
                const outerC = (i + 1) * pointsPerSlice + nextJ;
                const outerD = (i + 1) * pointsPerSlice + j;
                faces.push(outerA, outerD, outerB, outerB, outerD, outerC);

                // Inner wall faces
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
    
            // Corrected winding order:  Swap bottomHoleA and bottomOuterB in *one* of the triangles.
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

// --- DimensionModule ---
class DimensionModule {
    constructor(app) {
        this.app = app;
        this.config = app.config;
        this.state = app.state;
        this.THREE = app.THREE;
    }

    createBoundingBoxAndDimensions() {
        const boundingBox = new THREE.Box3().setFromObject(this.state.flowerpotMesh);
        this.state.boundingBoxHelper = new THREE.Box3Helper(boundingBox, this.config.materials.boundingBox.color);
        this.app.scene.add(this.state.boundingBoxHelper);
        const min = boundingBox.min;
        const max = boundingBox.max;
        const size = boundingBox.getSize(new THREE.Vector3());
        const offset = 0.03;
        this.createDimensionLine(
            new THREE.Vector3(min.x, min.y - offset, min.z - offset),
            new THREE.Vector3(max.x, min.y - offset, min.z - offset),
            size.x.toFixed(2),
            new THREE.Vector3((min.x + max.x) / 2, min.y - offset * 2, min.z),
            'width'
        );
        this.createDimensionLine(
            new THREE.Vector3(min.x - offset, min.y - offset, min.z),
            new THREE.Vector3(min.x - offset, min.y - offset, max.z),
            size.z.toFixed(2),
            new THREE.Vector3(min.x, min.y - offset * 2, (min.z + max.z) / 2),
            'depth'
        );
        this.createDimensionLine(
            new THREE.Vector3(min.x, min.y, min.z - offset),
            new THREE.Vector3(min.x, max.y, min.z - offset),
            size.y.toFixed(2),
            new THREE.Vector3(min.x, (min.y + max.y) / 2, min.z - offset * 2),
            'height'
        );
    }

    createDimensionLine(start, end, text, textPosition, dimensionType) {
        this.createDimensionText(text, textPosition, this.state.dimensionLinesGroup);
        if (dimensionType === 'width' || dimensionType === 'depth') {
            const points = [start, end];
            const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
            const dimensionLine = new THREE.Line(lineGeometry, this.config.materials.dimensionLine);
            this.state.dimensionLinesGroup.add(dimensionLine);
            this.createDimensionHandle(start, `${dimensionType}-start`);
            this.createDimensionHandle(end, `${dimensionType}-end`);
        }
    }

    createDimensionHandle(position, type) {
        const handleGeometry = new THREE.CylinderGeometry(0, 0.02, 0.04, 8);
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

    createDimensionText(text, position, group) {
        const pixelRatio = window.devicePixelRatio || 2;
        const padding = 5;
        const textFont = '24px Rajdhani, sans-serif';
        const unitText = ' mm';
        const boxHeight = 50;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = textFont;
        const textWidth = ctx.measureText(text).width;
        const unitTextWidth = ctx.measureText(unitText).width;
        const canvasWidth = textWidth + unitTextWidth + padding * 3;
        const canvasHeight = boxHeight;
        canvas.width = canvasWidth * pixelRatio;
        canvas.height = canvasHeight * pixelRatio;
        ctx.scale(pixelRatio, pixelRatio);
        ctx.font = textFont;
        ctx.fillStyle = this.app.cssVars.colorDimensionText;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text * 100 + unitText, canvasWidth / 2, canvasHeight / 2);
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        const textSpriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            depthWrite: false
        });
        const textSprite = new THREE.Sprite(textSpriteMaterial);
        textSprite.renderOrder = 1;
        textSprite.scale.set(0.2, 0.1, 0.1);
        textSprite.position.copy(position);
        group.add(textSprite);
        return textSprite;
    }
}

// --- DynamicBackground ---
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
        this.mouse = new this.THREE.Vector2(0, 0);
        this.targetMouse = new this.THREE.Vector2(0, 0);
        this.mouseSmoothing = 0.05;
        this.clock = this.app.state.clock;
    }

    initRenderer() {
        this.scene = new this.THREE.Scene();
        this.camera = new this.THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.renderer = new this.THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance'
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
            pointerEvents: 'none'
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
            u_colorStops: { value: [0.0, 0.5, 1.0] },
            u_speed: { value: 0.5 },
            u_colorPreservation: { value: 0.85 },
            u_smoothness: { value: 2.5 }
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
        const time = this.app.state.clock.getElapsedTime();
        this.uniforms.u_time.value = time;
        this.mouse.x += (this.targetMouse.x - this.mouse.x) * this.mouseSmoothing;
        this.mouse.y += (this.targetMouse.y - this.mouse.y) * this.mouseSmoothing;
        this.uniforms.u_mouse.value.copy(this.mouse);
        this.updateColors();
        this.renderer.render(this.scene, this.camera);
    }

    updateColors() {
        const newColor1 = new this.THREE.Color(this.app.cssVars.colorPrimaryLight);
        const newColor2 = new this.THREE.Color(this.app.cssVars.colorPrimary);
        const newColor3 = new this.THREE.Color(this.app.cssVars.colorPrimaryDark);
        if (!this.uniforms.u_color1.value.equals(newColor1)) {
            this.uniforms.u_color1.value.copy(newColor1);
        }
        if (!this.uniforms.u_color2.value.equals(newColor2)) {
            this.uniforms.u_color2.value.copy(newColor2);
        }
        if (!this.uniforms.u_color3.value.equals(newColor3)) {
            this.uniforms.u_color3.value.copy(newColor3);
        }
    }
}

// Create a new instance of the FlowerpotApp class to start the application.
new FlowerpotApp();