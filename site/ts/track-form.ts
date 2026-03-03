import L from 'leaflet';
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
    track_outline?: string;
    map_bounds?: string;
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
    outlinePoints: [number, number][];
    getMapBounds: () => [[number, number], [number, number]];
}

function escAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
        ${socialsBlock}
        <div class="mb-3">
            <label class="form-label">Location &amp; Track Outline</label>
            <div class="position-relative mb-2">
                <div class="input-group input-group-sm">
                    <span class="input-group-text"><i class="fa-solid fa-magnifying-glass"></i></span>
                    <input type="text" class="form-control" id="${p}-map-search" placeholder="Search for a location\u2026" autocomplete="off">
                </div>
                <div id="${p}-map-search-results" class="dropdown-menu w-100 overflow-auto" style="max-height:240px"></div>
            </div>
            <div id="${p}-map" style="aspect-ratio:1/1;border-radius:.375rem;z-index:0"></div>
            <div class="d-flex flex-wrap gap-2 mt-2">
                <button type="button" class="btn btn-sm btn-outline-primary" id="${p}-map-draw"><i class="fa-solid fa-draw-polygon me-1"></i>Draw Outline</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" id="${p}-map-undo" disabled><i class="fa-solid fa-rotate-left me-1"></i>Undo</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" id="${p}-map-fit" disabled><i class="fa-solid fa-expand me-1"></i>Fit to Outline</button>
                <button type="button" class="btn btn-sm btn-outline-danger" id="${p}-map-clear-outline" disabled><i class="fa-solid fa-eraser me-1"></i>Clear Outline</button>
            </div>
            <div class="form-text" id="${p}-map-hint">Pan and zoom the map to frame the track. The visible area will be saved. Use Draw Outline to trace the track shape.</div>
        </div>`;
}

/**
 * Bind interactive behaviors after the form HTML is in the DOM.
 * Returns handles needed by collectTrackFields.
 */
export function bindTrackForm(prefix: string, phone?: string, mapValues?: { track_outline?: string; map_bounds?: string }): TrackFormBindings {
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

    // --- Leaflet map ---
    const outlinePoints: [number, number][] = [];

    const mapEl = requireEl(`${p}-map`);
    const drawBtn = requireButton(`${p}-map-draw`);
    const undoBtn = requireButton(`${p}-map-undo`);
    const fitBtn = requireButton(`${p}-map-fit`);
    const clearOutlineBtn = requireButton(`${p}-map-clear-outline`);
    const hintEl = requireEl(`${p}-map-hint`);

    // Pre-fill map values
    const initOutline = mapValues?.track_outline ?? '';
    const initBounds = mapValues?.map_bounds ?? '';

    // Parse saved bounds: JSON string "[[south,west],[north,east]]"
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
    // Default: hybrid (satellite + roads + labels)
    satelliteLayer.addTo(map);
    labelsOverlay.addTo(map);
    roadsOverlay.addTo(map);
    L.control.layers(
        { 'Hybrid': satelliteLayer, 'Street': osmLayer },
        { 'Roads': roadsOverlay, 'Labels': labelsOverlay },
        { position: 'topright' },
    ).addTo(map);
    // When switching to street view, remove overlays; when switching back, re-add them
    map.on('baselayerchange', (e: L.LayersControlEvent) => {
        if (e.name === 'Street') {
            map.removeLayer(roadsOverlay);
            map.removeLayer(labelsOverlay);
        } else {
            roadsOverlay.addTo(map);
            labelsOverlay.addTo(map);
        }
    });

    let polyline: L.Polyline | null = null;
    let drawing = false;

    function updateButtons() {
        drawBtn.classList.toggle('active', drawing);
        undoBtn.disabled = outlinePoints.length === 0;
        fitBtn.disabled = outlinePoints.length < 2;
        clearOutlineBtn.disabled = outlinePoints.length === 0;
        if (drawing) {
            hintEl.textContent = 'Click the map to add outline points. Use Undo to remove the last point.';
        } else {
            hintEl.textContent = 'Pan and zoom the map to frame the track. The visible area will be saved. Use Draw Outline to trace the track shape.';
        }
        mapEl.style.cursor = drawing ? 'crosshair' : '';
    }

    function redrawPolyline() {
        if (polyline) {
            map.removeLayer(polyline);
            polyline = null;
        }
        if (outlinePoints.length >= 2) {
            polyline = L.polyline(outlinePoints, { color: '#0d6efd', weight: 3 }).addTo(map);
        }
    }

    // Pre-fill existing outline (GeoJSON LineString: coordinates are [lng, lat])
    if (initOutline) {
        try {
            const geojson: unknown = JSON.parse(initOutline);
            const geo = typeof geojson === 'object' && geojson !== null && 'geometry' in geojson ? geojson.geometry : undefined;
            const rawCoords = typeof geo === 'object' && geo !== null && 'coordinates' in geo ? geo.coordinates : undefined;
            const coords: unknown[] = Array.isArray(rawCoords) ? rawCoords : [];
            for (const c of coords) {
                if (Array.isArray(c) && c.length >= 2) {
                    outlinePoints.push([Number(c[1]), Number(c[0])]);
                }
            }
            redrawPolyline();
        } catch { /* ignore bad JSON */ }
    }

    drawBtn.addEventListener('click', () => {
        drawing = !drawing;
        updateButtons();
    });

    undoBtn.addEventListener('click', () => {
        outlinePoints.pop();
        redrawPolyline();
        updateButtons();
    });

    fitBtn.addEventListener('click', () => {
        if (outlinePoints.length >= 2) {
            map.fitBounds(L.latLngBounds(outlinePoints), { padding: [30, 30] });
        }
    });

    clearOutlineBtn.addEventListener('click', () => {
        outlinePoints.length = 0;
        redrawPolyline();
        updateButtons();
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
        if (drawing) {
            outlinePoints.push([e.latlng.lat, e.latlng.lng]);
            redrawPolyline();
            updateButtons();
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
                } // stale
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

    // Close results when clicking elsewhere
    document.addEventListener('click', e => {
        if (!(e.target instanceof HTMLElement)) {
            return;
        }
        if (!e.target.closest(`#${p}-map-search, #${p}-map-search-results`)) {
            hideResults();
        }
    });

    updateButtons();

    // Force a resize after the map container is visible (handles tab/collapse timing)
    setTimeout(() => map.invalidateSize(), 200);

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
        get outlinePoints() {
            return outlinePoints;
        },
        getMapBounds() {
            const b = map.getBounds();
            const result: [[number, number], [number, number]] = [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]];
            return result;
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
