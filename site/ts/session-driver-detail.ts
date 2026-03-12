import axios from 'axios';
import { apiBase, assetsBase } from './api';
import { addLapToAnalyze, getAnalyzeLaps, isLapInAnalyze, removeLapFromAnalyze } from './analyze-tray';
import { esc, formatLapTime, buildSessionInfoPills, initTooltips, SESSION_TYPE_BADGE_COLORS, sectorBlocksHtml } from './html';
import { trackDetailUrl, championshipDetailUrl, seriesDetailUrl, eventDetailUrl, sessionDetailUrl, isHugoServer, lapAnalysisUrl } from './url-utils';

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
    telemetry_key?: string;
}

interface SectorData {
    lap_no: number;
    uid: string;
    sectors: number[];
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
}

/** Parse session ID and driver UID from the URL. */
export function getDriverDetailIds(): { sessionId: string; uid: string } | null {
    if (isHugoServer()) {
        const params = new URLSearchParams(window.location.search);
        const sessionId = params.get('id');
        const uid = params.get('driver');
        if (sessionId && uid) {
            return { sessionId, uid };
        }
        return null;
    }
    // Production URL: /sessions/{sessionId}/{slug}/driver/{uid}/{slug}
    const match = /^\/sessions\/([a-z0-9]+)\/[^/]+\/driver\/([a-z0-9]+)/.exec(window.location.pathname);
    if (match) {
        return { sessionId: match[1], uid: match[2] };
    }
    return null;
}

