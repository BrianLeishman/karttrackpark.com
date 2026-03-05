import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import type { Iti } from 'intl-tel-input';
import { assetsBase } from './api';
import { showCropModal } from './crop-modal';
import { esc } from './html';
import { initPhoneInput } from './phone-input';
import { timezoneOptions } from './tracks';

function requireEl(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) {
        throw new Error(`Expected element #${id}`);
    }
    return el;
}

function requireInput(id: string): HTMLInputElement {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLInputElement)) {
        throw new Error(`Expected HTMLInputElement for #${id}`);
    }
    return el;
}

function requireButton(id: string): HTMLButtonElement {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLButtonElement)) {
        throw new Error(`Expected HTMLButtonElement for #${id}`);
    }
    return el;
}

export interface TrackFormValues {
    name?: string;
    logo_key?: string;
    email?: string;
    phone?: string;
    city?: string;
    state?: string;
    timezone?: string;
    website?: string;
    facebook?: string;
    instagram?: string;
    youtube?: string;
    tiktok?: string;
}

interface TrackFormOptions {
    /** ID prefix for all form elements (e.g. "track" -> "track-name", "track-email") */
    prefix: string;
    /** Pre-fill values for edit mode */
    values?: TrackFormValues;
    /** Whether a logo file is required (true for create, false for edit) */
    logoRequired?: boolean;
    /** Whether to collapse social fields behind a toggle */
    collapseSocials?: boolean;
}

export interface TrackFormBindings {
    iti: Iti;
    logoInput: HTMLInputElement;
    logoPreview: HTMLElement;
    croppedBlob: Blob | null;
}

export interface TrackAnnotation {
    type: 'turn' | 'start_finish';
    lat: number;
    lng: number;
    position: number;
    name?: string;
    number?: number;
}

interface MarkerEntry {
    annotation: TrackAnnotation;
    marker: L.Marker;
}

export interface OutlineMapBindings {
    outlinePoints: [number, number][];
    annotations: TrackAnnotation[];
    invalidateSize: () => void;
    destroy: () => void;
}

export interface BoundsMapBindings {
    getMapBounds: () => [[number, number], [number, number]];
    invalidateSize: () => void;
}

/**
 * Returns HTML for the layout outline map section (outline drawing + S/F only).
 * Toolbar uses Photoshop-style radio tool buttons.
 */
export function outlineMapHtml(prefix: string): string {
    const p = prefix;
    return `
        <div id="${p}-map" style="aspect-ratio:1/1;border-radius:.375rem;z-index:0"></div>
        <div class="btn-group mt-2" role="toolbar" id="${p}-map-toolbar">
            <button type="button" class="btn btn-sm btn-outline-secondary active" id="${p}-map-tool-pointer" title="Pointer"><i class="fa-solid fa-arrow-pointer"></i></button>
            <button type="button" class="btn btn-sm btn-outline-secondary" id="${p}-map-tool-draw" title="Draw Outline"><i class="fa-solid fa-pen"></i></button>
            <button type="button" class="btn btn-sm btn-outline-success" id="${p}-map-tool-sf" title="Start/Finish Line"><i class="fa-solid fa-flag-checkered"></i></button>
            <button type="button" class="btn btn-sm btn-outline-danger" id="${p}-map-clear" title="Clear All"><i class="fa-solid fa-eraser"></i></button>
        </div>
        <div class="form-text" id="${p}-map-hint">Select a tool to begin.</div>`;
}

/**
 * Returns HTML for the track-level turns map (turn placement on read-only outline).
 */
export function turnsMapHtml(prefix: string): string {
    const p = prefix;
    return `
        <div id="${p}-map" style="aspect-ratio:1/1;border-radius:.375rem;z-index:0"></div>
        <div class="btn-group mt-2" role="toolbar" id="${p}-map-toolbar">
            <button type="button" class="btn btn-sm btn-outline-secondary active" id="${p}-map-tool-pointer" title="Pointer"><i class="fa-solid fa-arrow-pointer"></i></button>
            <button type="button" class="btn btn-sm btn-outline-secondary" id="${p}-map-tool-turn" title="Add Turn"><i class="fa-solid fa-location-dot"></i></button>
            <button type="button" class="btn btn-sm btn-outline-danger" id="${p}-map-clear" title="Clear Turns"><i class="fa-solid fa-eraser"></i></button>
        </div>
        <div class="form-text" id="${p}-map-hint">Select the turn tool to place turn markers on the outline.</div>`;
}

// --- Shared map helpers ---

function createLockedMap(mapEl: HTMLElement, savedBounds: L.LatLngBoundsExpression): L.Map {
    const map = L.map(mapEl, {
        dragging: false,
        zoomControl: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
        zoomSnap: 0,
    });
    map.fitBounds(savedBounds);

    const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
    });
    const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri',
        maxZoom: 19,
    });
    const labelsOverlay = L.tileLayer('https://stamen-tiles.a.ssl.fastly.net/toner-labels/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        opacity: 0.7,
    });
    const roadsOverlay = L.tileLayer('https://stamen-tiles.a.ssl.fastly.net/toner-lines/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        opacity: 0.4,
    });
    satelliteLayer.addTo(map);
    labelsOverlay.addTo(map);
    roadsOverlay.addTo(map);
    L.control.layers(
        { 'Hybrid': satelliteLayer, 'Street': osmLayer },
        { 'Roads': roadsOverlay, 'Labels': labelsOverlay },
        { position: 'topright' },
    ).addTo(map);
    map.on('baselayerchange', (e: L.LayersControlEvent) => {
        if (e.name === 'Street') {
            map.removeLayer(roadsOverlay);
            map.removeLayer(labelsOverlay);
        } else {
            roadsOverlay.addTo(map);
            labelsOverlay.addTo(map);
        }
    });

    return map;
}

