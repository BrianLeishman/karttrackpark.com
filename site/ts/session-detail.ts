import axios from 'axios';
import { api, apiBase, assetsBase } from './api';
import { getAccessToken, isLoggedIn, login } from './auth';
import { esc, dateFmt, formatLapTime, typeLabel, SESSION_TYPES, START_TYPES, startTypeLabel, buildSessionInfoPills, initTooltips, scoringUsesTotalTime, SESSION_TYPE_BADGE_COLORS, sectorBlocksHtml, positionHtml } from './html';
import { openUploadManager } from './upload-manager';
import { getEntityId, trackDetailUrl, championshipDetailUrl, seriesDetailUrl, eventDetailUrl, driverDetailUrl } from './url-utils';

interface Session {
    session_id: string;
    track_id: string;
    event_id?: string;
    session_name?: string;
    session_type?: string;
    session_order?: number;
    layout_id?: string;
    reverse?: boolean;
    start_type?: string;
    lap_limit?: number;
    class_ids?: string[];
    notes?: string;
    best_lap_ms?: number;
    best_lap_driver_name?: string;
    lap_count?: number;
    ingest_status?: string;
    ingest_error?: string;
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

interface SeriesDetail {
    series_id: string;
    name: string;
    registration_mode?: string;
    max_spots?: number;
    price_cents?: number;
    currency?: string;
    registration_deadline?: string;
}

interface Registration {
    uid: string;
    parent_id: string;
    status: string;
    driver_name: string;
}

interface TrackPublic {
    track_id: string;
    name: string;
    logo_key?: string;
}

interface LayoutOption {
    layout_id: string;
    name: string;
    is_default?: boolean;
}

interface KartClassOption {
    class_id: string;
    name: string;
    is_default?: boolean;
}

interface Result {
    uid: string;
    driver_name: string;
    position: number;
    points?: number;
    fastest_lap_ms?: number;
    kart_id?: string;
    grid_position?: number;
    penalties?: string;
}

interface SectorData {
    lap_no: number;
    uid: string;
    sectors: number[];
}

// Computed driver standing from lap data
interface DriverStanding {
    uid: string;
    name: string;
    laps: LapItem[];
    totalTimeMs: number;
    bestLapMs: number;
    bestLapNo: number;
    lapCount: number;
    position: number;
    gap: string;
}

function buildDriverStandings(laps: LapItem[], sessionType?: string): DriverStanding[] {
    // Group laps by driver UID
    const byDriver = new Map<string, LapItem[]>();
    for (const l of laps) {
        const arr = byDriver.get(l.uid) ?? [];
        arr.push(l);
        byDriver.set(l.uid, arr);
    }

    const useTotalTime = scoringUsesTotalTime(sessionType);
    const standings: DriverStanding[] = [];

    for (const [uid, driverLaps] of byDriver) {
        let bestMs = Infinity;
        let bestNo = 0;
        let totalMs = 0;
        for (const l of driverLaps) {
            totalMs += l.lap_time_ms;
            if (l.lap_time_ms < bestMs) {
                bestMs = l.lap_time_ms;
                bestNo = l.lap_no;
            }
        }
        // Use driver_name from any lap (they all share the same uid)
        const name = driverLaps[0].driver_name ?? uid;
        standings.push({
            uid,
            name,
            laps: driverLaps,
            totalTimeMs: totalMs,
            bestLapMs: bestMs === Infinity ? 0 : bestMs,
            bestLapNo: bestNo,
            lapCount: driverLaps.length,
            position: 0,
            gap: '',
        });
    }

    // Sort by scoring method
    standings.sort((a, b) => {
        if (useTotalTime) {
            return a.totalTimeMs - b.totalTimeMs;
        }
        return a.bestLapMs - b.bestLapMs;
    });

    // Assign positions and gaps
    let leaderVal = 0;
    if (standings.length > 0) {
        leaderVal = useTotalTime ? standings[0].totalTimeMs : standings[0].bestLapMs;
    }
    for (let i = 0; i < standings.length; i++) {
        standings[i].position = i + 1;
        if (i === 0) {
            standings[i].gap = '';
        } else {
            const val = useTotalTime ? standings[i].totalTimeMs : standings[i].bestLapMs;
            const diff = val - leaderVal;
            standings[i].gap = '+' + formatLapTime(diff);
        }
    }

    return standings;
}

interface SectorDisplay {
    driverBests: Map<string, number[]>;
    overallBest: number[];
    overallWorst: number[];
}

function buildSectorDisplay(allSectors: SectorData[]): SectorDisplay | null {
    if (allSectors.length === 0) {
        return null;
    }

    const numSectors = allSectors[0].sectors.length;
    const byUid = new Map<string, SectorData[]>();
    for (const s of allSectors) {
        const arr = byUid.get(s.uid) ?? [];
        arr.push(s);
        byUid.set(s.uid, arr);
    }

    const driverBests = new Map<string, number[]>();
    for (const [uid, driverSectors] of byUid) {
        const bests = Array.from({ length: numSectors }, () => Infinity);
        for (const s of driverSectors) {
            for (let i = 0; i < numSectors; i++) {
                if (s.sectors[i] > 0 && s.sectors[i] < bests[i]) {
                    bests[i] = s.sectors[i];
                }
            }
        }
        driverBests.set(uid, bests);
    }

    const overallBest = Array.from({ length: numSectors }, () => Infinity);
    const overallWorst = Array.from({ length: numSectors }, () => 0);
    for (const bests of driverBests.values()) {
        for (let i = 0; i < numSectors; i++) {
            if (bests[i] < overallBest[i]) {
                overallBest[i] = bests[i];
            }
            if (bests[i] !== Infinity && bests[i] > overallWorst[i]) {
                overallWorst[i] = bests[i];
            }
        }
    }

    return { driverBests, overallBest, overallWorst };
}

function standingsTableHtml(drivers: DriverStanding[], useTotalTime: boolean, overallBestMs: number, sectorDisplay: SectorDisplay | null, sessionId?: string, sessionName?: string): string {
    if (drivers.length === 0) {
        return '';
    }
    return `
    <div class="table-responsive">
        <table class="table table-hover align-middle mb-0">
            <thead>
                <tr class="text-body-secondary small">
                    <th style="width:3rem"></th>
                    <th>Driver</th>
                    <th class="text-end">Best Lap</th>
                    ${sectorDisplay ? '<th>Sectors</th>' : ''}
                    <th class="text-end">${useTotalTime ? 'Total Time' : 'Total'}</th>
                    <th class="text-end">Gap</th>
                    <th class="text-center" style="width:4rem">Laps</th>
                </tr>
            </thead>
            <tbody>
                ${drivers.map(d => {
        const isBestOverall = d.bestLapMs === overallBestMs && overallBestMs > 0;
        const posHtml = positionHtml(d.position);
        const href = sessionId ? driverDetailUrl(sessionId, sessionName ?? 'session', d.uid, d.name) : '';
        let sectorHtml = '';
        if (sectorDisplay) {
            const bests = sectorDisplay.driverBests.get(d.uid);
            sectorHtml = `<td class="sector-blocks">${bests ? sectorBlocksHtml(bests, sectorDisplay.overallBest, sectorDisplay.overallWorst) : ''}</td>`;
        }
        return `<tr${href ? ` data-href="${href}" style="cursor:pointer"` : ''} data-uid="${d.uid}">
                        <td class="text-center">${posHtml}</td>
                        <td class="fw-semibold">${esc(d.name)}</td>
                        <td class="text-end font-monospace${isBestOverall ? ' text-success fw-semibold' : ''}">
                            ${formatLapTime(d.bestLapMs)}
                            <span class="text-body-tertiary" style="font-size:.75em">L${d.bestLapNo}</span>
                        </td>
                        ${sectorHtml}
                        <td class="text-end font-monospace">${formatLapTime(d.totalTimeMs)}</td>
                        <td class="text-end font-monospace text-body-secondary">${d.gap || '\u2014'}</td>
                        <td class="text-center">${d.lapCount}</td>
                    </tr>`;
    }).join('')}
            </tbody>
        </table>
    </div>`;
}

export async function renderSessionDetail(container: HTMLElement): Promise<void> {
    const sessionId = getEntityId('sessions');
    if (!sessionId) {
        container.innerHTML = '<div class="alert alert-warning">No session ID specified.</div>';
        return;
    }

    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';

    let session: Session;
    let results: Result[];
    let laps: LapItem[];
    let allSectors: SectorData[];

    try {
        const [sessionResp, resultsResp, lapsResp, sectorsResp] = await Promise.all([
            axios.get<Session>(`${apiBase}/api/sessions/${sessionId}/public`),
            axios.get<Result[]>(`${apiBase}/api/sessions/${sessionId}/results`).catch((): { data: Result[] } => ({ data: [] })),
            axios.get<LapItem[]>(`${apiBase}/api/sessions/${sessionId}/laps`).catch((): { data: LapItem[] } => ({ data: [] })),
            axios.get<SectorData[]>(`${apiBase}/api/sessions/${sessionId}/sectors`).catch((): { data: SectorData[] } => ({ data: [] })),
        ]);
        session = sessionResp.data;
        results = resultsResp.data;
        laps = lapsResp.data;
        allSectors = sectorsResp.data;
    } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
            container.innerHTML = '<div class="alert alert-warning">Session not found.</div>';
        } else {
            container.innerHTML = '<div class="alert alert-danger">Failed to load session.</div>';
        }
        return;
    }

    const token = getAccessToken();

    // Fetch event + track + layouts + classes for breadcrumbs, role check, and session info
    let event: EventDetail | null = null;
    let track: TrackPublic | null = null;
    let canManage = false;
    let layouts: LayoutOption[] = [];
    let classes: KartClassOption[] = [];

    try {
        const membershipCheck: Promise<string | null> = token ?
            axios.get<{ role: string }>(`${apiBase}/api/tracks/${session.track_id}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            }).then(resp => resp.data.role, () => null) :
            Promise.resolve(null);

        const [trackResp, eventResult, memberRole, layoutsResp, classesResp] = await Promise.all([
            axios.get<TrackPublic>(`${apiBase}/api/tracks/${session.track_id}/public`),
            session.event_id ?
                axios.get<EventDetail>(`${apiBase}/api/events/${session.event_id}`).then(r => r.data, () => null) :
                Promise.resolve(null),
            membershipCheck,
            axios.get<LayoutOption[]>(`${apiBase}/api/tracks/${session.track_id}/layouts`).
                catch((): { data: LayoutOption[] } => ({ data: [] })),
            axios.get<KartClassOption[]>(`${apiBase}/api/tracks/${session.track_id}/classes`).
                catch((): { data: KartClassOption[] } => ({ data: [] })),
        ]);
        track = trackResp.data;
        event = eventResult;
        canManage = memberRole === 'owner' || memberRole === 'admin';
        layouts = layoutsResp.data;
        classes = classesResp.data;
    } catch {
        // Non-fatal
    }
    const sessionName = session.session_name ?? 'Session';
    document.title = `${sessionName} \u2014 Kart Track Park`;

    // Fetch series registration info if this session belongs to a series
    const seriesCtx = event?.series?.[0];
    let series: SeriesDetail | null = null;
    let myReg: Registration | null = null;
    let seriesRegs: Registration[] = [];

    if (seriesCtx) {
        try {
            const [seriesResp, regsResp, myRegsResp] = await Promise.all([
                axios.get<SeriesDetail>(`${apiBase}/api/series/${seriesCtx.series_id}`),
                axios.get<Registration[]>(`${apiBase}/api/series/${seriesCtx.series_id}/registrations`).catch((): { data: Registration[] } => ({ data: [] })),
                token ?
                    api.get<Registration[]>('/api/my/registrations?type=series').catch((): { data: Registration[] } => ({ data: [] })) :
                    Promise.resolve<{ data: Registration[] }>({ data: [] }),
            ]);
            series = seriesResp.data;
            seriesRegs = regsResp.data;
            myReg = myRegsResp.data.find(r => r.uid && r.parent_id === seriesCtx.series_id) ?? null;
        } catch {
            // Non-fatal
        }
    }

    // Determine join button state
    const confirmedRegs = seriesRegs.filter(r => r.status === 'confirmed' || r.status === 'pending');
    const regCount = confirmedRegs.length;
    const regMode = series?.registration_mode ?? 'closed';
    const regOpen = regMode === 'open' || regMode === 'approval_required' || regMode === 'invite_only';
    const isRegistered = myReg?.status === 'confirmed' || myReg?.status === 'pending';
    const loggedIn = isLoggedIn();
    const deadlinePassed = series?.registration_deadline ? new Date(series.registration_deadline) < new Date() : false;
    const spotsFull = series?.max_spots ? regCount >= series.max_spots : false;
    const canJoin = regOpen && !isRegistered && !deadlinePassed && !spotsFull;

    // Build breadcrumb
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

    // Session info pills
    const layoutMap = new Map(layouts.map(l => [l.layout_id, l.name]));
    const classMap = new Map(classes.map(c => [c.class_id, c.name]));
    const infoPills = buildSessionInfoPills(
        session,
        layoutMap,
        classMap,
    );

    const useTotalTime = scoringUsesTotalTime(session.session_type);

    // Build driver standings from laps
    const standings = buildDriverStandings(laps, session.session_type);
    const overallBestMs = standings.length > 0 ? Math.min(...standings.map(d => d.bestLapMs).filter(ms => ms > 0)) : 0;

    // Build sector display data
    const sectorDisplay = buildSectorDisplay(allSectors);

    // If no lap data but we have registrations/results, fall back to simple driver list
    let driversSection: string;
    if (standings.length > 0) {
        driversSection = standingsTableHtml(standings, useTotalTime, overallBestMs, sectorDisplay, session.session_id, session.session_name);
    } else if (confirmedRegs.length > 0 || results.length > 0) {
        driversSection = buildFallbackDriverList(confirmedRegs, results);
    } else {
        driversSection = '<p class="text-body-secondary">No drivers yet.</p>';
    }

    const sessionType = session.session_type ?? '';
    const badgeColor = SESSION_TYPE_BADGE_COLORS[sessionType] ?? 'text-bg-secondary';

    // Build action buttons
    const actionButtons: string[] = [];
    if (canJoin && seriesCtx && series) {
        if (loggedIn) {
            actionButtons.push('<button class="btn btn-sm btn-success" id="join-series-btn"><i class="fa-solid fa-user-plus me-1"></i>Join Series</button>');
        } else {
            actionButtons.push('<button class="btn btn-sm btn-success" id="login-to-join-btn"><i class="fa-solid fa-right-to-bracket me-1"></i>Sign in to Join</button>');
        }
    }
    if (isRegistered && seriesCtx) {
        actionButtons.push('<span class="badge text-bg-success d-flex align-items-center gap-1"><i class="fa-solid fa-check"></i> Registered</span>');
    }
    if (canManage) {
        actionButtons.push('<button class="btn btn-sm btn-outline-secondary" id="edit-session-btn"><i class="fa-solid fa-pen me-1"></i>Edit</button>');
    }
    if (loggedIn) {
        actionButtons.push('<button class="btn btn-sm btn-outline-primary" id="upload-laps-btn"><i class="fa-solid fa-upload me-1"></i>Upload Laps</button>');
    }
    if ((loggedIn || canManage) && laps.length > 0) {
        actionButtons.push('<button class="btn btn-sm btn-outline-secondary" id="reprocess-laps-btn"><i class="fa-solid fa-arrows-rotate me-1"></i>Reprocess Laps</button>');
    }

    container.innerHTML = `
        ${breadcrumbParts.length > 0 ? `
        <div class="d-flex flex-wrap align-items-center gap-2 mb-3 text-body-secondary small">
            ${breadcrumbParts.join('<i class="fa-solid fa-chevron-right mx-1" style="font-size:.6rem"></i>')}
            <i class="fa-solid fa-chevron-right mx-1" style="font-size:.6rem"></i>
            <span class="active">${esc(sessionName)}</span>
        </div>` : ''}
        <div class="d-flex align-items-center gap-2 mb-2">
            <h1 class="mb-0">${esc(sessionName)}</h1>
            ${sessionType ? `<span class="badge ${badgeColor}">${sessionType.replace('_', ' ')}</span>` : ''}
            ${actionButtons.length > 0 ? `<div class="ms-auto d-flex align-items-center gap-2">${actionButtons.join('')}</div>` : ''}
        </div>
        ${infoPills.length > 0 ? `
        <div class="d-flex flex-wrap gap-3 text-body-secondary small mb-4">
            ${infoPills.join('')}
        </div>` : '<div class="mb-4"></div>'}
        ${driversSection}

        <!-- Join Series Confirmation Modal -->
        <div class="modal fade" id="join-modal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Join ${seriesCtx ? esc(seriesCtx.series_name) : 'Series'}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p>You are registering for <strong>${seriesCtx ? esc(seriesCtx.series_name) : 'this series'}</strong>.</p>
                        ${series?.price_cents ? `<div class="d-flex align-items-center gap-2 mb-3">
                            <i class="fa-solid fa-tag text-body-secondary"></i>
                            <span>Entry fee: <strong>$${(series.price_cents / 100).toFixed(2)}${series.currency ? ' ' + esc(series.currency) : ''}</strong></span>
                        </div>` : ''}
                        ${series?.max_spots ? `<div class="d-flex align-items-center gap-2 mb-3">
                            <i class="fa-solid fa-users text-body-secondary"></i>
                            <span>${regCount}/${series.max_spots} spots filled</span>
                        </div>` : ''}
                        ${series?.registration_deadline ? `<div class="d-flex align-items-center gap-2 mb-3">
                            <i class="fa-solid fa-clock text-body-secondary"></i>
                            <span>Registration closes <strong>${dateFmt.format(new Date(series.registration_deadline))}</strong></span>
                        </div>` : ''}
                        <div class="alert alert-warning mb-3">
                            <i class="fa-solid fa-triangle-exclamation me-1"></i>
                            <strong>By registering, you are committing to participate.</strong>
                            ${series?.registration_deadline ? ` You may withdraw before <strong>${dateFmt.format(new Date(series.registration_deadline))}</strong>.` : ''}
                            After the deadline, withdrawals may not be allowed.
                        </div>
                        <div class="form-check">
                            <input type="checkbox" class="form-check-input" id="join-confirm-check">
                            <label class="form-check-label" for="join-confirm-check">
                                I understand and want to register
                            </label>
                        </div>
                        <div class="alert alert-danger mt-3 mb-0 d-none" id="join-error"></div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-success" id="join-submit-btn" disabled>
                            <i class="fa-solid fa-user-plus me-1"></i>${regMode === 'approval_required' ? 'Request to Join' : 'Join'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Init Bootstrap tooltips on info pills
    initTooltips(container);

    // Wire up clickable driver rows
    container.querySelectorAll<HTMLElement>('tr[data-href]').forEach(row => {
        row.addEventListener('click', () => {
            const href = row.dataset.href;
            if (href) {
                window.location.href = href;
            }
        });
    });

    // Wire up Join Series
    if (canJoin && seriesCtx && series) {
        if (loggedIn) {
            const bs = await import('bootstrap');
            const joinModalEl = document.getElementById('join-modal');
            const joinCheck = document.querySelector<HTMLInputElement>('#join-confirm-check');
            const joinSubmit = document.querySelector<HTMLButtonElement>('#join-submit-btn');
            const joinError = document.getElementById('join-error');

            if (joinModalEl && joinCheck && joinSubmit) {
                const joinModal = new bs.Modal(joinModalEl);

                document.getElementById('join-series-btn')?.addEventListener('click', () => joinModal.show());

                joinCheck.addEventListener('change', () => {
                    joinSubmit.disabled = !joinCheck.checked;
                });

                joinSubmit.addEventListener('click', async () => {
                    joinSubmit.disabled = true;
                    joinSubmit.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Registering\u2026';

                    try {
                        await api.post(`/api/series/${seriesCtx.series_id}/registrations`, {});
                        joinModal.hide();
                        await renderSessionDetail(container);
                    } catch (err: unknown) {
                        joinSubmit.disabled = false;
                        joinSubmit.innerHTML = '<i class="fa-solid fa-user-plus me-1"></i>Join';
                        joinCheck.checked = false;
                        let msg = 'Registration failed. Please try again.';
                        if (axios.isAxiosError<{ error?: string }>(err) && typeof err.response?.data?.error === 'string') {
                            msg = err.response.data.error;
                        }
                        if (joinError) {
                            joinError.textContent = msg;
                            joinError.classList.remove('d-none');
                        }
                    }
                });
            }
        } else {
            document.getElementById('login-to-join-btn')?.addEventListener('click', () => login());
        }
    }

    // Wire up edit session button
    if (canManage) {
        document.getElementById('edit-session-btn')?.addEventListener('click', () => {
            void openEditSessionModal(session, layouts, classes, container);
        });
    }

    // Wire up upload laps button
    if (loggedIn) {
        document.getElementById('upload-laps-btn')?.addEventListener('click', () => {
            void openUploadManager({
                trackId: session.track_id,
                eventId: session.event_id,
                sessionId: session.session_id,
                onComplete: () => void renderSessionDetail(container),
            });
        });
    }

    // Wire up reprocess laps button
    document.getElementById('reprocess-laps-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('reprocess-laps-btn');
        if (!(btn instanceof HTMLButtonElement)) {
            return;
        }
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Reprocessing\u2026';

        try {
            await api.post(`/api/sessions/${session.session_id}/reprocess`);
            await renderSessionDetail(container);
        } catch {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-arrows-rotate me-1"></i>Reprocess Laps';
        }
    });
}

function buildFallbackDriverList(regs: Registration[], results: Result[]): string {
    interface FallbackRow {
        name: string;
        position: number;
        fastestLapMs: number | null;
        hasResult: boolean;
    }

    const resultByUid = new Map(results.map(r => [r.uid, r]));
    const seenUids = new Set<string>();
    const rows: FallbackRow[] = [];

    for (const reg of regs) {
        seenUids.add(reg.uid);
        const result = resultByUid.get(reg.uid);
        rows.push({
            name: reg.driver_name,
            position: result?.position ?? 0,
            fastestLapMs: result?.fastest_lap_ms ?? null,
            hasResult: Boolean(result),
        });
    }

    for (const r of results) {
        if (!seenUids.has(r.uid)) {
            rows.push({
                name: r.driver_name,
                position: r.position,
                fastestLapMs: r.fastest_lap_ms ?? null,
                hasResult: true,
            });
        }
    }

    rows.sort((a, b) => {
        if (a.hasResult && !b.hasResult) {
            return -1;
        }
        if (!a.hasResult && b.hasResult) {
            return 1;
        }
        if (a.hasResult && b.hasResult) {
            if (a.position && b.position) {
                return a.position - b.position;
            }
            const aLap = a.fastestLapMs ?? Infinity;
            const bLap = b.fastestLapMs ?? Infinity;
            if (aLap !== bLap) {
                return aLap - bLap;
            }
        }
        return a.name.localeCompare(b.name);
    });

    return `<table class="table table-hover align-middle mb-0">
        <thead>
            <tr class="text-body-secondary small">
                <th style="width:3rem">#</th>
                <th>Driver</th>
            </tr>
        </thead>
        <tbody>
            ${rows.map((d, i) => `<tr${!d.hasResult ? ' class="text-body-secondary"' : ''}>
                <td class="fw-semibold text-body-secondary">${d.hasResult ? String(d.position || i + 1) : ''}</td>
                <td>${esc(d.name)}</td>
            </tr>`).join('')}
        </tbody>
    </table>`;
}

// --- Edit Session Modal ---

async function openEditSessionModal(session: Session, layouts: LayoutOption[], classes: KartClassOption[], container: HTMLElement): Promise<void> {
    const bs = await import('bootstrap');

    // Need full session data for fields not in the public endpoint
    interface FullSessionData {
        start_type?: string;
        layout_id?: string;
        lap_limit?: number;
        notes?: string;
        reverse?: boolean;
        class_ids?: string[];
    }
    let full: FullSessionData = {};
    try {
        const resp = await api.get<{ session: FullSessionData }>(`/api/sessions/${session.session_id}`);
        full = resp.data.session;
    } catch {
        // Use empty defaults
    }

    const fsStartType = full.start_type ?? '';
    const fsLayoutId = full.layout_id ?? '';
    const fsLapLimit = full.lap_limit ?? 0;
    const fsNotes = full.notes ?? '';
    const fsReverse = full.reverse ?? false;

    const typeOptions = SESSION_TYPES.map(t =>
        `<option value="${t}" ${session.session_type === t ? 'selected' : ''}>${typeLabel(t)}</option>`,
    ).join('');

    const startTypeOptions = START_TYPES.map(t =>
        `<option value="${t}" ${fsStartType === t ? 'selected' : ''}>${startTypeLabel(t)}</option>`,
    ).join('');

    const layoutOptions = layouts.map(l =>
        `<option value="${l.layout_id}" ${fsLayoutId === l.layout_id ? 'selected' : ''}>${esc(l.name)}${l.is_default ? ' (default)' : ''}</option>`,
    ).join('');

    const classIds = full.class_ids ?? [];
    const classCheckboxes = classes.map(kc => {
        const checked = classIds.includes(kc.class_id);
        const cbId = `edit-s-class-${kc.class_id}`;
        return `<div class="form-check form-check-inline mb-0">
            <input type="checkbox" class="form-check-input edit-s-class" id="${cbId}" data-class-id="${kc.class_id}" ${checked ? 'checked' : ''}>
            <label class="form-check-label small" for="${cbId}">${esc(kc.name)}</label>
        </div>`;
    }).join('');

    const modalId = 'edit-session-modal';
    let modalEl = document.getElementById(modalId);
    if (modalEl) {
        modalEl.remove();
    }

    modalEl = document.createElement('div');
    modalEl.id = modalId;
    modalEl.className = 'modal fade';
    modalEl.tabIndex = -1;
    modalEl.innerHTML = `
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title"><i class="fa-solid fa-pen me-2"></i>Edit Session</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <div class="mb-3">
                        <label class="form-label fw-semibold">Session Name</label>
                        <input type="text" class="form-control" id="edit-s-name" value="${esc(session.session_name ?? '')}">
                    </div>
                    <div class="row mb-3">
                        <div class="col">
                            <label class="form-label fw-semibold">Type</label>
                            <select class="form-select" id="edit-s-type">${typeOptions}</select>
                        </div>
                        <div class="col">
                            <label class="form-label fw-semibold">Start Type</label>
                            <select class="form-select" id="edit-s-start-type">
                                <option value="">None</option>
                                ${startTypeOptions}
                            </select>
                        </div>
                    </div>
                    <div class="row mb-3">
                        <div class="col">
                            <label class="form-label fw-semibold">Layout</label>
                            <select class="form-select" id="edit-s-layout">${layoutOptions}</select>
                        </div>
                        <div class="col-auto d-flex align-items-end">
                            <div class="form-check mb-2">
                                <input type="checkbox" class="form-check-input" id="edit-s-reverse" ${fsReverse ? 'checked' : ''}>
                                <label class="form-check-label" for="edit-s-reverse">Reverse</label>
                            </div>
                        </div>
                    </div>
                    <div class="mb-3">
                        <label class="form-label fw-semibold">Lap Limit</label>
                        <input type="number" class="form-control" id="edit-s-lap-limit" min="0" placeholder="No limit" value="${fsLapLimit || ''}">
                    </div>
                    ${classes.length > 0 ? `<div class="mb-3">
                        <label class="form-label fw-semibold">Classes</label>
                        <div>${classCheckboxes}</div>
                    </div>` : ''}
                    <div class="mb-3">
                        <label class="form-label fw-semibold">Notes</label>
                        <input type="text" class="form-control" id="edit-s-notes" value="${esc(fsNotes)}">
                    </div>
                    <div class="alert alert-danger d-none mb-0" id="edit-s-error"></div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                    <button type="button" class="btn btn-primary" id="edit-s-save">
                        <i class="fa-solid fa-check me-1"></i>Save
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modalEl);

    const modal = new bs.Modal(modalEl);
    modal.show();

    modalEl.addEventListener('hidden.bs.modal', () => {
        modalEl?.remove();
    }, { once: true });

    modalEl.querySelector('#edit-s-save')?.addEventListener('click', async () => {
        const saveBtn = modalEl?.querySelector<HTMLButtonElement>('#edit-s-save');
        const errorEl = modalEl?.querySelector('#edit-s-error');
        if (!saveBtn || !modalEl) {
            return;
        }
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving\u2026';
        if (errorEl) {
            errorEl.classList.add('d-none');
        }

        try {
            const editedClassIds: string[] = [];
            modalEl.querySelectorAll('.edit-s-class').forEach(cb => {
                if (cb instanceof HTMLInputElement && cb.checked && cb.dataset.classId) {
                    editedClassIds.push(cb.dataset.classId);
                }
            });

            await api.put(`/api/sessions/${session.session_id}`, {
                sessionName: modalEl.querySelector<HTMLInputElement>('#edit-s-name')?.value.trim() ?? '',
                sessionType: modalEl.querySelector<HTMLSelectElement>('#edit-s-type')?.value ?? '',
                layoutId: modalEl.querySelector<HTMLSelectElement>('#edit-s-layout')?.value ?? '',
                reverse: modalEl.querySelector<HTMLInputElement>('#edit-s-reverse')?.checked ?? false,
                startType: modalEl.querySelector<HTMLSelectElement>('#edit-s-start-type')?.value ?? '',
                lapLimit: parseInt(modalEl.querySelector<HTMLInputElement>('#edit-s-lap-limit')?.value ?? '', 10) || 0,
                notes: modalEl.querySelector<HTMLInputElement>('#edit-s-notes')?.value.trim() ?? '',
                classIds: editedClassIds,
            });

            modal.hide();
            await renderSessionDetail(container);
        } catch (err: unknown) {
            let msg = 'Save failed. Please try again.';
            if (axios.isAxiosError<{ error?: string }>(err) && typeof err.response?.data?.error === 'string') {
                msg = err.response.data.error;
            }
            if (errorEl) {
                errorEl.textContent = msg;
                errorEl.classList.remove('d-none');
            }
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fa-solid fa-check me-1"></i>Save';
        }
    });
}