export async function renderSessionDriverDetail(container: HTMLElement): Promise<void> {
    const ids = getDriverDetailIds();
    if (!ids) {
        container.innerHTML = '<div class="alert alert-warning">Invalid driver URL.</div>';
        return;
    }

    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';

    let session: Session;
    let laps: LapItem[];
    let allSectors: SectorData[];

    try {
        const [sessionResp, lapsResp, sectorsResp] = await Promise.all([
            axios.get<Session>(`${apiBase}/api/sessions/${ids.sessionId}/public`),
            axios.get<LapItem[]>(`${apiBase}/api/sessions/${ids.sessionId}/laps`),
            axios.get<SectorData[]>(`${apiBase}/api/sessions/${ids.sessionId}/sectors`).catch((): { data: SectorData[] } => ({ data: [] })),
        ]);
        session = sessionResp.data;
        laps = lapsResp.data;
        allSectors = sectorsResp.data;
    } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
            container.innerHTML = '<div class="alert alert-warning">Session not found.</div>';
        } else {
            container.innerHTML = '<div class="alert alert-danger">Failed to load data.</div>';
        }
        return;
    }

    // Filter to this driver's laps
    const driverLaps = laps.filter(l => l.uid === ids.uid);
    if (driverLaps.length === 0) {
        container.innerHTML = '<div class="alert alert-warning">No laps found for this driver.</div>';
        return;
    }

    const driverName = driverLaps[0].driver_name ?? ids.uid;
    document.title = `${driverName} \u2014 ${session.session_name ?? 'Session'} \u2014 Kart Track Park`;

    // Fetch track + event + layouts + classes for breadcrumbs and session info
    let track: TrackPublic | null = null;
    let event: EventDetail | null = null;
    let layouts: LayoutOption[] = [];
    let classes: KartClassOption[] = [];

    try {
        const [trackResp, eventResult, layoutsResp, classesResp] = await Promise.all([
            axios.get<TrackPublic>(`${apiBase}/api/tracks/${session.track_id}/public`),
            session.event_id ?
                axios.get<EventDetail>(`${apiBase}/api/events/${session.event_id}`).then(r => r.data, () => null) :
                Promise.resolve(null),
            axios.get<LayoutOption[]>(`${apiBase}/api/tracks/${session.track_id}/layouts`).
                catch((): { data: LayoutOption[] } => ({ data: [] })),
            axios.get<KartClassOption[]>(`${apiBase}/api/tracks/${session.track_id}/classes`).
                catch((): { data: KartClassOption[] } => ({ data: [] })),
        ]);
        track = trackResp.data;
        event = eventResult;
        layouts = layoutsResp.data;
        classes = classesResp.data;
    } catch {
        // Non-fatal
    }

    // Build breadcrumb
    const seriesCtx = event?.series?.[0];
    const breadcrumbParts: string[] = [];
    if (track) {
        breadcrumbParts.push(
            `<a href="${trackDetailUrl(track.track_id, track.name)}" class="d-inline-flex align-items-center gap-2 text-body-secondary" data-track-hover="${track.track_id}">
                ${track.logo_key ?
                `<img src="${assetsBase}/${track.logo_key}" alt="" width="28" height="28" class="rounded flex-shrink-0" style="object-fit:cover">` :
                '<div class="rounded bg-body-secondary flex-shrink-0 d-flex align-items-center justify-content-center" style="width:28px;height:28px"><i class="fa-solid fa-flag-checkered small"></i></div>'
            }
                <span>${esc(track.name)}</span>
            </a>`,
        );
    }
    if (seriesCtx) {
        breadcrumbParts.push(
            `<a href="${championshipDetailUrl(seriesCtx.championship_id, seriesCtx.championship_name)}" class="d-inline-flex align-items-center gap-2 text-body-secondary">${seriesCtx.championship_logo_key ?
                `<img src="${assetsBase}/${seriesCtx.championship_logo_key}" alt="" width="24" height="24" class="rounded flex-shrink-0" style="object-fit:cover">` :
                '<i class="fa-solid fa-trophy small"></i>'
            }<span>${esc(seriesCtx.championship_name)}</span></a>`,
        );
        breadcrumbParts.push(
            `<a href="${seriesDetailUrl(seriesCtx.series_id, seriesCtx.series_name)}" class="text-body-secondary">${esc(seriesCtx.series_name)}</a>`,
        );
    }
    if (event) {
        breadcrumbParts.push(
            `<a href="${eventDetailUrl(event.event_id, event.name, seriesCtx ? { championship_name: seriesCtx.championship_name, series_name: seriesCtx.series_name } : undefined)}" class="text-body-secondary">${esc(event.name)}</a>`,
        );
    }
    const sessionName = session.session_name ?? 'Session';
    breadcrumbParts.push(
        `<a href="${sessionDetailUrl(session.session_id, sessionName)}" class="text-body-secondary">${esc(sessionName)}</a>`,
    );

    // Session info pills
    const layoutMap = new Map(layouts.map(l => [l.layout_id, l.name]));
    const classMap = new Map(classes.map(c => [c.class_id, c.name]));
    const infoPills = buildSessionInfoPills(
        session,
        layoutMap,
        classMap,
    );

    const sessionType = session.session_type ?? '';
    const badgeColor = SESSION_TYPE_BADGE_COLORS[sessionType] ?? 'text-bg-secondary';

    // Compute stats
    const bestLapMs = Math.min(...driverLaps.map(l => l.lap_time_ms));
    const totalMs = driverLaps.reduce((sum, l) => sum + l.lap_time_ms, 0);
    const avgMs = totalMs / driverLaps.length;
    const hasSpeed = driverLaps.some(l => l.max_speed);
    const topSpeed = hasSpeed ? Math.max(...driverLaps.map(l => l.max_speed ?? 0)) : 0;

    // Consistency: std deviation of lap times (lower = more consistent)
    const variance = driverLaps.reduce((sum, l) => sum + (l.lap_time_ms - avgMs) ** 2, 0) / driverLaps.length;
    const stdDevMs = Math.sqrt(variance);
    // Express as percentage of average
    const consistencyPct = avgMs > 0 ? (stdDevMs / avgMs) * 100 : 0;

    // Build sector lookup for inline rendering
    const sectorLookup = allSectors.length > 0 ? buildSectorLookup(allSectors, ids.uid) : null;
    const hasSectors = sectorLookup !== null;
    const hasTelemetry = driverLaps.some(l => l.telemetry_key);

    // Build lap rows with color coding
    const analyzeLapKeys = new Set(getAnalyzeLaps().map(l => `${l.sessionId}:${l.uid}:${String(l.lapNo)}`));
    const worstLapMs = Math.max(...driverLaps.map(l => l.lap_time_ms));
    const lapsHtml = driverLaps.map(l => {
        const isBest = l.lap_time_ms === bestLapMs;
        const isSlowest = l.lap_time_ms === worstLapMs && driverLaps.length > 2;
        const delta = l.lap_time_ms - bestLapMs;

        // Color bar: green if below avg, yellow if near avg, red if above
        let deltaClass = 'lap-delta-ok';
        if (l.lap_time_ms <= avgMs * 0.995) {
            deltaClass = 'lap-delta-fast';
        } else if (l.lap_time_ms > avgMs * 1.01) {
            deltaClass = 'lap-delta-slow';
        }

        const rowClass = isBest ? 'lap-fastest' : '';
        const badges: string[] = [];
        if (isBest) {
            badges.push('<span class="badge me-1" style="background:#c632c8">Fastest</span>');
        }
        if (isSlowest && !isBest) {
            badges.push('<span class="badge text-bg-danger me-1">Slowest</span>');
        }

        let sectorHtml = '';
        if (hasSectors) {
            const sd = sectorLookup.sectorMap.get(l.lap_no);
            sectorHtml = `<td class="sector-blocks">${sd ? sectorBlocksHtml(sd.sectors, sectorLookup.bestPerSector, sectorLookup.worstPerSector) : ''}</td>`;
        }

        return `<tr class="${deltaClass} ${rowClass}" data-lap-no="${l.lap_no}">
            <td class="text-body-secondary">${l.lap_no}</td>
            <td class="font-monospace fw-semibold">
                ${badges.join('')}${formatLapTime(l.lap_time_ms)}
            </td>
            <td class="font-monospace text-body-secondary">${isBest ? '\u2014' : '+' + formatLapTime(delta)}</td>
            ${sectorHtml}
            ${hasSpeed ? `<td class="text-end font-monospace">${l.max_speed ? `${l.max_speed.toFixed(1)} mph` : '\u2014'}</td>` : ''}
            ${hasTelemetry ? `<td>${l.telemetry_key ? `<div class="btn-group btn-group-sm">
                <button class="btn btn-outline-secondary py-0 px-1 analyze-btn" data-lap-no="${l.lap_no}" title="Analyze telemetry"><i class="fa-solid fa-chart-line" style="font-size:.75rem"></i></button>
                <button class="btn btn-outline-secondary py-0 px-1 dropdown-toggle dropdown-toggle-split" data-bs-toggle="dropdown" aria-expanded="false"><span class="visually-hidden">Toggle menu</span></button>
                <ul class="dropdown-menu dropdown-menu-end">
                    <li><button class="dropdown-item compare-toggle-btn" data-lap-no="${l.lap_no}" data-lap-ms="${l.lap_time_ms}">${analyzeLapKeys.has(`${ids.sessionId}:${ids.uid}:${String(l.lap_no)}`) ? 'Remove from analyze' : 'Add to analyze'}</button></li>
                </ul>
            </div>` : ''}</td>` : ''}
        </tr>`;
    }).join('');

    // Stats pills
    const statPills: string[] = [
        `<span class="d-inline-flex align-items-center gap-1" data-bs-toggle="tooltip" data-bs-title="Fastest single lap"><i class="fa-solid fa-stopwatch"></i>Best: <span class="font-monospace text-success fw-semibold">${formatLapTime(bestLapMs)}</span></span>`,
        `<span class="d-inline-flex align-items-center gap-1" data-bs-toggle="tooltip" data-bs-title="Average lap time"><i class="fa-solid fa-clock-rotate-left"></i>Avg: <span class="font-monospace">${formatLapTime(Math.round(avgMs))}</span></span>`,
        `<span class="d-inline-flex align-items-center gap-1" data-bs-toggle="tooltip" data-bs-title="Total session time"><i class="fa-solid fa-clock"></i>Total: <span class="font-monospace">${formatLapTime(totalMs)}</span></span>`,
        `<span class="d-inline-flex align-items-center gap-1" data-bs-toggle="tooltip" data-bs-title="Number of laps completed"><i class="fa-solid fa-hashtag"></i>${driverLaps.length} lap${driverLaps.length !== 1 ? 's' : ''}</span>`,
    ];
    if (topSpeed > 0) {
        statPills.push(`<span class="d-inline-flex align-items-center gap-1" data-bs-toggle="tooltip" data-bs-title="Top speed across all laps"><i class="fa-solid fa-gauge-high"></i>Top: <span class="font-monospace">${topSpeed.toFixed(1)} mph</span></span>`);
    }
    if (driverLaps.length >= 3) {
        statPills.push(`<span class="d-inline-flex align-items-center gap-1" data-bs-toggle="tooltip" data-bs-title="Lap time consistency (lower is better)"><i class="fa-solid fa-chart-line"></i>${consistencyPct < 1 ? `${consistencyPct.toFixed(1)}%` : `${consistencyPct.toFixed(0)}%`} variance</span>`);
    }

    container.innerHTML = `
        ${breadcrumbParts.length > 0 ? `
        <div class="d-flex flex-wrap align-items-center gap-2 mb-3 text-body-secondary small">
            ${breadcrumbParts.join('<i class="fa-solid fa-chevron-right mx-1" style="font-size:.6rem"></i>')}
            <i class="fa-solid fa-chevron-right mx-1" style="font-size:.6rem"></i>
            <span class="active">${esc(driverName)}</span>
        </div>` : ''}
        <div class="d-flex align-items-center gap-2 mb-2">
            <h1 class="mb-0">${esc(driverName)}</h1>
            ${sessionType ? `<span class="badge ${badgeColor}">${sessionType.replace('_', ' ')}</span>` : ''}
        </div>
        ${infoPills.length > 0 ? `
        <div class="d-flex flex-wrap gap-3 text-body-secondary small mb-3">
            ${infoPills.join('')}
        </div>` : ''}
        <div class="d-flex flex-wrap gap-3 text-body-secondary small mb-4">
            ${statPills.join('')}
        </div>
        <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
                <thead>
                    <tr class="text-body-secondary small">
                        <th style="width:3rem">Lap</th>
                        <th>Time</th>
                        <th>Gap</th>
                        ${hasSectors ? '<th>Sectors</th>' : ''}
                        ${hasSpeed ? '<th class="text-end">Max Speed</th>' : ''}
                        ${hasTelemetry ? '<th style="width:2.5rem"></th>' : ''}
                    </tr>
                </thead>
                <tbody>
                    ${lapsHtml}
                </tbody>
            </table>
        </div>
        ${driverLaps.length >= 2 ? '<div class="mt-4"><canvas id="lap-chart" height="200"></canvas></div>' : ''}
    `;

    initTooltips(container);

    // Render lap time chart
    if (driverLaps.length >= 2) {
        const canvas = container.querySelector<HTMLCanvasElement>('#lap-chart');
        if (canvas) {
            void renderLapChart(canvas, driverLaps, bestLapMs, Math.round(avgMs));
        }
    }

    // Wire up analyze buttons — navigate to full-screen analysis page
    container.addEventListener('click', e => {
        if (!(e.target instanceof HTMLElement)) {
            return;
        }

        // Direct analyze button → navigate to single lap analysis
        const analyzeBtn = e.target.closest<HTMLElement>('.analyze-btn');
        if (analyzeBtn) {
            const lapNo = parseInt(analyzeBtn.dataset.lapNo ?? '', 10);
            if (lapNo) {
                window.location.href = lapAnalysisUrl(ids.sessionId, sessionName, ids.uid, driverName, lapNo);
            }
            return;
        }

        // Compare toggle → add/remove from analyze tray
        const compareBtn = e.target.closest<HTMLElement>('.compare-toggle-btn');
        if (compareBtn) {
            const lapNo = parseInt(compareBtn.dataset.lapNo ?? '', 10);
            const lapMs = parseInt(compareBtn.dataset.lapMs ?? '', 10);
            if (!lapNo) {
                return;
            }
            if (isLapInAnalyze(ids.sessionId, ids.uid, lapNo)) {
                removeLapFromAnalyze(ids.sessionId, ids.uid, lapNo);
                compareBtn.textContent = 'Add to analyze';
            } else {
                addLapToAnalyze({
                    sessionId: ids.sessionId,
                    sessionName,
                    uid: ids.uid,
                    driverName,
                    lapNo,
                    lapTimeMs: lapMs || 0,
                    championshipName: seriesCtx?.championship_name,
                    seriesName: seriesCtx?.series_name,
                    eventName: event?.name,
                });
                compareBtn.textContent = 'Remove from analyze';
            }
        }
    });

    // Initialize dropdowns with fixed Popper strategy to escape table-responsive overflow
    void import('bootstrap').then(bs => {
        for (const toggle of Array.from(container.querySelectorAll('.dropdown-toggle-split'))) {
            new bs.Dropdown(toggle, {
                popperConfig: { strategy: 'fixed' },
            });
        }
    });
}