function parseBounds(initBounds: string): L.LatLngBoundsExpression | null {
    if (!initBounds) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(initBounds);
        if (Array.isArray(parsed) && parsed.length === 2 &&
            Array.isArray(parsed[0]) && Array.isArray(parsed[1])) {
            return [[Number(parsed[0][0]), Number(parsed[0][1])], [Number(parsed[1][0]), Number(parsed[1][1])]];
        }
    } catch { /* ignore */ }
    return null;
}

function parseOutlinePoints(initOutline: string): [number, number][] {
    if (!initOutline) {
        return [];
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSON.parse returns any
        const geojson: { geometry?: { coordinates?: unknown } } = JSON.parse(initOutline);
        const rawCoords = geojson.geometry?.coordinates;
        const coords: unknown[] = Array.isArray(rawCoords) ? rawCoords : [];
        const points: [number, number][] = [];
        for (const c of coords) {
            if (Array.isArray(c) && c.length >= 2) {
                points.push([Number(c[1]), Number(c[0])]);
            }
        }
        return points;
    } catch {
        return [];
    }
}

function getPolylineLatLngs(layer: L.Polyline): L.LatLng[] {
    const raw = layer.getLatLngs();
    if (Array.isArray(raw) && raw.length > 0 && raw[0] instanceof L.LatLng) {
        return raw.filter((ll): ll is L.LatLng => ll instanceof L.LatLng);
    }
    return [];
}

function snapToPolyline(point: L.LatLng, latlngs: L.LatLng[]): { latlng: L.LatLng; position: number } | null {
    if (latlngs.length < 2) {
        return null;
    }
    const segLens: number[] = [];
    let totalLen = 0;
    for (let i = 0; i < latlngs.length - 1; i++) {
        const d = latlngs[i].distanceTo(latlngs[i + 1]);
        segLens.push(d);
        totalLen += d;
    }
    if (totalLen === 0) {
        return null;
    }

    let bestDist = Infinity;
    let bestLatLng: L.LatLng | null = null;
    let bestPosition = 0;
    let cumLen = 0;

    for (let i = 0; i < latlngs.length - 1; i++) {
        const a = latlngs[i];
        const b = latlngs[i + 1];
        const ax = a.lng, ay = a.lat, bx = b.lng, by = b.lat;
        const px = point.lng, py = point.lat;
        const dx = bx - ax, dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const projLat = ay + t * dy;
        const projLng = ax + t * dx;
        const proj = L.latLng(projLat, projLng);
        const dist = point.distanceTo(proj);

        if (dist < bestDist) {
            bestDist = dist;
            bestLatLng = proj;
            bestPosition = (cumLen + t * segLens[i]) / totalLen;
        }
        cumLen += segLens[i];
    }

    if (!bestLatLng) {
        return null;
    }
    return { latlng: bestLatLng, position: bestPosition };
}

