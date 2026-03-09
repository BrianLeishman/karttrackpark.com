import axios from 'axios';
import L from 'leaflet';
import { apiBase } from './api';
import { esc, formatLapTime, buildSessionInfoPills, SESSION_TYPE_BADGE_COLORS, initTooltips } from './html';
import { createAnnotationIcon } from './track-form';
import type { TrackAnnotation } from './track-form';
import {
    isHugoServer, trackDetailUrl, championshipDetailUrl,
    seriesDetailUrl, eventDetailUrl, sessionDetailUrl,
    driverDetailUrl,
} from './url-utils';

// ─── Interfaces ───

interface GpsPoint {
    tc_ms: number;
    lat: number;
    lon: number;
    speed_mph: number;
    dist_ft: number;
    alt_m: number;
}

interface SensorPoint {
    tc_ms: number;
    val: number;
}

interface TelemetryData {
    gps: GpsPoint[];
    sensors: Record<string, SensorPoint[]>;
    summary: {
        max_speed_mph: number;
        max_lat_g: number;
        dist_ft: number;
    };
}

interface Session {
    session_id: string;
    track_id: string;
    event_id?: string;
    session_name?: string;
    session_type?: string;
    layout_id?: string;
    reverse?: boolean;
    start_type?: string;
    lap_limit?: number;
    class_ids?: string[];
}

interface LayoutOption {
    layout_id: string;
    name: string;
}

interface KartClassOption {
    class_id: string;
    name: string;
}

interface LapItem {
    session_id: string;
    lap_no: number;
    lap_time_ms: number;
    max_speed?: number;
    uid: string;
    driver_name?: string;
}

interface EventDetail {
    event_id: string;
    track_id: string;
    name: string;
    series?: SeriesContext[];
}

interface SeriesContext {
    series_id: string;
    series_name: string;
    championship_id: string;
    championship_name: string;
    championship_logo_key?: string;
    round_number: number;
}

interface TrackPublic {
    track_id: string;
    name: string;
    logo_key?: string;
    annotations?: TrackAnnotation[];
}

interface LayoutPublic {
    layout_id: string;
    name: string;
    annotations?: TrackAnnotation[];
}

// ─── URL helpers ───

export function getLapAnalysisIds(): { sessionId: string; uid: string; lapNo: number } | null {
    if (isHugoServer()) {
        const params = new URLSearchParams(window.location.search);
        const sessionId = params.get('id');
        const uid = params.get('driver');
        const lap = params.get('lap');
        if (sessionId && uid && lap) {
            return { sessionId, uid, lapNo: parseInt(lap, 10) };
        }
        return null;
    }
    const match = /^\/sessions\/([a-z0-9]+)\/[^/]+\/driver\/([a-z0-9]+)\/[^/]+\/analyze\/(\d+)/.exec(window.location.pathname);
    if (match) {
        return { sessionId: match[1], uid: match[2], lapNo: parseInt(match[3], 10) };
    }
    return null;
}

// ─── Data processing ───

function sensorToDistance(sensor: SensorPoint[], gps: GpsPoint[]): { x: number; y: number }[] {
    if (gps.length === 0 || sensor.length === 0) {
        return [];
    }
    const result: { x: number; y: number }[] = [];
    let gi = 0;
    for (const s of sensor) {
        while (gi < gps.length - 1 && gps[gi + 1].tc_ms <= s.tc_ms) {
            gi++;
        }
        let dist: number;
        if (gi >= gps.length - 1) {
            dist = gps[gps.length - 1].dist_ft;
        } else {
            const g0 = gps[gi];
            const g1 = gps[gi + 1];
            const span = g1.tc_ms - g0.tc_ms;
            if (span <= 0) {
                dist = g0.dist_ft;
            } else {
                const t = (s.tc_ms - g0.tc_ms) / span;
                dist = g0.dist_ft + t * (g1.dist_ft - g0.dist_ft);
            }
        }
        result.push({ x: Math.max(0, dist), y: s.val });
    }
    return result;
}

