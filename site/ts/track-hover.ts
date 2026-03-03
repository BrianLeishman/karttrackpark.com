import axios from 'axios';
import L from 'leaflet';
import { Popover } from 'bootstrap';

interface TrackPublic {
    track_id: string;
    name: string;
    logo_key?: string;
    city?: string;
    state?: string;
    track_outline?: string;
    map_bounds?: string;
}

const apiBase = document.querySelector<HTMLMetaElement>('meta[name="api-base"]')?.content ??
    'https://62lt3y3apd.execute-api.us-east-1.amazonaws.com';

const assetsBase = document.querySelector<HTMLMetaElement>('meta[name="assets-base"]')?.content ??
    'https://assets.karttrackpark.com';

const cache = new Map<string, TrackPublic>();

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildContent(track: TrackPublic): string {
    const logo = track.logo_key ?
        `<img src="${assetsBase}/${track.logo_key}" alt="" width="32" height="32" class="rounded flex-shrink-0" style="object-fit:cover">` :
        '<div class="rounded bg-body-secondary flex-shrink-0 d-flex align-items-center justify-content-center" style="width:32px;height:32px"><i class="fa-solid fa-flag-checkered small"></i></div>';
    const location = [track.city, track.state].filter(Boolean).join(', ');
    const hasMap = Boolean(track.map_bounds);
    const mapDiv = hasMap ? '<div class="track-hover-map" style="aspect-ratio:1/1;width:320px;border-radius:.25rem;margin-top:.5rem"></div>' : '';

    return `<div style="min-width:320px">
        <div class="d-flex align-items-center gap-2">
            ${logo}
            <div>
                <div class="fw-semibold">${esc(track.name)}</div>
                ${location ? `<div class="text-body-secondary small">${esc(location)}</div>` : ''}
            </div>
        </div>
        ${mapDiv}
    </div>`;
}

function initMap(popoverEl: HTMLElement, track: TrackPublic): void {
    const mapEl = popoverEl.querySelector<HTMLElement>('.track-hover-map');
    if (!mapEl || !track.map_bounds) {
        return;
    }

    let bounds: L.LatLngBoundsExpression;
    try {
        const parsed: unknown = JSON.parse(track.map_bounds);
        if (!Array.isArray(parsed) || parsed.length !== 2 ||
            !Array.isArray(parsed[0]) || !Array.isArray(parsed[1])) {
            return;
        }
        bounds = [[Number(parsed[0][0]), Number(parsed[0][1])], [Number(parsed[1][0]), Number(parsed[1][1])]];
    } catch {
        return;
    }

    const map = L.map(mapEl, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        touchZoom: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        zoomSnap: 0.1,
    });
    map.fitBounds(bounds);

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
    }).addTo(map);
    L.tileLayer('https://stamen-tiles.a.ssl.fastly.net/toner-lines/{z}/{x}/{y}{r}.png', {
        maxZoom: 19, opacity: 0.4,
    }).addTo(map);
    L.tileLayer('https://stamen-tiles.a.ssl.fastly.net/toner-labels/{z}/{x}/{y}{r}.png', {
        maxZoom: 19, opacity: 0.7,
    }).addTo(map);

    // Draw track outline if available
    if (track.track_outline) {
        try {
            const geojson: unknown = JSON.parse(track.track_outline);
            const geo = typeof geojson === 'object' && geojson !== null && 'geometry' in geojson ? geojson.geometry : undefined;
            const rawCoords = typeof geo === 'object' && geo !== null && 'coordinates' in geo ? geo.coordinates : undefined;
            const coords: unknown[] = Array.isArray(rawCoords) ? rawCoords : [];
            if (coords.length >= 2) {
                const latLngs: [number, number][] = coords.
                    filter((c): c is number[] => Array.isArray(c) && c.length >= 2).
                    map(c => [Number(c[1]), Number(c[0])]);
                L.polyline(latLngs, { color: '#0d6efd', weight: 3 }).addTo(map);
            }
        } catch { /* ignore bad JSON */ }
    }
}

export function initTrackHoverCards(): void {
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let activePop: Popover | null = null;
    let activeEl: HTMLElement | null = null;

    function clearTimers() {
        if (showTimer) {
            clearTimeout(showTimer);
            showTimer = null;
        }
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
    }

    function hidePopover() {
        if (activePop) {
            activePop.dispose();
            activePop = null;
        }
        activeEl = null;
    }

    function startHide() {
        clearTimers();
        hideTimer = setTimeout(hidePopover, 200);
    }

    // Use capture-phase listener for mouseenter (event delegation)
    document.addEventListener('mouseenter', e => {
        if (!(e.target instanceof HTMLElement)) {
            return;
        }
        const el = e.target.closest<HTMLElement>('[data-track-hover]');
        if (!el) {
            return;
        }

        // If already showing for this element, cancel hide
        if (el === activeEl) {
            clearTimers();
            return;
        }

        clearTimers();
        hidePopover();

        showTimer = setTimeout(async () => {
            const trackId = el.dataset.trackHover;
            if (!trackId) {
                return;
            }

            // Fetch or use cache
            let track = cache.get(trackId);
            if (!track) {
                try {
                    const resp = await axios.get<TrackPublic>(`${apiBase}/api/tracks/${trackId}/public`);
                    track = resp.data;
                    cache.set(trackId, track);
                } catch {
                    return;
                }
            }

            // Verify we still want to show (mouse might have left)
            if (activeEl !== null && activeEl !== el) {
                return;
            }

            activeEl = el;
            activePop = new Popover(el, {
                html: true,
                sanitize: false,
                trigger: 'manual',
                placement: 'auto',
                customClass: 'track-hover-popover',
                content: buildContent(track),
            });
            activePop.show();

            // Init map after popover is shown
            const popoverEl = document.querySelector('.popover:last-of-type');
            if (popoverEl instanceof HTMLElement && track) {
                initMap(popoverEl, track);

                // Allow hovering into the popover itself
                popoverEl.addEventListener('mouseenter', () => clearTimers());
                popoverEl.addEventListener('mouseleave', () => startHide());
            }
        }, 300);
    }, true);

    document.addEventListener('mouseleave', e => {
        if (!(e.target instanceof HTMLElement)) {
            return;
        }
        const el = e.target.closest<HTMLElement>('[data-track-hover]');
        if (!el || el !== activeEl) {
            return;
        }
        startHide();
    }, true);
}