export function createAnnotationIcon(label: string, type: 'turn' | 'start_finish'): L.DivIcon {
    const bg = type === 'start_finish' ? '#198754' : '#0d6efd';
    return L.divIcon({
        className: '',
        html: `<div class="annotation-marker" style="background:${bg}">${label}</div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
    });
}

function showMarkerPopover(map: L.Map, mapEl: HTMLElement, marker: L.Marker, width: number, html: string): HTMLDivElement {
    const existing = document.querySelector('.annotation-popover');
    if (existing) {
        existing.remove();
    }
    const popoverDiv = document.createElement('div');
    popoverDiv.className = 'annotation-popover card shadow-sm';
    popoverDiv.style.cssText = `z-index:1000;width:${width}px;position:fixed;`;
    popoverDiv.innerHTML = html;
    document.body.appendChild(popoverDiv);

    // Position relative to the marker in viewport coordinates
    const markerPos = map.latLngToContainerPoint(marker.getLatLng());
    const mapRect = mapEl.getBoundingClientRect();
    let left = mapRect.left + markerPos.x + 10;
    let top = mapRect.top + markerPos.y - 10;
    if (left + width > window.innerWidth - 4) {
        left = mapRect.left + markerPos.x - width - 10;
    }
    if (top + popoverDiv.offsetHeight > window.innerHeight - 4) {
        top = window.innerHeight - popoverDiv.offsetHeight - 4;
    }
    if (top < 4) {
        top = 4;
    }
    popoverDiv.style.left = `${left}px`;
    popoverDiv.style.top = `${top}px`;

    const dismiss = () => {
        popoverDiv.remove();
        document.removeEventListener('click', closePopover);
        document.removeEventListener('keydown', keyClose);
    };
    const closePopover = (ev: MouseEvent) => {
        if (ev.target instanceof Node && !popoverDiv.contains(ev.target)) {
            dismiss();
        }
    };
    const keyClose = (ev: KeyboardEvent) => {
        if (ev.key === 'Enter' || ev.key === 'Escape') {
            dismiss();
        }
    };
    setTimeout(() => document.addEventListener('click', closePopover), 0);
    document.addEventListener('keydown', keyClose);
    return popoverDiv;
}

// --- Radio toolbar helper ---
type ToolName = string;

function setupToolbar(prefix: string, toolNames: ToolName[], mapEl: HTMLElement): {
    activeTool: () => ToolName;
    setTool: (name: ToolName) => void;
    onToolChange: (cb: (tool: ToolName) => void) => void;
} {
    const buttons = new Map<ToolName, HTMLButtonElement>();
    for (const name of toolNames) {
        const btn = document.getElementById(`${prefix}-map-tool-${name}`);
        if (btn instanceof HTMLButtonElement) {
            buttons.set(name, btn);
        }
    }

    let current: ToolName = toolNames[0];
    const listeners: ((tool: ToolName) => void)[] = [];

    function setTool(name: ToolName) {
        current = name;
        for (const [n, btn] of buttons) {
            btn.classList.toggle('active', n === name);
        }
        const cursorMap: Record<string, string> = { pointer: '', draw: 'crosshair', sf: 'crosshair', turn: 'crosshair' };
        mapEl.style.cursor = cursorMap[name] ?? '';
        for (const cb of listeners) {
            cb(name);
        }
    }

    for (const [name, btn] of buttons) {
        btn.addEventListener('click', () => setTool(name));
    }

    return {
        activeTool: () => current,
        setTool,
        onToolChange: cb => listeners.push(cb),
    };
}

/**
 * Bind a Leaflet outline-drawing map after the HTML from outlineMapHtml is in the DOM.
 * Layout maps: outline drawing + S/F placement only (no turns).
 * Returns null if no map_bounds are available.
 */
export function bindOutlineMap(prefix: string, initValues?: { track_outline?: string; map_bounds?: string; annotations?: TrackAnnotation[]; turns?: TrackAnnotation[] }): OutlineMapBindings | null {
    const p = prefix;
    const outlinePoints: [number, number][] = [];
    const annotations: TrackAnnotation[] = [];

    const mapEl = requireEl(`${p}-map`);
    const clearBtn = requireButton(`${p}-map-clear`);
    const hintEl = requireEl(`${p}-map-hint`);

    const initOutline = initValues?.track_outline ?? '';
    const savedBounds = parseBounds(initValues?.map_bounds ?? '');

    if (!savedBounds) {
        mapEl.style.display = 'none';
        const toolbar = document.getElementById(`${p}-map-toolbar`);
        if (toolbar) {
            toolbar.style.display = 'none';
        }
        hintEl.innerHTML = '<span class="text-warning"><i class="fa-solid fa-triangle-exclamation me-1"></i>Set your track location on the Edit Track page before drawing outlines.</span>';
        return null;
    }

    const map = createLockedMap(mapEl, savedBounds);

    // Disable all Geoman toolbar controls — we manage drawing programmatically
    map.pm.addControls({
        position: 'topleft',
        drawMarker: false,
        drawCircleMarker: false,
        drawPolyline: false,
        drawRectangle: false,
        drawPolygon: false,
        drawCircle: false,
        drawText: false,
        editMode: false,
        dragMode: false,
        cutPolygon: false,
        removalMode: false,
        rotateMode: false,
    });
    map.pm.removeControls();

    const lineStyle: L.PathOptions = { color: '#0d6efd', weight: 3 };
    let currentLayer: L.Polyline | null = null;

    const toolbar = setupToolbar(p, ['pointer', 'draw', 'sf'], mapEl);

    // --- Annotation (S/F only) marker management ---
    const annotationMarkers: MarkerEntry[] = [];

    function refreshAnnotationIcons() {
        for (const entry of annotationMarkers) {
            entry.marker.setIcon(createAnnotationIcon('S/F', 'start_finish'));
        }
    }

    function addAnnotationMarker(a: TrackAnnotation) {
        const marker = L.marker([a.lat, a.lng], {
            icon: createAnnotationIcon('S/F', 'start_finish'),
            draggable: true,
        }).addTo(map);

        const entry: MarkerEntry = { annotation: a, marker };
        annotationMarkers.push(entry);

        marker.on('drag', () => {
            if (!currentLayer) {
                return;
            }
            const latlngs = getPolylineLatLngs(currentLayer);
            const snap = snapToPolyline(marker.getLatLng(), latlngs);
            if (snap) {
                marker.setLatLng(snap.latlng);
                a.lat = snap.latlng.lat;
                a.lng = snap.latlng.lng;
                a.position = snap.position;
            }
        });

        marker.on('click', () => {
            const popoverDiv = showMarkerPopover(map, mapEl, marker, 160, '<div class="card-body p-2"><button type="button" class="btn btn-sm btn-outline-danger w-100"><i class="fa-solid fa-trash me-1"></i>Delete</button></div>');

            popoverDiv.querySelector('button')?.addEventListener('click', () => {
                marker.remove();
                const idx = annotationMarkers.indexOf(entry);
                if (idx >= 0) {
                    annotationMarkers.splice(idx, 1);
                }
                const ai = annotations.indexOf(a);
                if (ai >= 0) {
                    annotations.splice(ai, 1);
                }
                popoverDiv.remove();
            });
        });
    }

    function clearAnnotations() {
        for (const entry of annotationMarkers) {
            entry.marker.remove();
        }
        annotationMarkers.length = 0;
        annotations.length = 0;
    }

    function recomputeAnnotationPositions() {
        if (!currentLayer) {
            return;
        }
        const latlngs = getPolylineLatLngs(currentLayer);
        for (const entry of annotationMarkers) {
            const snap = snapToPolyline(L.latLng(entry.annotation.lat, entry.annotation.lng), latlngs);
            if (snap) {
                entry.annotation.lat = snap.latlng.lat;
                entry.annotation.lng = snap.latlng.lng;
                entry.annotation.position = snap.position;
                entry.marker.setLatLng(snap.latlng);
            }
        }
        refreshAnnotationIcons();
    }

    function syncPointsFromLayer(layer: L.Polyline) {
        outlinePoints.length = 0;
        const latlngs = getPolylineLatLngs(layer);
        for (const ll of latlngs) {
            outlinePoints.push([ll.lat, ll.lng]);
        }
    }

    function startDrawMode() {
        hintEl.textContent = 'Click to draw the track outline. Double-click to finish.';
        map.pm.enableDraw('Line', {
            snappable: true,
            finishOn: 'dblclick',
            templineStyle: lineStyle,
            hintlineStyle: { color: '#0d6efd', dashArray: '5,5' },
            pathOptions: lineStyle,
            tooltips: true,
        });
    }

    function stopDrawMode() {
        if (map.pm.globalDrawModeEnabled()) {
            map.pm.disableDraw();
        }
    }

    function setEditableLayer(layer: L.Polyline) {
        currentLayer = layer;
        layer.pm.enable({ allowSelfIntersection: true, addVertexOn: 'click', removeVertexOn: 'contextmenu' });
        syncPointsFromLayer(layer);
        hintEl.textContent = 'Drag vertices to adjust. Click a line segment to add a vertex. Right-click a vertex to delete it.';

        const onEdit = () => {
            syncPointsFromLayer(layer);
            recomputeAnnotationPositions();
        };
        layer.on('pm:edit', onEdit);
        layer.on('pm:vertexadded', onEdit);
        layer.on('pm:vertexremoved', onEdit);
        layer.on('pm:markerdragend', onEdit);
    }

    // Tool change handling
    toolbar.onToolChange(tool => {
        if (tool === 'draw' && !currentLayer) {
            startDrawMode();
            hintEl.textContent = 'Click to draw the track outline. Double-click to finish.';
        } else if (tool === 'draw' && currentLayer) {
            hintEl.textContent = 'Outline already drawn. Clear to redraw.';
            toolbar.setTool('pointer');
        } else if (tool === 'sf') {
            stopDrawMode();
            if (!currentLayer) {
                hintEl.textContent = 'Draw an outline first before placing Start/Finish.';
                toolbar.setTool('pointer');
            } else {
                hintEl.textContent = 'Click on the outline to place the Start/Finish line.';
            }
        } else {
            stopDrawMode();
            if (currentLayer) {
                hintEl.textContent = 'Drag vertices to adjust. Click a line segment to add a vertex. Right-click a vertex to delete it.';
            } else {
                hintEl.textContent = 'Select Draw tool to begin drawing the outline.';
            }
        }
    });

    // S/F placement on map click
    map.on('click', (e: L.LeafletMouseEvent) => {
        if (toolbar.activeTool() !== 'sf' || !currentLayer) {
            return;
        }
        const latlngs = getPolylineLatLngs(currentLayer);
        const snap = snapToPolyline(e.latlng, latlngs);
        if (!snap) {
            return;
        }

        // Remove existing S/F
        const existingIdx = annotations.findIndex(a => a.type === 'start_finish');
        if (existingIdx >= 0) {
            const entry = annotationMarkers.find(m => m.annotation === annotations[existingIdx]);
            if (entry) {
                entry.marker.remove();
                const mi = annotationMarkers.indexOf(entry);
                if (mi >= 0) {
                    annotationMarkers.splice(mi, 1);
                }
            }
            annotations.splice(existingIdx, 1);
        }

        const annotation: TrackAnnotation = {
            type: 'start_finish',
            lat: snap.latlng.lat,
            lng: snap.latlng.lng,
            position: snap.position,
        };
        annotations.push(annotation);
        addAnnotationMarker(annotation);
        toolbar.setTool('pointer');
    });

    // Load existing outline
    const loadedPoints = parseOutlinePoints(initOutline);
    if (loadedPoints.length >= 2) {
        const polyline = L.polyline(loadedPoints, lineStyle).addTo(map);
        setEditableLayer(polyline);
    }

    // Load existing S/F annotations (filter out any turns from legacy data)
    if (currentLayer && initValues?.annotations) {
        for (const a of initValues.annotations) {
            if (a.type !== 'start_finish') {
                continue;
            }
            const annotation: TrackAnnotation = { ...a };
            annotations.push(annotation);
            addAnnotationMarker(annotation);
        }
    }

    // Show track-level turns as read-only markers for reference
    if (initValues?.turns) {
        for (const t of initValues.turns) {
            const num = t.number ?? 0;
            let label = num > 0 ? `T${num}` : 'T?';
            if (t.name) {
                label += ` ${t.name}`;
            }
            L.marker([t.lat, t.lng], {
                icon: createAnnotationIcon(label, 'turn'),
                interactive: false,
            }).addTo(map);
        }
    }

    // If no existing outline, auto-select draw tool
    if (!currentLayer) {
        toolbar.setTool('draw');
    }

    // Handle newly drawn line
    map.on('pm:create', e => {
        const layer = e.layer;
        if (layer instanceof L.Polyline) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- Geoman create event layer type is generic
            setEditableLayer(layer);
            toolbar.setTool('pointer');
        }
    });

    // Clear button
    clearBtn.addEventListener('click', () => {
        if (currentLayer) {
            currentLayer.pm.disable();
            map.removeLayer(currentLayer);
            currentLayer = null;
        }
        outlinePoints.length = 0;
        clearAnnotations();
        toolbar.setTool('draw');
    });

    // Keyboard: Backspace/Ctrl+Z to remove last vertex during drawing
    const keyHandler = (e: KeyboardEvent) => {
        if (!map.pm.globalDrawModeEnabled()) {
            return;
        }
        if (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) {
            e.preventDefault();
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Geoman internal API has no types
            (map.pm.Draw as any).Line?._removeLastVertex?.();
        }
    };
    document.addEventListener('keydown', keyHandler);

    setTimeout(() => map.invalidateSize(), 200);

    return {
        get outlinePoints() {
            return outlinePoints;
        },
        get annotations() {
            return annotations;
        },
        invalidateSize() {
            map.invalidateSize();
            if (savedBounds) {
                map.fitBounds(savedBounds);
            }
        },
        destroy() {
            document.removeEventListener('keydown', keyHandler);
        },
    };
}

// --- Turns map (track-level turn placement on read-only outline) ---

export interface TurnsMapBindings {
    turns: TrackAnnotation[];
    invalidateSize: () => void;
    destroy: () => void;
}

/**
 * Bind a turns-only map for track-level turn management.
 * Outline is read-only (not editable). Turns are placed/edited on top.
 */
export function bindTurnsMap(prefix: string, initValues?: { track_outline?: string; map_bounds?: string; turns?: TrackAnnotation[] }): TurnsMapBindings | null {
    const p = prefix;
    const turns: TrackAnnotation[] = [];

    const mapEl = requireEl(`${p}-map`);
    const clearBtn = requireButton(`${p}-map-clear`);
    const hintEl = requireEl(`${p}-map-hint`);

    const savedBounds = parseBounds(initValues?.map_bounds ?? '');

    if (!savedBounds) {
        mapEl.style.display = 'none';
        const toolbarEl = document.getElementById(`${p}-map-toolbar`);
        if (toolbarEl) {
            toolbarEl.style.display = 'none';
        }
        hintEl.innerHTML = '<span class="text-warning"><i class="fa-solid fa-triangle-exclamation me-1"></i>Set your track location first.</span>';
        return null;
    }

    const map = createLockedMap(mapEl, savedBounds);
    const lineStyle: L.PathOptions = { color: '#0d6efd', weight: 3, opacity: 0.6 };

    // Draw the outline as read-only
    const loadedPoints = parseOutlinePoints(initValues?.track_outline ?? '');
    let outlineLayer: L.Polyline | null = null;
    if (loadedPoints.length >= 2) {
        outlineLayer = L.polyline(loadedPoints, lineStyle).addTo(map);
    }

    const toolbar = setupToolbar(p, ['pointer', 'turn'], mapEl);

    // --- Undo stack for Ctrl+Z ---
    const undoStack: (() => void)[] = [];

    // --- Turn marker management ---
    const turnMarkers: MarkerEntry[] = [];

    function getTurnLabels(): Map<TrackAnnotation, string> {
        const labels = new Map<TrackAnnotation, string>();
        const sorted = [...turns].sort((a, b) => a.position - b.position);
        for (const t of sorted) {
            const num = t.number ?? 0;
            let label = num > 0 ? `T${num}` : 'T?';
            if (t.name) {
                label += ` ${t.name}`;
            }
            labels.set(t, label);
        }
        return labels;
    }

    function refreshTurnIcons() {
        const labels = getTurnLabels();
        for (const entry of turnMarkers) {
            const label = labels.get(entry.annotation) ?? 'T?';
            entry.marker.setIcon(createAnnotationIcon(label, 'turn'));
        }
    }

    function nextTurnNumber(): number {
        let max = 0;
        for (const t of turns) {
            if (t.number && t.number > max) {
                max = t.number;
            }
        }
        return max + 1;
    }

    function addTurnMarker(a: TrackAnnotation) {
        const labels = getTurnLabels();
        const label = labels.get(a) ?? 'T?';
        const marker = L.marker([a.lat, a.lng], {
            icon: createAnnotationIcon(label, 'turn'),
            draggable: true,
        }).addTo(map);

        const entry: MarkerEntry = { annotation: a, marker };
        turnMarkers.push(entry);

        // Drag: free movement, recompute position along outline if present
        marker.on('dragend', () => {
            const pos = marker.getLatLng();
            a.lat = pos.lat;
            a.lng = pos.lng;
            if (outlineLayer) {
                const latlngs = getPolylineLatLngs(outlineLayer);
                const snap = snapToPolyline(pos, latlngs);
                if (snap) {
                    a.position = snap.position;
                }
            }
            refreshTurnIcons();
        });

        // Click: popover with number, name, delete
        marker.on('click', () => {
            const popoverDiv = showMarkerPopover(map, mapEl, marker, 240, `
                <div class="card-body p-2">
                    <div class="d-flex gap-2 mb-2">
                        <div style="width:80px">
                            <label class="form-label small mb-0">Turn #</label>
                            <input type="number" class="form-control form-control-sm turn-num" min="1" value="${a.number ?? ''}">
                        </div>
                        <div class="flex-grow-1">
                            <label class="form-label small mb-0">Nickname</label>
                            <input type="text" class="form-control form-control-sm turn-name" placeholder="e.g. Hairpin" value="${esc(a.name ?? '')}">
                        </div>
                    </div>
                    <button type="button" class="btn btn-sm btn-outline-danger w-100"><i class="fa-solid fa-trash me-1"></i>Delete</button>
                </div>`);

            const nameFocusTarget = popoverDiv.querySelector('.turn-name');
            if (nameFocusTarget instanceof HTMLInputElement) {
                nameFocusTarget.focus();
            }

            const numInput = popoverDiv.querySelector('.turn-num');
            if (numInput instanceof HTMLInputElement) {
                numInput.addEventListener('input', () => {
                    a.number = parseInt(numInput.value, 10) || 0;
                    refreshTurnIcons();
                });
            }

            const nameInput = popoverDiv.querySelector('.turn-name');
            if (nameInput instanceof HTMLInputElement) {
                nameInput.addEventListener('input', () => {
                    a.name = nameInput.value.trim() || undefined;
                    refreshTurnIcons();
                });
            }

            popoverDiv.querySelector('button')?.addEventListener('click', () => {
                marker.remove();
                const idx = turnMarkers.indexOf(entry);
                if (idx >= 0) {
                    turnMarkers.splice(idx, 1);
                }
                const ai = turns.indexOf(a);
                if (ai >= 0) {
                    turns.splice(ai, 1);
                }
                popoverDiv.remove();
                refreshTurnIcons();
            });
        });
    }

    function clearTurns() {
        for (const entry of turnMarkers) {
            entry.marker.remove();
        }
        turnMarkers.length = 0;
        turns.length = 0;
    }

    // Tool change handling
    toolbar.onToolChange(tool => {
        if (tool === 'turn') {
            hintEl.textContent = 'Click on the map to place a turn marker.';
        } else {
            hintEl.textContent = 'Click a turn marker to edit. Drag to reposition.';
        }
    });

    // Turn placement on map click
    map.on('click', (e: L.LeafletMouseEvent) => {
        if (toolbar.activeTool() !== 'turn') {
            return;
        }
        // Don't place turns when a popover is open
        if (document.querySelector('.annotation-popover')) {
            return;
        }

        let position = 0;
        if (outlineLayer) {
            const latlngs = getPolylineLatLngs(outlineLayer);
            const snap = snapToPolyline(e.latlng, latlngs);
            if (snap) {
                position = snap.position;
            }
        }

        const annotation: TrackAnnotation = {
            type: 'turn',
            lat: e.latlng.lat,
            lng: e.latlng.lng,
            position,
            number: nextTurnNumber(),
        };
        turns.push(annotation);
        addTurnMarker(annotation);

        // Push undo action
        undoStack.push(() => {
            const entry = turnMarkers.find(m => m.annotation === annotation);
            if (entry) {
                entry.marker.remove();
                const idx = turnMarkers.indexOf(entry);
                if (idx >= 0) {
                    turnMarkers.splice(idx, 1);
                }
            }
            const ai = turns.indexOf(annotation);
            if (ai >= 0) {
                turns.splice(ai, 1);
            }
            refreshTurnIcons();
        });
    });

    // Clear button
    clearBtn.addEventListener('click', () => {
        const prevTurns = [...turns.map(t => ({ ...t }))];
        const hadTurns = turns.length > 0;
        clearTurns();
        toolbar.setTool('pointer');
        hintEl.textContent = 'Turns cleared. Select turn tool to add new ones.';

        if (hadTurns) {
            undoStack.push(() => {
                for (const t of prevTurns) {
                    turns.push(t);
                    addTurnMarker(t);
                }
                refreshTurnIcons();
            });
        }
    });

    // Load existing turns
    if (initValues?.turns) {
        for (const t of initValues.turns) {
            const annotation: TrackAnnotation = { ...t };
            turns.push(annotation);
            addTurnMarker(annotation);
        }
        refreshTurnIcons();
    }

    // Keyboard: Ctrl+Z to undo
    const keyHandler = (e: KeyboardEvent) => {
        if (e.key === 'z' && (e.ctrlKey || e.metaKey) && undoStack.length > 0) {
            e.preventDefault();
            const undo = undoStack.pop();
            if (undo) {
                undo();
            }
        }
    };
    document.addEventListener('keydown', keyHandler);

    setTimeout(() => map.invalidateSize(), 200);

    return {
        get turns() {
            return turns;
        },
        invalidateSize() {
            map.invalidateSize();
            if (savedBounds) {
                map.fitBounds(savedBounds);
            }
        },
        destroy() {
            document.removeEventListener('keydown', keyHandler);
        },
    };
}

/**
 * Returns HTML for a bounds-only map (search + pan/zoom, no outline drawing).
 * Used on the track edit page to set the track's map position.
 */
export function boundsMapHtml(prefix: string): string {
    const p = prefix;
    return `
        <div class="position-relative mb-2">
            <div class="input-group input-group-sm">
                <span class="input-group-text"><i class="fa-solid fa-magnifying-glass"></i></span>
                <input type="text" class="form-control" id="${p}-map-search" placeholder="Search for a location\u2026" autocomplete="off">
            </div>
            <div id="${p}-map-search-results" class="dropdown-menu w-100 overflow-auto" style="max-height:240px"></div>
        </div>
        <div id="${p}-map" style="aspect-ratio:1/1;border-radius:.375rem;z-index:0"></div>
        <div class="form-text">Pan and zoom the map to frame your track. This position is used for all layout outlines.</div>`;
}

/**
 * Bind a bounds-only map (search + pan/zoom). Returns handles for reading map bounds.
 */
export function bindBoundsMap(prefix: string, initBounds?: string): BoundsMapBindings {
    const p = prefix;
    const mapEl = requireEl(`${p}-map`);

    let savedBounds: L.LatLngBoundsExpression | null = null;
    if (initBounds) {
        try {
            const parsed: unknown = JSON.parse(initBounds);
            if (Array.isArray(parsed) && parsed.length === 2 &&
                Array.isArray(parsed[0]) && Array.isArray(parsed[1])) {
                savedBounds = [[Number(parsed[0][0]), Number(parsed[0][1])], [Number(parsed[1][0]), Number(parsed[1][1])]];
            }
        } catch { /* ignore */ }
    }

    const map = L.map(mapEl, { scrollWheelZoom: true, zoomSnap: 0.25, zoomDelta: 0.25, wheelDebounceTime: 100 });
    if (savedBounds) {
        map.fitBounds(savedBounds);
    } else {
        map.setView([39.8, -98.5], 4);
    }

    const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
    });
    const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri',
        maxZoom: 19,
    });
    const labelsOverlay = L.tileLayer('https://stamen-tiles.a.ssl.fastly.net/toner-labels/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        opacity: 0.7,
    });
    const roadsOverlay = L.tileLayer('https://stamen-tiles.a.ssl.fastly.net/toner-lines/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        opacity: 0.4,
    });
    satelliteLayer.addTo(map);
    labelsOverlay.addTo(map);
    roadsOverlay.addTo(map);
    L.control.layers(
        { 'Hybrid': satelliteLayer, 'Street': osmLayer },
        { 'Roads': roadsOverlay, 'Labels': labelsOverlay },
        { position: 'topright' },
    ).addTo(map);
    map.on('baselayerchange', (e: L.LayersControlEvent) => {
        if (e.name === 'Street') {
            map.removeLayer(roadsOverlay);
            map.removeLayer(labelsOverlay);
        } else {
            roadsOverlay.addTo(map);
            labelsOverlay.addTo(map);
        }
    });

    // --- Geocoding search (Nominatim) ---
    const searchInput = requireInput(`${p}-map-search`);
    const searchResults = requireEl(`${p}-map-search-results`);
    let searchDebounce: ReturnType<typeof setTimeout> | null = null;

    function hideResults() {
        searchResults.classList.remove('show');
        searchResults.innerHTML = '';
    }

    searchInput.addEventListener('input', () => {
        if (searchDebounce) {
            clearTimeout(searchDebounce);
        }
        const q = searchInput.value.trim();
        if (q.length < 3) {
            hideResults();
            return;
        }
        searchDebounce = setTimeout(async () => {
            try {
                const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`);
                const raw: unknown = await resp.json();
                if (!Array.isArray(raw)) {
                    hideResults();
                    return;
                }
                if (searchInput.value.trim() !== q) {
                    return;
                }
                if (raw.length === 0) {
                    hideResults();
                    return;
                }
                interface NominatimResult {
                    display_name: string; lat: string; lon: string;
                }
                const data: NominatimResult[] = raw.filter(
                    (r: unknown): r is NominatimResult =>
                        typeof r === 'object' && r !== null &&
                        'display_name' in r && 'lat' in r && 'lon' in r,
                );
                searchResults.innerHTML = data.map(r =>
                    `<button type="button" class="dropdown-item text-wrap" data-lat="${r.lat}" data-lon="${r.lon}">${r.display_name}</button>`,
                ).join('');
                searchResults.classList.add('show');
            } catch {
                hideResults();
            }
        }, 350);
    });

    searchResults.addEventListener('click', e => {
        if (!(e.target instanceof HTMLElement)) {
            return;
        }
        const btn = e.target.closest<HTMLElement>('[data-lat]');
        if (!btn) {
            return;
        }
        const lat = btn.dataset.lat;
        const lng = btn.dataset.lon;
        if (!lat || !lng) {
            return;
        }
        map.setView([parseFloat(lat), parseFloat(lng)], 16);
        hideResults();
        searchInput.value = '';
    });

    document.addEventListener('click', e => {
        if (!(e.target instanceof HTMLElement)) {
            return;
        }
        if (!e.target.closest(`#${p}-map-search, #${p}-map-search-results`)) {
            hideResults();
        }
    });

    setTimeout(() => map.invalidateSize(), 200);

    return {
        getMapBounds() {
            const b = map.getBounds();
            const result: [[number, number], [number, number]] = [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]];
            return result;
        },
        invalidateSize() {
            map.invalidateSize();
        },
    };
}