/** Compute sector display data for this driver's laps. */
function buildSectorLookup(allSectors: SectorData[], uid: string): {
    sectorMap: Map<number, SectorData>;
    bestPerSector: number[];
    worstPerSector: number[];
} | null {
    const driverSectors = allSectors.filter(s => s.uid === uid);
    if (driverSectors.length === 0) {
        return null;
    }

    const numSectors = driverSectors[0].sectors.length;
    const bestPerSector = Array.from({ length: numSectors }, () => Infinity);
    const worstPerSector = Array.from({ length: numSectors }, () => 0);
    for (const s of driverSectors) {
        for (let i = 0; i < numSectors; i++) {
            if (s.sectors[i] > 0 && s.sectors[i] < bestPerSector[i]) {
                bestPerSector[i] = s.sectors[i];
            }
            if (s.sectors[i] > worstPerSector[i]) {
                worstPerSector[i] = s.sectors[i];
            }
        }
    }

    return {
        sectorMap: new Map(driverSectors.map(s => [s.lap_no, s])),
        bestPerSector,
        worstPerSector,
    };
}

async function renderLapChart(
    canvas: HTMLCanvasElement,
    laps: LapItem[],
    bestLapMs: number,
    avgMs: number,
): Promise<void> {
    const chartJs = await import('chart.js');
    chartJs.Chart.register(...chartJs.registerables);

    const labels = laps.map(l => `Lap ${l.lap_no}`);
    const data = laps.map(l => l.lap_time_ms / 1000);
    const bestSec = bestLapMs / 1000;
    const avgSec = avgMs / 1000;

    // Color each bar: magenta for fastest, green/yellow/red relative to average
    function barFill(lapMs: number): string {
        if (lapMs === bestLapMs) {
            return 'rgba(198, 50, 200, 0.8)';
        }
        if (lapMs <= avgMs * 0.995) {
            return 'rgba(25, 135, 84, 0.6)';
        }
        if (lapMs > avgMs * 1.01) {
            return 'rgba(220, 53, 69, 0.5)';
        }
        return 'rgba(255, 193, 7, 0.5)';
    }
    function barBorder(lapMs: number): string {
        if (lapMs === bestLapMs) {
            return 'rgb(198, 50, 200)';
        }
        if (lapMs <= avgMs * 0.995) {
            return 'rgba(25, 135, 84, 0.8)';
        }
        if (lapMs > avgMs * 1.01) {
            return 'rgba(220, 53, 69, 0.7)';
        }
        return 'rgba(255, 193, 7, 0.7)';
    }
    const colors = laps.map(l => barFill(l.lap_time_ms));
    const borderColors = laps.map(l => barBorder(l.lap_time_ms));

    // Determine if we're in dark mode
    const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark' ||
        window.matchMedia('(prefers-color-scheme: dark)').matches;
    const textColor = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)';
    const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

    new chartJs.Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Lap Time',
                data,
                backgroundColor: colors,
                borderColor: borderColors,
                borderWidth: 1,
                borderRadius: 3,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => formatLapTime(laps[ctx.dataIndex].lap_time_ms),
                    },
                },
            },
            scales: {
                y: {
                    title: {
                        display: true,
                        text: 'Seconds',
                        color: textColor,
                    },
                    grid: { color: gridColor },
                    ticks: { color: textColor },
                    // Tight Y axis: pad around min/max
                    min: Math.max(0, bestSec - (avgSec - bestSec) - 1),
                },
                x: {
                    grid: { display: false },
                    ticks: { color: textColor },
                },
            },
        },
        plugins: [{
            id: 'avgLine',
            afterDraw(chart) {
                const yScale = chart.scales.y;
                const avgY = yScale.getPixelForValue(avgSec);
                const bestY = yScale.getPixelForValue(bestSec);
                const { ctx: c, chartArea: { left, right } } = chart;

                // Average line
                c.save();
                c.strokeStyle = isDark ? 'rgba(255,193,7,0.7)' : 'rgba(255,152,0,0.7)';
                c.lineWidth = 1.5;
                c.setLineDash([6, 4]);
                c.beginPath();
                c.moveTo(left, avgY);
                c.lineTo(right, avgY);
                c.stroke();

                c.fillStyle = isDark ? 'rgba(255,193,7,0.9)' : 'rgba(255,152,0,0.9)';
                c.font = '11px sans-serif';
                c.textAlign = 'right';
                c.fillText(`avg ${formatLapTime(avgMs)}`, right, avgY - 4);

                // Best line
                c.strokeStyle = 'rgba(25,135,84,0.7)';
                c.beginPath();
                c.moveTo(left, bestY);
                c.lineTo(right, bestY);
                c.stroke();

                c.fillStyle = 'rgba(25,135,84,0.9)';
                c.fillText(`best ${formatLapTime(bestLapMs)}`, right, bestY - 4);
                c.restore();
            },
        }],
    });
}