function findGpsAtDistance(gps: GpsPoint[], distFt: number): GpsPoint | null {
    if (gps.length === 0) {
        return null;
    }
    let lo = 0;
    let hi = gps.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (gps[mid].dist_ft < distFt) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    if (lo > 0 && Math.abs(gps[lo - 1].dist_ft - distFt) < Math.abs(gps[lo].dist_ft - distFt)) {
        return gps[lo - 1];
    }
    return gps[lo];
}

function findNearestIndex(data: { x: number }[], target: number): number {
    if (data.length === 0) {
        return 0;
    }
    let lo = 0;
    let hi = data.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (data[mid].x < target) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    if (lo > 0 && Math.abs(data[lo - 1].x - target) < Math.abs(data[lo].x - target)) {
        return lo - 1;
    }
    return lo;
}

// ─── Main renderer ───

export async function renderLapAnalysis(container: HTMLElement): Promise<void> {
    const ids = getLapAnalysisIds();
    if (!ids) {
        container.innerHTML = '<div class="alert alert-warning">Invalid analysis URL.</div>';
        return;
    }

    // Break out of Bootstrap container for full-screen layout
    const mainEl = container.closest('main');
    if (mainEl) {
        mainEl.classList.remove('container', 'py-4');
        mainEl.classList.add('analysis-fullscreen');
    }

    container.innerHTML = '<div class="d-flex align-items-center justify-content-center h-100"><div class="spinner-border" role="status"></div></div>';

    // Fetch session + laps + telemetry
    let session: Session;
    let laps: LapItem[];
    let telemetry: TelemetryData;

    try {
        const [sessionResp, lapsResp, telemetryResp] = await Promise.all([
            axios.get<Session>(`${apiBase}/api/sessions/${ids.sessionId}/public`),
            axios.get<LapItem[]>(`${apiBase}/api/sessions/${ids.sessionId}/laps`),
            axios.get<TelemetryData>(`${apiBase}/api/sessions/${ids.sessionId}/laps/${ids.uid}/${ids.lapNo}/telemetry`),
        ]);
        session = sessionResp.data;
        laps = lapsResp.data;
        telemetry = telemetryResp.data;
    } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
            container.innerHTML = '<div class="alert alert-warning m-4">Lap telemetry not found.</div>';
        } else {
            container.innerHTML = '<div class="alert alert-danger m-4">Failed to load data.</div>';
        }
        return;
    }

    if (!telemetry.gps || telemetry.gps.length === 0) {
        container.innerHTML = '<div class="alert alert-warning m-4">No GPS data available for this lap.</div>';
        return;
    }

    const lap = laps.find(l => l.lap_no === ids.lapNo && l.uid === ids.uid);
    const driverName = lap?.driver_name ?? ids.uid;
    const lapTimeMs = lap?.lap_time_ms ?? 0;
    const sessionName = session.session_name ?? 'Session';
    document.title = `Lap ${String(ids.lapNo)} Analysis \u2014 ${driverName} \u2014 ${sessionName} \u2014 Kart Track Park`;

    // Fetch track (with annotations) + event + layouts + classes for breadcrumbs + info pills
    let track: TrackPublic | null = null;
    let event: EventDetail | null = null;
    let layout: LayoutPublic | null = null;
    let layouts: LayoutOption[] = [];
    let classes: KartClassOption[] = [];

    try {
        const [trackResp, eventResult, layoutsResp, classesResp] = await Promise.all([
            axios.get<TrackPublic>(`${apiBase}/api/tracks/${session.track_id}/public`),
            session.event_id ?
                axios.get<EventDetail>(`${apiBase}/api/events/${session.event_id}`).then(r => r.data, () => null) :
                Promise.resolve(null),
            axios.get<LayoutOption[]>(`${apiBase}/api/tracks/${session.track_id}/layouts`).then(r => r.data, () => []),
            axios.get<KartClassOption[]>(`${apiBase}/api/tracks/${session.track_id}/classes`).then(r => r.data, () => []),
        ]);
        track = trackResp.data;
        event = eventResult;
        layouts = layoutsResp;
        classes = classesResp;
    } catch {
        // Non-fatal
    }

    // Fetch layout-specific outline/annotations if session has a layout
    if (session.layout_id && track) {
        try {
            const resp = await axios.get<LayoutPublic>(
                `${apiBase}/api/tracks/${session.track_id}/layouts/${session.layout_id}`,
            );
            layout = resp.data;
        } catch {
            // Fall back to track defaults
        }
    }

    // Build breadcrumb
    const seriesCtx = event?.series?.[0];
    const crumbs: string[] = [];
    if (track) {
        crumbs.push(`<a href="${trackDetailUrl(track.track_id, track.name)}" class="text-body-secondary text-decoration-none">${esc(track.name)}</a>`);
    }
    if (seriesCtx) {
        crumbs.push(`<a href="${championshipDetailUrl(seriesCtx.championship_id, seriesCtx.championship_name)}" class="text-body-secondary text-decoration-none">${esc(seriesCtx.championship_name)}</a>`);
        crumbs.push(`<a href="${seriesDetailUrl(seriesCtx.series_id, seriesCtx.series_name)}" class="text-body-secondary text-decoration-none">${esc(seriesCtx.series_name)}</a>`);
    }
    if (event) {
        crumbs.push(`<a href="${eventDetailUrl(event.event_id, event.name, seriesCtx ? { championship_name: seriesCtx.championship_name, series_name: seriesCtx.series_name } : undefined)}" class="text-body-secondary text-decoration-none">${esc(event.name)}</a>`);
    }
    crumbs.push(`<a href="${sessionDetailUrl(session.session_id, sessionName)}" class="text-body-secondary text-decoration-none">${esc(sessionName)}</a>`);
    crumbs.push(`<a href="${driverDetailUrl(session.session_id, sessionName, ids.uid, driverName)}" class="text-body-secondary text-decoration-none">${esc(driverName)}</a>`);

    const summary = telemetry.summary;
    // Prefer GPS-derived accel (gravity-free) over raw IMU
    const accelKey = telemetry.sensors.GLnA?.length ? 'GLnA' : 'InlA';
    const latKey = telemetry.sensors.GLtA?.length ? 'GLtA' : 'LatA';
    const hasAccel = Boolean(telemetry.sensors[accelKey]?.length);
    const hasLat = Boolean(telemetry.sensors[latKey]?.length);

    // Header stats
    const stats: string[] = [];
    stats.push(`<span class="font-monospace fw-semibold">${formatLapTime(lapTimeMs)}</span>`);
    if (summary.max_speed_mph > 0) {
        stats.push(`<span>${summary.max_speed_mph.toFixed(1)} mph</span>`);
    }
    if (summary.max_lat_g > 0) {
        stats.push(`<span>${summary.max_lat_g.toFixed(2)} G lat</span>`);
    }
    if (summary.dist_ft > 0) {
        const distMi = summary.dist_ft / 5280;
        const distLabel = distMi >= 0.5 ? `${distMi.toFixed(2)} mi` : `${String(Math.round(summary.dist_ft))} ft`;
        stats.push(`<span>${distLabel}</span>`);
    }

    const backUrl = driverDetailUrl(session.session_id, sessionName, ids.uid, driverName);

    // Session type badge
    const sessionType = session.session_type ?? '';
    const badgeColor = SESSION_TYPE_BADGE_COLORS[sessionType] ?? 'text-bg-secondary';
    const typeBadgeHtml = sessionType ? `<span class="badge ${badgeColor}" style="font-size:.7rem">${sessionType.replace('_', ' ')}</span>` : '';

    // Info pills (layout, class, start type, scoring)
    const layoutMap = new Map(layouts.map(l => [l.layout_id, l.name]));
    const classMap = new Map(classes.map(c => [c.class_id, c.name]));
    const infoPills = buildSessionInfoPills({ ...session, track_id: session.track_id }, layoutMap, classMap);

    container.innerHTML = `
        <div class="analysis-page">
            <div class="analysis-header">
                <a href="${backUrl}" class="btn btn-sm btn-outline-secondary" title="Back to driver laps">
                    <i class="fa-solid fa-arrow-left"></i>
                </a>
                <div class="me-auto">
                    <div class="text-body-secondary" style="font-size:.7rem">
                        ${crumbs.join(' <i class="fa-solid fa-chevron-right mx-1" style="font-size:.45rem"></i> ')}
                    </div>
                    <div class="d-flex align-items-center gap-2">
                        <span class="fw-semibold" style="font-size:.95rem">Lap ${String(ids.lapNo)} Analysis</span>
                        ${typeBadgeHtml}
                        ${infoPills.length > 0 ? `<span class="d-none d-lg-flex gap-2 text-body-secondary" style="font-size:.75rem">${infoPills.join('')}</span>` : ''}
                    </div>
                </div>
                <div class="d-flex gap-3 text-body-secondary small d-none d-md-flex">
                    ${stats.join('<span class="text-body-tertiary">|</span>')}
                </div>
            </div>
            <div class="analysis-content">
                <div class="analysis-map-wrap">
                    <div id="analysis-leaflet-map"></div>
                </div>
                <div class="analysis-charts">
                    <div class="analysis-chart-panel">
                        <canvas id="speed-chart"></canvas>
                    </div>
                    ${hasAccel ? '<div class="analysis-chart-panel"><canvas id="accel-chart"></canvas></div>' : ''}
                    ${hasLat ? '<div class="analysis-chart-panel"><canvas id="latg-chart"></canvas></div>' : ''}
                </div>
            </div>
        </div>
    `;

    initTooltips(container);

    // ─── Render Leaflet satellite map ───
    const gps = telemetry.gps;
    // Merge layout annotations (S/F) with track annotations (turns), deduplicating by type
    const layoutAnns = layout?.annotations ?? [];
    const layoutTypes = new Set(layoutAnns.map(a => a.type));
    const trackAnns = (track?.annotations ?? []).filter(a => !layoutTypes.has(a.type));
    const annotations = [...layoutAnns, ...trackAnns];

    const mapEl = container.querySelector<HTMLElement>('#analysis-leaflet-map');
    let positionMarker: L.CircleMarker | null = null;

    if (mapEl) {
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

        // Tile layers for background switching
        const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
        });
        const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
        });
        const linesOverlay = L.tileLayer('https://stamen-tiles.a.ssl.fastly.net/toner-lines/{z}/{x}/{y}{r}.png', {
            maxZoom: 19, opacity: 0.4,
        });
        const labelsOverlay = L.tileLayer('https://stamen-tiles.a.ssl.fastly.net/toner-labels/{z}/{x}/{y}{r}.png', {
            maxZoom: 19, opacity: 0.7,
        });

        // Default: satellite + overlays
        satelliteLayer.addTo(map);
        linesOverlay.addTo(map);
        labelsOverlay.addTo(map);

        // Fit to GPS lap bounds (zoom to the actual lap data, not the saved track bounds)
        const gpsBounds = L.latLngBounds(gps.map(p => L.latLng(p.lat, p.lon)));
        map.fitBounds(gpsBounds, { padding: [20, 20] });

        // Draw GPS trace as gray polyline (no track outline — only the lap data)
        const traceLatLngs: [number, number][] = gps.map(p => [p.lat, p.lon]);
        L.polyline(traceLatLngs, {
            color: '#0d6efd',
            opacity: 1,
            weight: 3,
        }).addTo(map);

        // Draw annotations (turns + start/finish) into a toggleable layer
        const annotationLayer = L.layerGroup();
        for (const a of annotations) {
            let label = a.type === 'start_finish' ? 'S/F' : 'T?';
            if (a.type === 'turn' && a.number) {
                label = `T${a.number}`;
                if (a.name) {
                    label += ` ${a.name}`;
                }
            }
            L.marker([a.lat, a.lng], {
                icon: createAnnotationIcon(label, a.type),
                interactive: false,
            }).addTo(annotationLayer);
        }
        // Map controls — background mode + turn annotations toggle
        const controlsWrap = document.createElement('div');
        controlsWrap.className = 'analysis-map-controls';

        // Background mode button group
        const bgGroup = document.createElement('div');
        bgGroup.className = 'btn-group btn-group-sm';
        bgGroup.innerHTML = `
            <button class="btn btn-sm btn-light active" data-bg="satellite" title="Satellite"><i class="fa-solid fa-satellite"></i></button>
            <button class="btn btn-sm btn-light" data-bg="street" title="Street"><i class="fa-solid fa-road"></i></button>
            <button class="btn btn-sm btn-light" data-bg="none" title="None"><i class="fa-solid fa-xmark"></i></button>
        `;

        let currentBg = localStorage.getItem('analysis-map-bg') ?? 'satellite';

        // Apply saved background on load
        function applyBg(mode: string): void {
            satelliteLayer.remove();
            streetLayer.remove();
            linesOverlay.remove();
            labelsOverlay.remove();

            if (mode === 'satellite') {
                satelliteLayer.addTo(map);
                linesOverlay.addTo(map);
                labelsOverlay.addTo(map);
            } else if (mode === 'street') {
                streetLayer.addTo(map);
            }

            for (const btn of Array.from(bgGroup.querySelectorAll('button'))) {
                btn.classList.toggle('active', btn.dataset.bg === mode);
            }
        }

        if (currentBg !== 'satellite') {
            applyBg(currentBg);
        }

        bgGroup.addEventListener('click', e => {
            const target = e.target instanceof Element ? e.target.closest('button') : null;
            if (!target || !(target instanceof HTMLButtonElement)) {
                return;
            }
            const mode = target.dataset.bg;
            if (!mode || mode === currentBg) {
                return;
            }
            currentBg = mode;
            localStorage.setItem('analysis-map-bg', mode);
            applyBg(mode);
        });

        // Annotation toggle button
        let annotationsVisible = localStorage.getItem('analysis-map-turns') === '1';
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'btn btn-sm btn-light';
        toggleBtn.innerHTML = '<i class="fa-solid fa-location-dot"></i>';
        toggleBtn.title = annotationsVisible ? 'Hide turns' : 'Show turns';
        if (annotationsVisible) {
            annotationLayer.addTo(map);
            toggleBtn.classList.add('active');
        }
        toggleBtn.addEventListener('click', () => {
            annotationsVisible = !annotationsVisible;
            localStorage.setItem('analysis-map-turns', annotationsVisible ? '1' : '0');
            if (annotationsVisible) {
                annotationLayer.addTo(map);
                toggleBtn.classList.add('active');
                toggleBtn.title = 'Hide turns';
            } else {
                annotationLayer.remove();
                toggleBtn.classList.remove('active');
                toggleBtn.title = 'Show turns';
            }
        });

        controlsWrap.appendChild(bgGroup);
        controlsWrap.appendChild(toggleBtn);
        mapEl.appendChild(controlsWrap);

        // Position marker (hidden until hover)
        positionMarker = L.circleMarker([0, 0], {
            radius: 6,
            color: '#0d6efd',
            weight: 2.5,
            fillColor: '#fff',
            fillOpacity: 1,
            opacity: 0,
        }).addTo(map);

        // Map → chart sync via mousemove
        map.getContainer().addEventListener('mousemove', e => {
            const rect = mapEl.getBoundingClientRect();
            const point = map.containerPointToLatLng(L.point(e.clientX - rect.left, e.clientY - rect.top));

            // Find nearest GPS point
            let minDistSq = Infinity;
            let nearestDistFt = 0;
            let nearestPoint: GpsPoint | null = null;
            for (const p of gps) {
                const d = (p.lat - point.lat) ** 2 + (p.lon - point.lng) ** 2;
                if (d < minDistSq) {
                    minDistSq = d;
                    nearestDistFt = p.dist_ft;
                    nearestPoint = p;
                }
            }

            // Check pixel distance threshold
            if (nearestPoint) {
                const nearestPx = map.latLngToContainerPoint(L.latLng(nearestPoint.lat, nearestPoint.lon));
                const cursorPx = L.point(e.clientX - rect.left, e.clientY - rect.top);
                const pxDist = nearestPx.distanceTo(cursorPx);
                if (pxDist > 40) {
                    nearestPoint = null;
                }
            }

            if (nearestPoint && positionMarker) {
                positionMarker.setLatLng([nearestPoint.lat, nearestPoint.lon]);
                positionMarker.setStyle({ opacity: 1, fillOpacity: 1 });
                for (const info of charts) {
                    syncChartToDistance(info, nearestDistFt);
                }
            } else {
                if (positionMarker) {
                    positionMarker.setStyle({ opacity: 0, fillOpacity: 0 });
                }
                for (const info of charts) {
                    syncChartToDistance(info, null);
                }
            }
        });

        map.getContainer().addEventListener('mouseleave', () => {
            if (positionMarker) {
                positionMarker.setStyle({ opacity: 0, fillOpacity: 0 });
            }
            for (const info of charts) {
                syncChartToDistance(info, null);
            }
        });
    }

    // ─── Prepare chart data ───
    const lastGps = gps[gps.length - 1];
    const maxDist = lastGps ? lastGps.dist_ft : 0;
    const speedData = gps.map(p => ({ x: Math.max(0, p.dist_ft), y: p.speed_mph }));
    const accelData = hasAccel ? sensorToDistance(telemetry.sensors[accelKey] ?? [], gps) : [];
    const latData = hasLat ? sensorToDistance(telemetry.sensors[latKey] ?? [], gps) : [];

    // ─── Create charts ───
    const chartJs = await import('chart.js');
    chartJs.Chart.register(...chartJs.registerables);

    const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark' ||
        window.matchMedia('(prefers-color-scheme: dark)').matches;
    const textColor = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)';
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    const lineColor = '#0d6efd';
    const crosshairColor = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)';

    function makeChart(
        canvas: HTMLCanvasElement,
        data: { x: number; y: number }[],
        label: string,
        yAxisLabel: string,
    ) {
        return new chartJs.Chart(canvas, {
            type: 'line' as const,
            data: {
                datasets: [{
                    label,
                    data,
                    borderColor: lineColor,
                    fill: false,
                    pointRadius: 0,
                    borderWidth: 1.5,
                    tension: 0.1,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                parsing: false,
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false,
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: items => {
                                if (items.length === 0) {
                                    return '';
                                }
                                const first = items[0];
                                const xVal = first?.parsed?.x ?? 0;
                                return `${Math.round(xVal).toLocaleString()} ft`;
                            },
                            label: ctx2 => {
                                const yVal = ctx2.parsed?.y ?? 0;
                                if (label === 'Speed') {
                                    return `${yVal.toFixed(1)} mph`;
                                }
                                const sign = yVal >= 0 ? '+' : '';
                                return `${sign}${yVal.toFixed(2)} G`;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        type: 'linear',
                        min: 0,
                        max: maxDist,
                        grid: { color: gridColor },
                        ticks: { color: textColor },
                    },
                    y: {
                        title: {
                            display: true,
                            text: yAxisLabel,
                            color: textColor,
                        },
                        grid: { color: gridColor },
                        ticks: { color: textColor },
                    },
                },
                animation: false,
            },
            plugins: [{
                id: 'crosshair',
                afterDraw: chart => {
                    const actives = chart.getActiveElements();
                    if (actives.length === 0) {
                        return;
                    }
                    const firstActive = actives[0];
                    if (!firstActive) {
                        return;
                    }
                    const elX = firstActive.element.x;
                    const c = chart.ctx;
                    c.save();
                    c.beginPath();
                    c.moveTo(elX, chart.chartArea.top);
                    c.lineTo(elX, chart.chartArea.bottom);
                    c.strokeStyle = crosshairColor;
                    c.lineWidth = 1;
                    c.setLineDash([4, 4]);
                    c.stroke();
                    c.restore();
                },
            }],
        });
    }

    // Build chart entries
    interface ChartInfo {
        canvas: HTMLCanvasElement;
        chart: ReturnType<typeof makeChart>;
        data: { x: number; y: number }[];
    }

    const charts: ChartInfo[] = [];

    const speedCanvas = container.querySelector<HTMLCanvasElement>('#speed-chart');
    if (speedCanvas) {
        charts.push({
            canvas: speedCanvas,
            chart: makeChart(speedCanvas, speedData, 'Speed', 'Speed (mph)'),
            data: speedData,
        });
    }

    if (hasAccel) {
        const accelCanvas = container.querySelector<HTMLCanvasElement>('#accel-chart');
        if (accelCanvas) {
            charts.push({
                canvas: accelCanvas,
                chart: makeChart(accelCanvas, accelData, 'Accel', 'Accel (G)'),
                data: accelData,
            });
        }
    }

    if (hasLat) {
        const latCanvas = container.querySelector<HTMLCanvasElement>('#latg-chart');
        if (latCanvas) {
            charts.push({
                canvas: latCanvas,
                chart: makeChart(latCanvas, latData, 'Lateral', 'Lateral (G)'),
                data: latData,
            });
        }
    }

    // ─── Chart + track map sync ───

    function syncChartToDistance(info: ChartInfo, distFt: number | null): void {
        if (distFt === null) {
            info.chart.setActiveElements([]);
            const tip = info.chart.tooltip;
            if (tip) {
                tip.setActiveElements([], { x: 0, y: 0 });
            }
            info.chart.update('none');
            return;
        }

        const idx = findNearestIndex(info.data, distFt);
        const meta = info.chart.getDatasetMeta(0);
        const point = meta.data[idx];
        if (!point) {
            return;
        }
        info.chart.setActiveElements([{ datasetIndex: 0, index: idx }]);
        const tip = info.chart.tooltip;
        if (tip) {
            tip.setActiveElements(
                [{ datasetIndex: 0, index: idx }],
                { x: point.x, y: point.y },
            );
        }
        info.chart.update('none');
    }

    function updateOverlay(distFt: number | null): void {
        if (!positionMarker) {
            return;
        }
        if (distFt === null) {
            positionMarker.setStyle({ opacity: 0, fillOpacity: 0 });
            return;
        }
        const pt = findGpsAtDistance(gps, distFt);
        if (!pt) {
            positionMarker.setStyle({ opacity: 0, fillOpacity: 0 });
            return;
        }
        positionMarker.setLatLng([pt.lat, pt.lon]);
        positionMarker.setStyle({ opacity: 1, fillOpacity: 1 });
    }

    // Attach mousemove/mouseleave to each chart canvas
    for (let i = 0; i < charts.length; i++) {
        const info = charts[i];
        if (!info) {
            continue;
        }

        info.canvas.addEventListener('mousemove', e => {
            const rect = info.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const xScale = info.chart.scales['x'];
            if (!xScale) {
                return;
            }
            if (x < xScale.left || x > xScale.right) {
                return;
            }
            const distFt = xScale.getValueForPixel(x);
            if (distFt === undefined || distFt === null) {
                return;
            }

            // Sync other charts
            for (let j = 0; j < charts.length; j++) {
                if (j === i) {
                    continue;
                }
                const other = charts[j];
                if (other) {
                    syncChartToDistance(other, distFt);
                }
            }
            // Sync track map
            updateOverlay(distFt);
        });

        info.canvas.addEventListener('mouseleave', () => {
            for (const c of charts) {
                if (c) {
                    syncChartToDistance(c, null);
                }
            }
            updateOverlay(null);
        });
    }
}