/**
 * Render the track form fields HTML (no outer wrapper, no buttons).
 */
export function trackFormFieldsHtml(opts: TrackFormOptions): string {
    const p = opts.prefix;
    const v = opts.values ?? {};
    const logoUrl = v.logo_key ? `${assetsBase}/${v.logo_key}` : '';
    const logoLabel = opts.logoRequired ? 'Logo <span class="text-danger">*</span>' : 'Logo';

    const socialFields = `
        <div class="mb-2">
            <div class="input-group input-group-sm">
                <span class="input-group-text"><i class="fa-brands fa-facebook-f fa-fw"></i></span>
                <input type="url" class="form-control" id="${p}-facebook" value="${esc(v.facebook ?? '')}" placeholder="Facebook URL">
            </div>
        </div>
        <div class="mb-2">
            <div class="input-group input-group-sm">
                <span class="input-group-text"><i class="fa-brands fa-instagram fa-fw"></i></span>
                <input type="url" class="form-control" id="${p}-instagram" value="${esc(v.instagram ?? '')}" placeholder="Instagram URL">
            </div>
        </div>
        <div class="mb-2">
            <div class="input-group input-group-sm">
                <span class="input-group-text"><i class="fa-brands fa-youtube fa-fw"></i></span>
                <input type="url" class="form-control" id="${p}-youtube" value="${esc(v.youtube ?? '')}" placeholder="YouTube URL">
            </div>
        </div>
        <div>
            <div class="input-group input-group-sm">
                <span class="input-group-text"><i class="fa-brands fa-tiktok fa-fw"></i></span>
                <input type="url" class="form-control" id="${p}-tiktok" value="${esc(v.tiktok ?? '')}" placeholder="TikTok URL">
            </div>
        </div>`;

    const socialsBlock = opts.collapseSocials ?
        `<div class="mb-3">
            <a class="text-decoration-none small" data-bs-toggle="collapse" href="#${p}-social-fields" role="button" aria-expanded="false">
                <i class="fa-solid fa-chevron-right me-1" id="${p}-social-chevron"></i>Social Profiles
            </a>
            <div class="collapse mt-2" id="${p}-social-fields">${socialFields}</div>
        </div>` :
        `<div class="mb-3">
            <label class="form-label">Social Profiles</label>
            ${socialFields}
        </div>`;

    return `
        <div class="mb-3">
            <label class="form-label" for="${p}-logo">${logoLabel}</label>
            <div class="d-flex align-items-center gap-3">
                <div id="${p}-logo-preview" class="rounded bg-body-secondary d-flex align-items-center justify-content-center flex-shrink-0" style="width:96px;height:96px;overflow:hidden;cursor:pointer" title="Click to ${logoUrl ? 'change' : 'choose'} logo">
                    ${logoUrl ?
                        `<img src="${logoUrl}" alt="Logo" style="width:100%;height:100%;object-fit:cover">` :
                        '<i class="fa-solid fa-image fa-2x text-body-secondary"></i>'
                    }
                </div>
                <div>
                    <input type="file" class="form-control" id="${p}-logo" accept="image/png,image/jpeg,image/webp,image/svg+xml"${opts.logoRequired ? ' required' : ''}>
                    <div class="form-text">PNG, JPG, WebP, or SVG</div>
                </div>
            </div>
        </div>
        <div class="mb-3">
            <label class="form-label" for="${p}-name">Track name <span class="text-danger">*</span></label>
            <input type="text" class="form-control" id="${p}-name" value="${esc(v.name ?? '')}" placeholder="e.g. Speedway Indoor Karting" required>
        </div>
        <div class="mb-3">
            <label class="form-label" for="${p}-email">Email <span class="text-danger">*</span></label>
            <input type="email" class="form-control" id="${p}-email" value="${esc(v.email ?? '')}" placeholder="info@example.com" required>
        </div>
        <div class="mb-3">
            <label class="form-label" for="${p}-phone">Phone <span class="text-danger">*</span></label>
            <input type="tel" class="form-control" id="${p}-phone" required>
        </div>
        <div class="row g-2 mb-3">
            <div class="col">
                <label class="form-label" for="${p}-city">City</label>
                <input type="text" class="form-control" id="${p}-city" value="${esc(v.city ?? '')}" placeholder="City">
            </div>
            <div class="col-auto" style="width:100px">
                <label class="form-label" for="${p}-state">State</label>
                <input type="text" class="form-control" id="${p}-state" value="${esc(v.state ?? '')}" placeholder="OH" maxlength="2">
            </div>
        </div>
        <div class="mb-3">
            <label class="form-label" for="${p}-timezone">Timezone</label>
            <select class="form-select" id="${p}-timezone">
                <option value="">— Select —</option>
                ${timezoneOptions()}
            </select>
        </div>
        <div class="mb-3">
            <label class="form-label" for="${p}-website">Website</label>
            <input type="url" class="form-control" id="${p}-website" value="${esc(v.website ?? '')}" placeholder="https://example.com">
        </div>
        ${socialsBlock}`;
}

