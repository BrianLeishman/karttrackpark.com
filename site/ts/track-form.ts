import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import type { Iti } from 'intl-tel-input';
import { showCropModal } from './crop-modal';
import { initPhoneInput } from './phone-input';
import { timezoneOptions } from './tracks';

const assetsBase = document.querySelector<HTMLMetaElement>('meta[name="assets-base"]')?.content ??
    'https://assets.karttrackpark.com';

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

function escAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Returns HTML for the outline map section (map div + clear button).
 */
export function outlineMapHtml(prefix: string): string {
    const p = prefix;
    return `
        <div id="${p}-map" style="aspect-ratio:1/1;border-radius:.375rem;z-index:0"></div>
        <div class="d-flex flex-wrap gap-2 mt-2">
            <button type="button" class="btn btn-sm btn-outline-danger" id="${p}-map-clear" disabled><i class="fa-solid fa-eraser me-1"></i>Clear Outline</button>
            <button type="button" class="btn btn-sm btn-outline-secondary" id="${p}-map-add-turn" disabled><i class="fa-solid fa-location-dot me-1"></i>Add Turn</button>
            <button type="button" class="btn btn-sm btn-outline-success" id="${p}-map-add-sf" disabled><i class="fa-solid fa-flag-checkered me-1"></i>Start/Finish</button>
        </div>
        <div class="form-text" id="${p}-map-hint">Click to draw the track outline. Double-click to finish. Backspace to undo last point.</div>`;
}

/**
 * Bind a Leaflet outline-drawing map after the HTML from outlineMapHtml is in the DOM.
 * The map is locked to the track's map_bounds (no zoom/pan). Drawing uses Leaflet-Geoman.
 * Returns null if no map_bounds are available.
 */
