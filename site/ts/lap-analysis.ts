import axios from 'axios';
import L from 'leaflet';
import { apiBase } from './api';
import { esc, formatLapTime, buildSessionInfoPills, SESSION_TYPE_BADGE_COLORS, initTooltips, typeLabel } from './html';
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

// ─── Comparison colors ───

const COMPARISON_COLORS = [
    '#0d6efd', '#dc3545', '#198754', '#fd7e14', '#6f42c1',
    '#20c997', '#d63384', '#ffc107', '#0dcaf0', '#6610f2',
];

interface LapRef {
    sessionId: string;
    uid: string;
    lapNo: number;
}

function getComparisonLaps(): LapRef[] {
    const params = new URLSearchParams(window.location.search);
    const refs: LapRef[] = [];
    for (const val of params.getAll('compare')) {
        const parts = val.split(',');
        if (parts.length >= 3 && parts[0] && parts[1] && parts[2]) {
            refs.push({ sessionId: parts[0], uid: parts[1], lapNo: parseInt(parts[2], 10) });
        }
    }
    return refs;
}

interface LapLayer {
    gps: GpsPoint[];
    color: string;
    telemetry: TelemetryData;
    accelKey: string;
    latKey: string;
    hasAccel: boolean;
    hasLat: boolean;
}