/**
 * Bind interactive behaviors after the form HTML is in the DOM.
 * Returns handles needed by collectTrackFields.
 */
export function bindTrackForm(prefix: string, phone?: string): TrackFormBindings {
    const p = prefix;

    // Logo preview click-to-upload
    const logoInput = requireInput(`${p}-logo`);
    const logoPreview = requireEl(`${p}-logo-preview`);
    logoPreview.addEventListener('click', () => logoInput.click());

    let croppedBlob: Blob | null = null;
    logoInput.addEventListener('change', async () => {
        const file = logoInput.files?.[0];
        if (!file) {
            return;
        }

        if (file.type === 'image/svg+xml') {
            croppedBlob = null;
            const url = URL.createObjectURL(file);
            logoPreview.innerHTML = `<img src="${url}" alt="Preview" style="width:100%;height:100%;object-fit:cover">`;
            return;
        }

        const blob = await showCropModal(file);
        if (blob) {
            croppedBlob = blob;
            const url = URL.createObjectURL(blob);
            logoPreview.innerHTML = `<img src="${url}" alt="Preview" style="width:100%;height:100%;object-fit:cover">`;
        } else {
            logoInput.value = '';
        }
    });

    // Phone input with country picker
    const phoneInputEl = requireInput(`${p}-phone`);
    const iti = initPhoneInput(phoneInputEl, phone);

    // Social section chevron rotation (only present when collapseSocials is true)
    const socialFieldsEl = document.getElementById(`${p}-social-fields`);
    const socialChevron = document.getElementById(`${p}-social-chevron`);
    if (socialFieldsEl && socialChevron) {
        socialFieldsEl.addEventListener('show.bs.collapse', () => socialChevron.classList.replace('fa-chevron-right', 'fa-chevron-down'));
        socialFieldsEl.addEventListener('hide.bs.collapse', () => socialChevron.classList.replace('fa-chevron-down', 'fa-chevron-right'));
    }

    return {
        iti,
        logoInput,
        logoPreview,
        get croppedBlob() {
            return croppedBlob;
        },
        set croppedBlob(v: Blob | null) {
            croppedBlob = v;
        },
    };
}