export function bindOutlineMap(prefix: string, initValues?: { track_outline?: string; map_bounds?: string; annotations?: TrackAnnotation[] }): OutlineMapBindings | null {
    const p = prefix;
    const outlinePoints: [number, number][] = [];
    const annotations: TrackAnnotation[] = [];

    const mapEl = requireEl(`${p}-map`);
    const clearBtn = requireButton(`${p}-map-clear`);
    const addTurnBtn = requireButton(`${p}-map-add-turn`);
    const addSfBtn = requireButton(`${p}-map-add-sf`);
    const hintEl = requireEl(`${p}-map-hint`);

    const initOutline = initValues?.track_outline ?? '';
    const initBounds = initValues?.map_bounds ?? '';

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

    if (!savedBounds) {
        mapEl.style.display = 'none';
        clearBtn.style.display = 'none';
        hintEl.innerHTML = '<span class="text-warning"><i class="fa-solid fa-triangle-exclamation me-1"></i>Set your track location on the Edit Track page before drawing outlines.</span>';
        return null;
    }

    // Create map with all interactions disabled — the viewport is locked to track bounds
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

    function getPolylineLatLngs(layer: L.Polyline): L.LatLng[] {
        const raw = layer.getLatLngs();
        if (Array.isArray(raw) && raw.length > 0 && raw[0] instanceof L.LatLng) {
            return raw.filter((ll): ll is L.LatLng => ll instanceof L.LatLng);
        }
        return [];
    }

    function syncPointsFromLayer(layer: L.Polyline) {
        outlinePoints.length = 0;
        const latlngs = getPolylineLatLngs(layer);
        for (const ll of latlngs) {
            outlinePoints.push([ll.lat, ll.lng]);
        }
        clearBtn.disabled = outlinePoints.length === 0;
    }

    function startDrawMode() {
        hintEl.textContent = 'Click to draw the track outline. Double-click to finish. Backspace to undo last point.';
        map.pm.enableDraw('Line', {
            snappable: true,
            finishOn: 'dblclick',
            templineStyle: lineStyle,
            hintlineStyle: { color: '#0d6efd', dashArray: '5,5' },
            pathOptions: lineStyle,
            tooltips: true,
        });
    }

    function setEditableLayer(layer: L.Polyline) {
        currentLayer = layer;
        layer.pm.enable({ allowSelfIntersection: true });
        syncPointsFromLayer(layer);
        hintEl.textContent = 'Drag vertices to adjust. Click Clear to start over.';
        addTurnBtn.disabled = false;
        addSfBtn.disabled = false;

        // Sync points when vertices are moved, added, or removed
        const onEdit = () => {
            syncPointsFromLayer(layer);
            recomputeAnnotationPositions();
        };
        layer.on('pm:edit', onEdit);
        layer.on('pm:vertexadded', onEdit);
        layer.on('pm:vertexremoved', onEdit);
        layer.on('pm:markerdragend', onEdit);
    }

    // --- Snap-to-polyline algorithm ---
    function snapToPolyline(point: L.LatLng, latlngs: L.LatLng[]): { latlng: L.LatLng; position: number } | null {
        if (latlngs.length < 2) {
            return null;
        }

        // Compute cumulative distances along polyline
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
            // Project point onto segment a-b
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

    // --- Annotation marker management ---
    interface AnnotationMarkerEntry {
        annotation: TrackAnnotation;
        marker: L.Marker;
    }
    const annotationMarkers: AnnotationMarkerEntry[] = [];
    let placementMode: 'turn' | 'start_finish' | null = null;

    function createAnnotationIcon(label: string, type: 'turn' | 'start_finish'): L.DivIcon {
        const bg = type === 'start_finish' ? '#198754' : '#0d6efd';
        return L.divIcon({
            className: '',
            html: `<div class="annotation-marker" style="background:${bg}">${label}</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
        });
    }

    function getAnnotationLabels(): Map<TrackAnnotation, string> {
        const labels = new Map<TrackAnnotation, string>();
        const turns = annotations.
            filter(a => a.type === 'turn').
            sort((a, b) => a.position - b.position);
        turns.forEach((a, i) => {
            let label = `T${i + 1}`;
            if (a.name) {
                label += ` ${a.name}`;
            }
            labels.set(a, label);
        });
        for (const a of annotations) {
            if (a.type === 'start_finish') {
                labels.set(a, 'S/F');
            }
        }
        return labels;
    }

    function refreshAnnotationIcons() {
        const labels = getAnnotationLabels();
        for (const entry of annotationMarkers) {
            const label = labels.get(entry.annotation) ?? '?';
            entry.marker.setIcon(createAnnotationIcon(label, entry.annotation.type));
        }
    }

    function addAnnotationMarker(a: TrackAnnotation) {
        const labels = getAnnotationLabels();
        const label = labels.get(a) ?? (a.type === 'start_finish' ? 'S/F' : 'T?');
        const marker = L.marker([a.lat, a.lng], {
            icon: createAnnotationIcon(label, a.type),
            draggable: true,
        }).addTo(map);

        const entry: AnnotationMarkerEntry = { annotation: a, marker };
        annotationMarkers.push(entry);

        // Drag: constrain to polyline
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
        marker.on('dragend', () => refreshAnnotationIcons());

        // Click: popover with name input + delete
        marker.on('click', () => {
            const existing = document.querySelector('.annotation-popover');
            if (existing) {
                existing.remove();
            }

            const popoverDiv = document.createElement('div');
            popoverDiv.className = 'annotation-popover card shadow-sm position-absolute';
            popoverDiv.style.cssText = 'z-index:1000;width:200px;';
            const markerPos = map.latLngToContainerPoint(marker.getLatLng());
            popoverDiv.style.left = `${markerPos.x + 10}px`;
            popoverDiv.style.top = `${markerPos.y - 10}px`;
            popoverDiv.innerHTML = `
                <div class="card-body p-2">
                    ${a.type === 'turn' ? `<input type="text" class="form-control form-control-sm mb-2" placeholder="Name (e.g. Hairpin)" value="${escAttr(a.name ?? '')}">` : ''}
                    <button type="button" class="btn btn-sm btn-outline-danger w-100"><i class="fa-solid fa-trash me-1"></i>Delete</button>
                </div>`;
            mapEl.style.position = 'relative';
            mapEl.appendChild(popoverDiv);

            const nameInput = popoverDiv.querySelector('input');
            if (nameInput) {
                nameInput.addEventListener('input', () => {
                    a.name = nameInput.value.trim() || undefined;
                    refreshAnnotationIcons();
                });
            }

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
                refreshAnnotationIcons();
            });

            // Close popover on outside click
            const closePopover = (ev: MouseEvent) => {
                if (ev.target instanceof Node && !popoverDiv.contains(ev.target)) {
                    popoverDiv.remove();
                    document.removeEventListener('click', closePopover);
                }
            };
            setTimeout(() => document.addEventListener('click', closePopover), 0);
        });

        refreshAnnotationIcons();
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

    // --- Placement mode ---
    function enterPlacementMode(type: 'turn' | 'start_finish') {
        placementMode = type;
        const btn = type === 'turn' ? addTurnBtn : addSfBtn;
        btn.classList.add('active');
        hintEl.textContent = type === 'turn' ?
            'Click on the outline to place a turn marker.' :
            'Click on the outline to place the start/finish marker.';
        mapEl.style.cursor = 'crosshair';
    }

    function exitPlacementMode() {
        placementMode = null;
        addTurnBtn.classList.remove('active');
        addSfBtn.classList.remove('active');
        hintEl.textContent = 'Drag vertices to adjust. Click Clear to start over.';
        mapEl.style.cursor = '';
    }

    addTurnBtn.addEventListener('click', () => {
        if (placementMode === 'turn') {
            exitPlacementMode();
            return;
        }
        exitPlacementMode();
        enterPlacementMode('turn');
    });

    addSfBtn.addEventListener('click', () => {
        if (placementMode === 'start_finish') {
            exitPlacementMode();
            return;
        }
        exitPlacementMode();
        enterPlacementMode('start_finish');
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
        if (!placementMode || !currentLayer) {
            return;
        }
        const latlngs = getPolylineLatLngs(currentLayer);
        const snap = snapToPolyline(e.latlng, latlngs);
        if (!snap) {
            return;
        }

        const type = placementMode;

        // For start_finish, remove any existing one first
        if (type === 'start_finish') {
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
        }

        const annotation: TrackAnnotation = {
            type,
            lat: snap.latlng.lat,
            lng: snap.latlng.lng,
            position: snap.position,
        };
        annotations.push(annotation);
        addAnnotationMarker(annotation);

        // Hide hint after first placement click
        hintEl.textContent = '';

        // Turns stay in placement mode (toggle); S/F exits since only one allowed
        if (type === 'start_finish') {
            exitPlacementMode();
        }
    });

    // Load existing outline
    if (initOutline) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSON.parse returns any
            const geojson: { geometry?: { coordinates?: unknown } } = JSON.parse(initOutline);
            const rawCoords = geojson.geometry?.coordinates;
            const coords: unknown[] = Array.isArray(rawCoords) ? rawCoords : [];
            const loadedPoints: [number, number][] = [];
            for (const c of coords) {
                if (Array.isArray(c) && c.length >= 2) {
                    loadedPoints.push([Number(c[1]), Number(c[0])]);
                }
            }
            if (loadedPoints.length >= 2) {
                const polyline = L.polyline(loadedPoints, lineStyle).addTo(map);
                setEditableLayer(polyline);
            }
        } catch { /* ignore bad JSON */ }
    }

    // Load existing annotations
    if (currentLayer && initValues?.annotations) {
        for (const a of initValues.annotations) {
            const annotation: TrackAnnotation = { ...a };
            annotations.push(annotation);
            addAnnotationMarker(annotation);
        }
    }

    // If no existing outline, start draw mode
    if (!currentLayer) {
        startDrawMode();
    }

    // Handle newly drawn line
    map.on('pm:create', e => {
        const layer = e.layer;
        if (layer instanceof L.Polyline) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- Geoman create event layer type is generic
            setEditableLayer(layer);
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
        exitPlacementMode();
        addTurnBtn.disabled = true;
        addSfBtn.disabled = true;
        clearBtn.disabled = true;
        startDrawMode();
    });

    // Keyboard: Backspace/Ctrl+Z to remove last vertex during drawing
    const keyHandler = (e: KeyboardEvent) => {
        if (!map.pm.globalDrawModeEnabled()) {
            return;
        }
        if (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) {
            e.preventDefault();
            // Access the active draw instance to remove last vertex
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
                <input type="url" class="form-control" id="${p}-facebook" value="${escAttr(v.facebook ?? '')}" placeholder="Facebook URL">
            </div>
        </div>
        <div class="mb-2">
            <div class="input-group input-group-sm">
                <span class="input-group-text"><i class="fa-brands fa-instagram fa-fw"></i></span>
                <input type="url" class="form-control" id="${p}-instagram" value="${escAttr(v.instagram ?? '')}" placeholder="Instagram URL">
            </div>
        </div>
        <div class="mb-2">
            <div class="input-group input-group-sm">
                <span class="input-group-text"><i class="fa-brands fa-youtube fa-fw"></i></span>
                <input type="url" class="form-control" id="${p}-youtube" value="${escAttr(v.youtube ?? '')}" placeholder="YouTube URL">
            </div>
        </div>
        <div>
            <div class="input-group input-group-sm">
                <span class="input-group-text"><i class="fa-brands fa-tiktok fa-fw"></i></span>
                <input type="url" class="form-control" id="${p}-tiktok" value="${escAttr(v.tiktok ?? '')}" placeholder="TikTok URL">
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
            <input type="text" class="form-control" id="${p}-name" value="${escAttr(v.name ?? '')}" placeholder="e.g. Speedway Indoor Karting" required>
        </div>
        <div class="mb-3">
            <label class="form-label" for="${p}-email">Email <span class="text-danger">*</span></label>
            <input type="email" class="form-control" id="${p}-email" value="${escAttr(v.email ?? '')}" placeholder="info@example.com" required>
        </div>
        <div class="mb-3">
            <label class="form-label" for="${p}-phone">Phone <span class="text-danger">*</span></label>
            <input type="tel" class="form-control" id="${p}-phone" required>
        </div>
        <div class="row g-2 mb-3">
            <div class="col">
                <label class="form-label" for="${p}-city">City</label>
                <input type="text" class="form-control" id="${p}-city" value="${escAttr(v.city ?? '')}" placeholder="City">
            </div>
            <div class="col-auto" style="width:100px">
                <label class="form-label" for="${p}-state">State</label>
                <input type="text" class="form-control" id="${p}-state" value="${escAttr(v.state ?? '')}" placeholder="OH" maxlength="2">
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
            <input type="url" class="form-control" id="${p}-website" value="${escAttr(v.website ?? '')}" placeholder="https://example.com">
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