function detectSensors(t: TelemetryData): { accelKey: string; latKey: string; hasAccel: boolean; hasLat: boolean } {
    const accelKey = t.sensors.GLnA?.length ? 'GLnA' : 'InlA';
    const latKey = t.sensors.GLtA?.length ? 'GLtA' : 'LatA';
    return { accelKey, latKey, hasAccel: Boolean(t.sensors[accelKey]?.length), hasLat: Boolean(t.sensors[latKey]?.length) };
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

function interpolateTimeAtDist(gps: GpsPoint[], rawDistFt: number): number {
    if (gps.length === 0) {
        return 0;
    }
    let lo = 0;
    let hi = gps.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (gps[mid].dist_ft < rawDistFt) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    if (lo === 0) {
        return gps[0]?.tc_ms ?? 0;
    }
    const prev = gps[lo - 1];
    const curr = gps[lo];
    if (!prev || !curr) {
        return gps[lo]?.tc_ms ?? 0;
    }
    const span = curr.dist_ft - prev.dist_ft;
    if (span <= 0) {
        return prev.tc_ms;
    }
    const t = (rawDistFt - prev.dist_ft) / span;
    return prev.tc_ms + t * (curr.tc_ms - prev.tc_ms);
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

    container.style.flex = '1';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';
    container.innerHTML = '<div class="spinner-border" role="status"></div>';

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

    // Fetch comparison lap telemetry
    const comparisonRefs = getComparisonLaps();
    const comparisonTelemetry = await Promise.all(
        comparisonRefs.map(ref =>
            axios.get<TelemetryData>(
                `${apiBase}/api/sessions/${ref.sessionId}/laps/${ref.uid}/${ref.lapNo}/telemetry`,
            ).then(r => r.data).catch(() => null),
        ),
    );

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
    // Build all layers (primary + comparisons)
    const primarySensors = detectSensors(telemetry);
    const allLayers: LapLayer[] = [
        { gps: telemetry.gps, color: COMPARISON_COLORS[0] ?? '#0d6efd', telemetry, ...primarySensors },
    ];
    for (let ci = 0; ci < comparisonTelemetry.length; ci++) {
        const ct = comparisonTelemetry[ci];
        if (!ct?.gps?.length) {
            continue;
        }
        const sensors = detectSensors(ct);
        allLayers.push({
            gps: ct.gps,
            color: COMPARISON_COLORS[(ci + 1) % COMPARISON_COLORS.length] ?? '#dc3545',
            telemetry: ct,
            ...sensors,
        });
    }
    const hasAccel = allLayers.some(l => l.hasAccel);
    const hasLat = allLayers.some(l => l.hasLat);
    const isCompareMode = allLayers.length > 1;

    // Layer visibility state (toggled via sidebar color swatches)
    const layerActive: boolean[] = allLayers.map(() => true);

    // Compute distance normalization scales (align comparison laps to primary distance)
    const primaryLastGps = allLayers[0]?.gps[allLayers[0].gps.length - 1];
    const primaryMaxDist = primaryLastGps ? primaryLastGps.dist_ft : 0;
    const layerDistScales = allLayers.map(l => {
        const last = l.gps[l.gps.length - 1];
        const layerMax = last ? last.dist_ft : 0;
        return layerMax > 0 && primaryMaxDist > 0 ? primaryMaxDist / layerMax : 1;
    });

    // ─── Fetch sidebar data (comparison mode) ───

    interface SectorResult { lap_no: number; uid: string; sectors: number[] }
    interface LayerDisplayInfo {
        color: string;
        lapNo: number;
        driverName: string;
        lapTimeMs: number;
        sectors: number[];
        sessionName: string;
        sessionType: string;
        infoPills: string[];
        maxSpeedMph: number;
        maxLatG: number;
        distFt: number;
    }

    const layerDisplayInfo: LayerDisplayInfo[] = [];

    if (isCompareMode) {
        // Build refs matching allLayers order (skip failed telemetry loads)
        const allRefs: { sessionId: string; uid: string; lapNo: number; color: string }[] = [
            { sessionId: ids.sessionId, uid: ids.uid, lapNo: ids.lapNo, color: allLayers[0]?.color ?? '#0d6efd' },
        ];
        let layerI = 1;
        for (let ci = 0; ci < comparisonTelemetry.length; ci++) {
            if (!comparisonTelemetry[ci]?.gps?.length) {
                continue;
            }
            const ref = comparisonRefs[ci];
            if (!ref) {
                continue;
            }
            allRefs.push({
                sessionId: ref.sessionId,
                uid: ref.uid,
                lapNo: ref.lapNo,
                color: allLayers[layerI]?.color ?? '#dc3545',
            });
            layerI++;
        }

        // Fetch sectors + laps + session public for each unique session
        const uniqueSessionIds = [...new Set(allRefs.map(r => r.sessionId))];
        const sectorsMap = new Map<string, SectorResult[]>();
        const lapsMap = new Map<string, LapItem[]>();
        const sessionMap = new Map<string, Session>();
        lapsMap.set(ids.sessionId, laps);
        sessionMap.set(ids.sessionId, session);

        await Promise.all(uniqueSessionIds.map(async sid => {
            const fetches: Promise<void>[] = [
                axios.get<SectorResult[]>(`${apiBase}/api/sessions/${sid}/sectors`).then(
                    r => {
                        sectorsMap.set(sid, r.data);
                    },
                    () => {
                        sectorsMap.set(sid, []);
                    },
                ),
            ];
            if (sid !== ids.sessionId) {
                fetches.push(
                    axios.get<LapItem[]>(`${apiBase}/api/sessions/${sid}/laps`).then(
                        r => {
                            lapsMap.set(sid, r.data);
                        },
                        () => {
                            lapsMap.set(sid, []);
                        },
                    ),
                    axios.get<Session>(`${apiBase}/api/sessions/${sid}/public`).then(
                        r => {
                            sessionMap.set(sid, r.data);
                        },
                        () => {
                            // leave unset
                        },
                    ),
                );
            }
            await Promise.all(fetches);
        }));

        // Fetch layouts/classes for comparison tracks we haven't loaded yet
        const trackLayoutMaps = new Map<string, Map<string, string>>();
        const trackClassMaps = new Map<string, Map<string, string>>();
        trackLayoutMaps.set(session.track_id, new Map(layouts.map(l => [l.layout_id, l.name])));
        trackClassMaps.set(session.track_id, new Map(classes.map(c => [c.class_id, c.name])));

        const compTrackIds = new Set<string>();
        for (const [sid, sess] of sessionMap) {
            if (sid !== ids.sessionId && sess.track_id !== session.track_id) {
                compTrackIds.add(sess.track_id);
            }
        }

        if (compTrackIds.size > 0) {
            await Promise.all([...compTrackIds].map(async tid => {
                const emptyLayouts: LayoutOption[] = [];
                const emptyClasses: KartClassOption[] = [];
                const [layoutsResp, classesResp] = await Promise.all([
                    axios.get<LayoutOption[]>(`${apiBase}/api/tracks/${tid}/layouts`).then(r => r.data, () => emptyLayouts),
                    axios.get<KartClassOption[]>(`${apiBase}/api/tracks/${tid}/classes`).then(r => r.data, () => emptyClasses),
                ]);
                trackLayoutMaps.set(tid, new Map(layoutsResp.map(l => [l.layout_id, l.name])));
                trackClassMaps.set(tid, new Map(classesResp.map(c => [c.class_id, c.name])));
            }));
        }

        for (let ri = 0; ri < allRefs.length; ri++) {
            const ref = allRefs[ri];
            if (!ref) {
                continue;
            }
            const sessionLaps = lapsMap.get(ref.sessionId) ?? [];
            const lapInfo = sessionLaps.find(l => l.lap_no === ref.lapNo && l.uid === ref.uid);
            const sessionSectors = sectorsMap.get(ref.sessionId) ?? [];
            const sectorInfo = sessionSectors.find(s => s.lap_no === ref.lapNo && s.uid === ref.uid);
            const refSession = sessionMap.get(ref.sessionId);
            const refTrackId = refSession?.track_id ?? session.track_id;
            const refLayoutMap = trackLayoutMaps.get(refTrackId) ?? new Map<string, string>();
            const refClassMap = trackClassMaps.get(refTrackId) ?? new Map<string, string>();
            const summ = allLayers[ri]?.telemetry.summary;

            layerDisplayInfo.push({
                color: ref.color,
                lapNo: ref.lapNo,
                driverName: lapInfo?.driver_name ?? ref.uid,
                lapTimeMs: lapInfo?.lap_time_ms ?? 0,
                sectors: sectorInfo?.sectors ?? [],
                sessionName: refSession?.session_name ?? 'Session',
                sessionType: refSession?.session_type ?? '',
                infoPills: refSession ? buildSessionInfoPills(refSession, refLayoutMap, refClassMap) : [],
                maxSpeedMph: summ?.max_speed_mph ?? 0,
                maxLatG: summ?.max_lat_g ?? 0,
                distFt: summ?.dist_ft ?? 0,
            });
        }
    }

    // Build sidebar HTML (only in comparison mode)
    let sidebarHtml = '';
    if (isCompareMode && layerDisplayInfo.length > 0) {
        const primary = layerDisplayInfo[0];

        let lapsHtml = '';
        for (let li = 0; li < layerDisplayInfo.length; li++) {
            const info = layerDisplayInfo[li];
            if (!info) {
                continue;
            }
            let gap = '';
            if (li > 0 && primary) {
                const diff = info.lapTimeMs - primary.lapTimeMs;
                const sign = diff >= 0 ? '+' : '';
                let cls = '';
                if (diff > 0) {
                    cls = 'text-danger';
                } else if (diff < 0) {
                    cls = 'text-success';
                }
                gap = ` <span class="${cls}">(${sign}${(diff / 1000).toFixed(3)})</span>`;
            }
            // Show session metadata only for comparison laps (primary info is in the header)
            let metaHtml = '';
            if (li > 0) {
                let typeBadge = '';
                if (info.sessionType) {
                    const badgeCls = SESSION_TYPE_BADGE_COLORS[info.sessionType] ?? 'text-bg-secondary';
                    typeBadge = `<span class="badge ${badgeCls}" style="font-size:.6rem">${typeLabel(info.sessionType)}</span>`;
                }
                const statsParts: string[] = [];
                if (info.maxSpeedMph > 0) {
                    statsParts.push(`${info.maxSpeedMph.toFixed(1)} mph`);
                }
                if (info.maxLatG > 0) {
                    statsParts.push(`${info.maxLatG.toFixed(2)} G`);
                }
                if (info.distFt > 0) {
                    const mi = info.distFt / 5280;
                    statsParts.push(mi >= 0.5 ? `${mi.toFixed(2)} mi` : `${String(Math.round(info.distFt))} ft`);
                }
                metaHtml = `
                        <div class="text-body-secondary d-flex align-items-center gap-1" style="font-size:.7rem">${esc(info.sessionName)} ${typeBadge}</div>
                        ${info.infoPills.length > 0 ? `<div class="text-body-secondary d-flex flex-wrap gap-1" style="font-size:.65rem">${info.infoPills.join('')}</div>` : ''}
                        ${statsParts.length > 0 ? `<div class="text-body-secondary" style="font-size:.65rem">${statsParts.join(' \u00b7 ')}</div>` : ''}`;
            }
            lapsHtml += `
                <div class="sidebar-lap" data-layer-entry="${String(li)}">
                    <span class="sidebar-color layer-toggle" style="background:${info.color}" data-layer-idx="${String(li)}" title="Toggle visibility"></span>
                    <div>
                        <div class="font-monospace fw-semibold" style="font-size:.85rem">${formatLapTime(info.lapTimeMs)}${gap}</div>
                        <div class="text-body-secondary" style="font-size:.75rem">Lap ${String(info.lapNo)} &middot; ${esc(info.driverName)}</div>
                        ${metaHtml}
                    </div>
                </div>`;
        }

        const hasSectors = layerDisplayInfo.some(l => l.sectors.length > 0);
        let sectorsHtml = '';
        if (hasSectors) {
            const primarySectors = primary?.sectors ?? [];
            const maxSectors = Math.max(...layerDisplayInfo.map(l => l.sectors.length));

            // Labels column (S1, S2, S3...)
            let labelsCol = '';
            for (let si = 0; si < maxSectors; si++) {
                labelsCol += `<div class="sector-row fw-semibold">S${String(si + 1)}</div>`;
            }

            // One column per lap
            let lapCols = '';
            for (let li = 0; li < layerDisplayInfo.length; li++) {
                const info = layerDisplayInfo[li];
                if (!info) {
                    continue;
                }
                let rows = '';
                for (let si = 0; si < maxSectors; si++) {
                    const sectorMs = info.sectors[si];
                    if (sectorMs === undefined) {
                        rows += '<div class="sector-row">&mdash;</div>';
                        continue;
                    }
                    if (li === 0) {
                        rows += `<div class="sector-row font-monospace">${(sectorMs / 1000).toFixed(3)}</div>`;
                    } else {
                        const primaryMs = primarySectors[si];
                        if (primaryMs === undefined) {
                            rows += `<div class="sector-row font-monospace">${(sectorMs / 1000).toFixed(3)}</div>`;
                        } else {
                            const diff = sectorMs - primaryMs;
                            const sign = diff >= 0 ? '+' : '';
                            let cls = '';
                            if (diff > 0) {
                                cls = 'text-danger';
                            } else if (diff < 0) {
                                cls = 'text-success';
                            }
                            rows += `<div class="sector-row font-monospace ${cls}">${sign}${(diff / 1000).toFixed(3)}</div>`;
                        }
                    }
                }
                lapCols += `
                    <div class="sector-lap-col">
                        <div class="sector-lap-header"><span class="sidebar-color" style="background:${info.color}"></span> ${String(info.lapNo)}</div>
                        ${rows}
                    </div>`;
            }

            sectorsHtml = `
                <div class="sidebar-section">
                    <div class="sidebar-title">Sectors</div>
                    <div class="sidebar-sectors">
                        <div class="sector-labels-col">
                            <div class="sector-lap-header">&nbsp;</div>
                            ${labelsCol}
                        </div>
                        ${lapCols}
                    </div>
                </div>`;
        }

        sidebarHtml = `
            <div class="analysis-sidebar">
                <div class="sidebar-section">
                    <div class="sidebar-title">Laps</div>
                    ${lapsHtml}
                </div>
                ${sectorsHtml}
            </div>`;
    }

    // Build lap list HTML for below the delta chart (comparison mode)
    let lapListHtml = '';
    if (isCompareMode && layerDisplayInfo.length > 0) {
        const primary = layerDisplayInfo[0];
        for (let li = 0; li < layerDisplayInfo.length; li++) {
            const info = layerDisplayInfo[li];
            if (!info) {
                continue;
            }
            let gap = '';
            if (li > 0 && primary) {
                const diff = info.lapTimeMs - primary.lapTimeMs;
                const sign = diff >= 0 ? '+' : '';
                gap = ` (${sign}${(diff / 1000).toFixed(3)}s)`;
            }
            lapListHtml += `
                <div class="analysis-lap-entry" data-laplist-entry="${String(li)}">
                    <span class="sidebar-color layer-toggle" style="background:${info.color}" data-layer-idx="${String(li)}" title="Toggle visibility"></span>
                    <span class="font-monospace">${formatLapTime(info.lapTimeMs)}${gap}</span>
                    <span class="text-body-secondary ms-auto">${esc(info.driverName)}</span>
                </div>`;
        }
    }

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
    const typeBadgeHtml = sessionType ? `<span class="badge ${badgeColor}" style="font-size:.7rem">${typeLabel(sessionType)}</span>` : '';

    // Info pills (layout, class, start type, scoring)
    const layoutMap = new Map(layouts.map(l => [l.layout_id, l.name]));
    const classMap = new Map(classes.map(c => [c.class_id, c.name]));
    const infoPills = buildSessionInfoPills({ ...session, track_id: session.track_id }, layoutMap, classMap);

    container.removeAttribute('style');
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
                <button class="btn btn-sm btn-outline-secondary d-none" id="zoom-reset-btn">
                    <i class="fa-solid fa-magnifying-glass-minus"></i> View full lap
                </button>
                <div class="d-flex gap-3 text-body-secondary small d-none d-md-flex">
                    ${stats.join('<span class="text-body-tertiary">|</span>')}
                </div>
            </div>
            <div class="analysis-content${isCompareMode ? ' has-sidebar' : ''}">
                ${sidebarHtml}
                ${isCompareMode ? `
                <div class="analysis-map-col">
                    <div class="analysis-map-wrap">
                        <div id="analysis-leaflet-map"></div>
                    </div>
                    <div class="analysis-map-bottom">
                        <div class="analysis-chart-panel">
                            <canvas id="delta-chart"></canvas>
                        </div>
                        <div class="analysis-lap-list">
                            ${lapListHtml}
                        </div>
                    </div>
                </div>` : `
                <div class="analysis-map-wrap">
                    <div id="analysis-leaflet-map"></div>
                </div>`}
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
    // Merge layout annotations (S/F) with track annotations (turns), deduplicating by type
    const layoutAnns = layout?.annotations ?? [];
    const layoutTypes = new Set(layoutAnns.map(a => a.type));
    const trackAnns = (track?.annotations ?? []).filter(a => !layoutTypes.has(a.type));
    const annotations = [...layoutAnns, ...trackAnns];

    const mapEl = container.querySelector<HTMLElement>('#analysis-leaflet-map');
    const positionMarkers: L.CircleMarker[] = [];
    const layerPolylines: L.Polyline[] = [];
    let leafletMap: L.Map | null = null;
    let fullLapBounds: L.LatLngBounds | null = null;

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
            maxZoom: 19,
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

        // Fit to bounds of all layers
        const allGpsPoints = allLayers.flatMap(l => l.gps);
        fullLapBounds = L.latLngBounds(allGpsPoints.map(p => L.latLng(p.lat, p.lon)));
        map.fitBounds(fullLapBounds, { padding: [20, 20] });

        leafletMap = map;

        // Draw GPS traces for all layers (stored for toggle visibility)
        for (const layer of allLayers) {
            const traceLatLngs: [number, number][] = layer.gps.map(p => [p.lat, p.lon]);
            layerPolylines.push(L.polyline(traceLatLngs, {
                color: layer.color,
                opacity: 1,
                weight: 3,
            }).addTo(map));
        }

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

        // Position markers for each layer (only first active layer shown on hover)
        for (const layer of allLayers) {
            positionMarkers.push(L.circleMarker([0, 0], {
                radius: 6,
                color: layer.color,
                weight: 2.5,
                fillColor: '#fff',
                fillOpacity: 1,
                opacity: 0,
            }).addTo(map));
        }

        // Map → chart sync via mousemove
        map.getContainer().addEventListener('mousemove', e => {
            const rect = mapEl.getBoundingClientRect();
            const point = map.containerPointToLatLng(L.point(e.clientX - rect.left, e.clientY - rect.top));

            // Find nearest GPS point across active layers
            let minDistSq = Infinity;
            let nearestDistFt = 0;
            let nearestPoint: GpsPoint | null = null;
            for (let li = 0; li < allLayers.length; li++) {
                if (!layerActive[li]) {
                    continue;
                }
                const layer = allLayers[li];
                if (!layer) {
                    continue;
                }
                const scale = layerDistScales[li] ?? 1;
                for (const p of layer.gps) {
                    const d = (p.lat - point.lat) ** 2 + (p.lon - point.lng) ** 2;
                    if (d < minDistSq) {
                        minDistSq = d;
                        nearestDistFt = p.dist_ft * scale;
                        nearestPoint = p;
                    }
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

            if (nearestPoint) {
                updateOverlay(nearestDistFt);
                for (const info of charts) {
                    syncChartToDistance(info, nearestDistFt);
                }
            } else {
                updateOverlay(null);
                for (const info of charts) {
                    syncChartToDistance(info, null);
                }
            }
        });

        map.getContainer().addEventListener('mouseleave', () => {
            updateOverlay(null);
            for (const info of charts) {
                syncChartToDistance(info, null);
            }
        });
    }

    // ─── Prepare chart data for all layers (normalized to primary distance) ───
    const maxDist = primaryMaxDist;
    const layerChartData = allLayers.map((l, idx) => {
        const scale = layerDistScales[idx] ?? 1;
        const scaleX = (p: { x: number; y: number }) => ({ x: p.x * scale, y: p.y });
        return {
            color: l.color,
            speedData: l.gps.map(p => ({ x: Math.max(0, p.dist_ft * scale), y: p.speed_mph })),
            accelData: l.hasAccel ? sensorToDistance(l.telemetry.sensors[l.accelKey] ?? [], l.gps).map(scaleX) : [],
            latData: l.hasLat ? sensorToDistance(l.telemetry.sensors[l.latKey] ?? [], l.gps).map(scaleX) : [],
        };
    });

    // ─── Compute time delta for comparison laps ───
    // Normalize GPS timestamps to known lap times so the endpoint matches exactly.
    const timeDeltaData: { data: { x: number; y: number }[]; color: string }[] = [];
    if (isCompareMode) {
        const primaryGps = allLayers[0]?.gps;
        if (primaryGps && primaryGps.length > 1) {
            const primaryStart = primaryGps[0]?.tc_ms ?? 0;
            const primaryEnd = primaryGps[primaryGps.length - 1]?.tc_ms ?? 0;
            const primaryGpsDur = primaryEnd - primaryStart;
            const primaryActualMs = layerDisplayInfo[0]?.lapTimeMs ?? primaryGpsDur;

            for (let li = 1; li < allLayers.length; li++) {
                const compLayer = allLayers[li];
                if (!compLayer?.gps.length) {
                    continue;
                }
                const compScale = layerDistScales[li] ?? 1;
                const compStart = compLayer.gps[0]?.tc_ms ?? 0;
                const compEnd = compLayer.gps[compLayer.gps.length - 1]?.tc_ms ?? 0;
                const compGpsDur = compEnd - compStart;
                const compActualMs = layerDisplayInfo[li]?.lapTimeMs ?? compGpsDur;

                const points: { x: number; y: number }[] = [];
                for (const p of primaryGps) {
                    // Normalize primary elapsed to actual lap time
                    const primaryRaw = p.tc_ms - primaryStart;
                    const primaryElapsed = primaryGpsDur > 0 ?
                        (primaryRaw / primaryGpsDur) * primaryActualMs :
                        primaryRaw;
                    // Interpolate comparison elapsed at this distance, normalized
                    const compRawDist = compScale > 0 ? p.dist_ft / compScale : p.dist_ft;
                    const compRaw = interpolateTimeAtDist(compLayer.gps, compRawDist) - compStart;
                    const compElapsed = compGpsDur > 0 ?
                        (compRaw / compGpsDur) * compActualMs :
                        compRaw;

                    points.push({ x: p.dist_ft, y: (compElapsed - primaryElapsed) / 1000 });
                }
                timeDeltaData.push({ data: points, color: compLayer.color });
            }
        }
    }

    // ─── Create charts ───
    const chartJs = await import('chart.js');
    chartJs.Chart.register(...chartJs.registerables);

    const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark' ||
        window.matchMedia('(prefers-color-scheme: dark)').matches;
    const textColor = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)';
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    const crosshairColor = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)';
    const selectionColor = isDark ? 'rgba(13, 110, 253, 0.25)' : 'rgba(13, 110, 253, 0.15)';

    // ─── Drag-to-zoom state ───
    let dragChartInfo: ChartInfo | null = null;
    let dragStartDist: number | null = null;
    let dragStartPixelX: number | null = null;
    let selectionStart: number | null = null;
    let selectionEnd: number | null = null;

    function makeChart(
        canvas: HTMLCanvasElement,
        datasets: { data: { x: number; y: number }[]; color: string }[],
        label: string,
        yAxisLabel: string,
    ) {
        return new chartJs.Chart(canvas, {
            type: 'line' as const,
            data: {
                datasets: datasets.map((ds, i) => ({
                    label: datasets.length > 1 ? `${label} ${String(i + 1)}` : label,
                    data: ds.data,
                    borderColor: ds.color,
                    fill: false,
                    pointRadius: 0,
                    borderWidth: 1.5,
                    tension: 0.1,
                })),
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
                                if (label === 'Time Delta') {
                                    const sign = yVal >= 0 ? '+' : '';
                                    return `${sign}${yVal.toFixed(3)}s`;
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
                events: [],
            },
            plugins: [
                {
                    id: 'selectionOverlay',
                    afterDatasetsDraw: chart => {
                        if (selectionStart === null || selectionEnd === null) {
                            return;
                        }
                        const xScale = chart.scales['x'];
                        if (!xScale) {
                            return;
                        }
                        const lo = Math.min(selectionStart, selectionEnd);
                        const hi = Math.max(selectionStart, selectionEnd);
                        const x1 = Math.max(xScale.getPixelForValue(lo), chart.chartArea.left);
                        const x2 = Math.min(xScale.getPixelForValue(hi), chart.chartArea.right);
                        if (x2 <= x1) {
                            return;
                        }
                        const ctx = chart.ctx;
                        ctx.save();
                        ctx.fillStyle = selectionColor;
                        ctx.fillRect(x1, chart.chartArea.top, x2 - x1, chart.chartArea.bottom - chart.chartArea.top);
                        ctx.restore();
                    },
                },
                {
                    id: 'crosshair',
                    afterDraw: chart => {
                        if (selectionStart !== null) {
                            return; // hide crosshair during drag
                        }
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
                },
            ],
        });
    }

    // Build chart entries
    interface ChartInfo {
        canvas: HTMLCanvasElement;
        chart: ReturnType<typeof makeChart>;
        datasets: { x: number; y: number }[][];
        layerIndices: number[]; // maps dataset index → layer index
    }

    const charts: ChartInfo[] = [];

    const speedCanvas = container.querySelector<HTMLCanvasElement>('#speed-chart');
    if (speedCanvas) {
        const ds = layerChartData.map(l => ({ data: l.speedData, color: l.color }));
        charts.push({
            canvas: speedCanvas,
            chart: makeChart(speedCanvas, ds, 'Speed', 'Speed (mph)'),
            datasets: ds.map(d => d.data),
            layerIndices: layerChartData.map((unused, i) => i),
        });
    }

    if (hasAccel) {
        const accelCanvas = container.querySelector<HTMLCanvasElement>('#accel-chart');
        if (accelCanvas) {
            const accelIndices: number[] = [];
            const ds: { data: { x: number; y: number }[]; color: string }[] = [];
            for (let i = 0; i < layerChartData.length; i++) {
                const l = layerChartData[i];
                if (l && l.accelData.length > 0) {
                    ds.push({ data: l.accelData, color: l.color });
                    accelIndices.push(i);
                }
            }
            charts.push({
                canvas: accelCanvas,
                chart: makeChart(accelCanvas, ds, 'Accel', 'Accel (G)'),
                datasets: ds.map(d => d.data),
                layerIndices: accelIndices,
            });
        }
    }

    if (hasLat) {
        const latCanvas = container.querySelector<HTMLCanvasElement>('#latg-chart');
        if (latCanvas) {
            const latIndices: number[] = [];
            const ds: { data: { x: number; y: number }[]; color: string }[] = [];
            for (let i = 0; i < layerChartData.length; i++) {
                const l = layerChartData[i];
                if (l && l.latData.length > 0) {
                    ds.push({ data: l.latData, color: l.color });
                    latIndices.push(i);
                }
            }
            charts.push({
                canvas: latCanvas,
                chart: makeChart(latCanvas, ds, 'Lateral', 'Lateral (G)'),
                datasets: ds.map(d => d.data),
                layerIndices: latIndices,
            });
        }
    }

    if (isCompareMode && timeDeltaData.length > 0) {
        const deltaCanvas = container.querySelector<HTMLCanvasElement>('#delta-chart');
        if (deltaCanvas) {
            // Delta datasets start from layer index 1 (comparison layers)
            const deltaIndices: number[] = [];
            for (let li = 1; li < allLayers.length; li++) {
                if (allLayers[li]?.gps.length) {
                    deltaIndices.push(li);
                }
            }
            charts.push({
                canvas: deltaCanvas,
                chart: makeChart(deltaCanvas, timeDeltaData, 'Time Delta', 'Time Delta (s)'),
                datasets: timeDeltaData.map(d => d.data),
                layerIndices: deltaIndices,
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

        const actives: { datasetIndex: number; index: number }[] = [];
        for (let d = 0; d < info.datasets.length; d++) {
            const data = info.datasets[d];
            if (!data || data.length === 0) {
                continue;
            }
            // Skip hidden layers
            const li = info.layerIndices[d];
            if (li !== undefined && !layerActive[li]) {
                continue;
            }
            actives.push({ datasetIndex: d, index: findNearestIndex(data, distFt) });
        }

        info.chart.setActiveElements(actives);
        const tip = info.chart.tooltip;
        if (tip && actives.length > 0) {
            const first = actives[0];
            if (first) {
                const meta = info.chart.getDatasetMeta(first.datasetIndex);
                const point = meta.data[first.index];
                if (point) {
                    tip.setActiveElements(actives, { x: point.x, y: point.y });
                }
            }
        }
        info.chart.update('none');
    }

    let prevVisibleMarkerIdx = -1;

    function updateOverlay(distFt: number | null): void {
        // Only show the position marker for the first active layer
        const firstActiveIdx = layerActive.indexOf(true);
        const showIdx = distFt !== null ? firstActiveIdx : -1;

        // Hide previously visible marker if it changed
        if (prevVisibleMarkerIdx !== showIdx && prevVisibleMarkerIdx >= 0) {
            const prev = positionMarkers[prevVisibleMarkerIdx];
            if (prev) {
                prev.setStyle({ opacity: 0, fillOpacity: 0 });
            }
        }

        if (showIdx < 0 || distFt === null) {
            prevVisibleMarkerIdx = -1;
            return;
        }

        const marker = positionMarkers[showIdx];
        const layer = allLayers[showIdx];
        if (!marker || !layer) {
            prevVisibleMarkerIdx = -1;
            return;
        }

        const scale = layerDistScales[showIdx] ?? 1;
        const rawDist = scale > 0 ? distFt / scale : distFt;
        const pt = findGpsAtDistance(layer.gps, rawDist);
        if (!pt) {
            marker.setStyle({ opacity: 0, fillOpacity: 0 });
            prevVisibleMarkerIdx = -1;
            return;
        }
        marker.setLatLng([pt.lat, pt.lon]);
        marker.setStyle({ opacity: 1, fillOpacity: 1 });
        prevVisibleMarkerIdx = showIdx;
    }

    // ─── Drag-to-zoom ───

    const zoomResetBtn = container.querySelector<HTMLButtonElement>('#zoom-reset-btn');

    function zoomToRange(minDist: number, maxDist: number): void {
        for (const c of charts) {
            const xOpts = c.chart.options.scales?.['x'];
            if (xOpts) {
                xOpts.min = minDist;
                xOpts.max = maxDist;
            }
            c.chart.update('none');
        }

        // Zoom map to GPS points within the selected distance range
        if (leafletMap) {
            const boundsPoints: L.LatLng[] = [];
            for (let li = 0; li < allLayers.length; li++) {
                if (!layerActive[li]) {
                    continue;
                }
                const layer = allLayers[li];
                if (!layer) {
                    continue;
                }
                const scale = layerDistScales[li] ?? 1;
                for (const p of layer.gps) {
                    const nd = p.dist_ft * scale;
                    if (nd >= minDist && nd <= maxDist) {
                        boundsPoints.push(L.latLng(p.lat, p.lon));
                    }
                }
            }
            if (boundsPoints.length > 0) {
                leafletMap.fitBounds(L.latLngBounds(boundsPoints), { padding: [10, 10], maxZoom: 19 });
            }
        }

        zoomResetBtn?.classList.remove('d-none');
    }

    function resetZoom(): void {
        for (const c of charts) {
            const xOpts = c.chart.options.scales?.['x'];
            if (xOpts) {
                xOpts.min = 0;
                xOpts.max = maxDist;
            }
            c.chart.update('none');
        }

        if (leafletMap && fullLapBounds) {
            leafletMap.fitBounds(fullLapBounds, { padding: [20, 20] });
        }

        zoomResetBtn?.classList.add('d-none');
    }

    zoomResetBtn?.addEventListener('click', resetZoom);

    // ─── Chart interaction: crosshair sync + drag-to-zoom ───

    // Per-canvas mousedown initiates drag; mousemove/mouseleave for crosshair
    for (const info of charts) {
        info.canvas.style.cursor = 'crosshair';

        info.canvas.addEventListener('mousedown', e => {
            if (e.button !== 0) {
                return;
            }
            const xScale = info.chart.scales['x'];
            if (!xScale) {
                return;
            }
            const rect = info.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            if (x < xScale.left || x > xScale.right) {
                return;
            }
            const dist = xScale.getValueForPixel(x);
            if (dist === undefined || dist === null) {
                return;
            }
            dragChartInfo = info;
            dragStartDist = dist;
            dragStartPixelX = e.clientX;
            e.preventDefault(); // prevent text selection
        });

        info.canvas.addEventListener('mousemove', e => {
            // Skip crosshair sync during drag
            if (dragChartInfo) {
                return;
            }

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

            // Sync all charts (including current — native events disabled)
            for (const c of charts) {
                syncChartToDistance(c, distFt);
            }
            // Sync track map
            updateOverlay(distFt);
        });

        info.canvas.addEventListener('mouseleave', () => {
            if (dragChartInfo) {
                return;
            }
            for (const c of charts) {
                syncChartToDistance(c, null);
            }
            updateOverlay(null);
        });
    }

    // Document-level drag tracking
    document.addEventListener('mousemove', e => {
        if (!dragChartInfo || dragStartPixelX === null || dragStartDist === null) {
            return;
        }

        // Require a minimum drag distance (5px) before entering selection mode
        if (selectionStart === null && Math.abs(e.clientX - dragStartPixelX) < 5) {
            return;
        }

        if (selectionStart === null) {
            selectionStart = dragStartDist;
        }

        // Compute current distance from the originating chart's x-axis
        const xScale = dragChartInfo.chart.scales['x'];
        if (!xScale) {
            return;
        }
        const rect = dragChartInfo.canvas.getBoundingClientRect();
        const clampedX = Math.max(xScale.left, Math.min(xScale.right, e.clientX - rect.left));
        selectionEnd = xScale.getValueForPixel(clampedX) ?? selectionEnd;

        // Redraw all charts to show selection overlay
        for (const c of charts) {
            c.chart.update('none');
        }
    });

    document.addEventListener('mouseup', () => {
        if (!dragChartInfo) {
            return;
        }

        if (selectionStart !== null && selectionEnd !== null) {
            const lo = Math.min(selectionStart, selectionEnd);
            const hi = Math.max(selectionStart, selectionEnd);
            // Minimum selection of 20ft to avoid accidental zooms
            if (hi - lo > 20) {
                zoomToRange(lo, hi);
            }
        }

        // Clear drag state
        dragChartInfo = null;
        dragStartDist = null;
        dragStartPixelX = null;
        selectionStart = null;
        selectionEnd = null;
        for (const c of charts) {
            c.chart.update('none');
        }
    });

    // ─── Layer toggle via sidebar/lap-list color swatches ───

    function toggleLayer(layerIdx: number): void {
        const active = !layerActive[layerIdx];
        layerActive[layerIdx] = active;
        const layer = allLayers[layerIdx];
        if (!layer) {
            return;
        }

        // Toggle chart dataset visibility
        for (const chartInfo of charts) {
            for (let di = 0; di < chartInfo.layerIndices.length; di++) {
                if (chartInfo.layerIndices[di] === layerIdx) {
                    chartInfo.chart.setDatasetVisibility(di, active);
                }
            }
            chartInfo.chart.update('none');
        }

        // Toggle map polyline
        const polyline = layerPolylines[layerIdx];
        if (polyline && leafletMap) {
            if (active) {
                polyline.addTo(leafletMap);
            } else {
                polyline.remove();
            }
        }

        // Update all matching swatches + their parent entries
        for (const swatch of Array.from(container.querySelectorAll(`[data-layer-idx="${String(layerIdx)}"]`))) {
            if (swatch instanceof HTMLElement) {
                swatch.style.background = active ? layer.color : '#6c757d';
            }
        }
        for (const entry of Array.from(container.querySelectorAll(`[data-layer-entry="${String(layerIdx)}"]`))) {
            if (entry instanceof HTMLElement) {
                entry.style.opacity = active ? '' : '0.4';
            }
        }
        for (const entry of Array.from(container.querySelectorAll(`[data-laplist-entry="${String(layerIdx)}"]`))) {
            if (entry instanceof HTMLElement) {
                entry.style.opacity = active ? '' : '0.4';
            }
        }
    }

    // Attach toggle handlers via event delegation
    container.addEventListener('click', e => {
        const target = e.target instanceof Element ? e.target.closest('.layer-toggle') : null;
        if (!target || !(target instanceof HTMLElement)) {
            return;
        }
        const idxStr = target.dataset.layerIdx;
        if (idxStr === undefined) {
            return;
        }
        const idx = parseInt(idxStr, 10);
        if (!isNaN(idx) && idx >= 0 && idx < allLayers.length) {
            toggleLayer(idx);
        }
    });
}