/**
 * Set the timezone <select> to a specific value after binding.
 * Call after bindTrackForm when editing an existing track.
 */
export function setTrackFormTimezone(prefix: string, tz: string): void {
    const sel = document.getElementById(`${prefix}-timezone`);
    if (sel instanceof HTMLSelectElement && tz) {
        sel.value = tz;
    }
}

/**
 * Validate required fields and collect all form values.
 * Returns null if validation fails (fields are marked is-invalid).
 */
export function collectTrackFields(
    prefix: string,
    bindings: TrackFormBindings,
    logoRequired: boolean,
): Record<string, string> | null {
    const p = prefix;
    const nameInput = document.getElementById(`${p}-name`);
    if (!(nameInput instanceof HTMLInputElement)) {
        return null;
    }
    const emailInput = document.getElementById(`${p}-email`);
    if (!(emailInput instanceof HTMLInputElement)) {
        return null;
    }
    const phoneInput = document.getElementById(`${p}-phone`);
    if (!(phoneInput instanceof HTMLInputElement)) {
        return null;
    }

    let valid = true;

    if (!nameInput.value.trim()) {
        nameInput.classList.add('is-invalid');
        valid = false;
    } else {
        nameInput.classList.remove('is-invalid');
    }

    if (!emailInput.value.trim()) {
        emailInput.classList.add('is-invalid');
        valid = false;
    } else {
        emailInput.classList.remove('is-invalid');
    }

    if (!bindings.iti.isValidNumber()) {
        phoneInput.classList.add('is-invalid');
        valid = false;
    } else {
        phoneInput.classList.remove('is-invalid');
    }

    if (logoRequired && !bindings.logoInput.files?.[0]) {
        bindings.logoInput.classList.add('is-invalid');
        valid = false;
    } else {
        bindings.logoInput.classList.remove('is-invalid');
    }

    if (!valid) {
        return null;
    }

    const fields: Record<string, string> = {
        name: nameInput.value.trim(),
        email: emailInput.value.trim(),
        phone: `tel:${bindings.iti.getNumber()}`,
    };

    const getInputValue = (id: string): string => {
        const el = document.getElementById(id);
        if (el instanceof HTMLInputElement) {
            return el.value.trim();
        }
        if (el instanceof HTMLSelectElement) {
            return el.value;
        }
        return '';
    };

    const optionals: [string, string][] = [
        ['city', getInputValue(`${p}-city`)],
        ['state', getInputValue(`${p}-state`).toUpperCase()],
        ['timezone', getInputValue(`${p}-timezone`)],
        ['website', getInputValue(`${p}-website`)],
        ['facebook', getInputValue(`${p}-facebook`)],
        ['instagram', getInputValue(`${p}-instagram`)],
        ['youtube', getInputValue(`${p}-youtube`)],
        ['tiktok', getInputValue(`${p}-tiktok`)],
    ];
    for (const [key, val] of optionals) {
        if (val) {
            fields[key] = val;
        }
    }

    return fields;
}
