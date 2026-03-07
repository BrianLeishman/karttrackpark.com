import axios from 'axios';
import { api, apiBase, assetsBase } from './api';
import { getAccessToken, isLoggedIn, login } from './auth';
import { esc, dateFmt } from './html';
import { getEntityId, trackDetailUrl, championshipDetailUrl, seriesDetailUrl, eventDetailUrl } from './url-utils';

interface Session {
    session_id: string;
    track_id: string;
    event_id?: string;
    session_name?: string;
    session_type?: string;
    session_order?: number;
    best_lap_ms?: number;
    lap_count?: number;
    ingest_status?: string;
    ingest_error?: string;
}

interface LapItem {
    session_id: string;
    lap_no: number;
    lap_time_ms: number;
    max_speed?: number;
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

function formatLapTime(ms: number): string {
    if (ms <= 0) {
        return '\u2014';
    }
    const totalSeconds = ms / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) {
        return `${String(minutes)}:${seconds.toFixed(3).padStart(6, '0')}`;
    }
    return seconds.toFixed(3);
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

    try {
        const [sessionResp, resultsResp, lapsResp] = await Promise.all([
            axios.get<Session>(`${apiBase}/api/sessions/${sessionId}/public`),
            axios.get<Result[]>(`${apiBase}/api/sessions/${sessionId}/results`).catch((): { data: Result[] } => ({ data: [] })),
            axios.get<LapItem[]>(`${apiBase}/api/sessions/${sessionId}/laps`).catch((): { data: LapItem[] } => ({ data: [] })),
        ]);
        session = sessionResp.data;
        results = resultsResp.data;
        laps = lapsResp.data;
    } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
            container.innerHTML = '<div class="alert alert-warning">Session not found.</div>';
        } else {
            container.innerHTML = '<div class="alert alert-danger">Failed to load session.</div>';
        }
        return;
    }

    // Check admin role
    const token = getAccessToken();
    const membershipCheck: Promise<string | null> = token ?
        axios.get<{ role: string }>(`${apiBase}/api/tracks/${session.track_id}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        }).then(resp => resp.data.role, () => null) :
        Promise.resolve(null);

    // Fetch event + track for breadcrumbs
    let event: EventDetail | null = null;
    let track: TrackPublic | null = null;
    let role: string | null = null;

    try {
        const [trackResp, memberResult, eventResult] = await Promise.all([
            axios.get<TrackPublic>(`${apiBase}/api/tracks/${session.track_id}/public`),
            membershipCheck,
            session.event_id ?
                axios.get<EventDetail>(`${apiBase}/api/events/${session.event_id}`).then(r => r.data, () => null) :
                Promise.resolve(null),
        ]);
        track = trackResp.data;
        role = memberResult;
        event = eventResult;
    } catch {
        // Non-fatal
    }

    const canManage = role === 'owner' || role === 'admin';
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

    // Build unified driver list: merge series registrations with results
    interface DriverRow {
        name: string;
        position: number;
        fastestLapMs: number | null;
        points: number | null;
        kartId: string | null;
        hasResult: boolean;
    }

    const resultByUid = new Map(results.map(r => [r.uid, r]));
    const seenUids = new Set<string>();
    const driverRows: DriverRow[] = [];

    // First add all series registrants (preserves registration order, results get sorted later)
    for (const reg of confirmedRegs) {
        seenUids.add(reg.uid);
        const result = resultByUid.get(reg.uid);
        driverRows.push({
            name: reg.driver_name,
            position: result?.position ?? 0,
            fastestLapMs: result?.fastest_lap_ms ?? null,
            points: result?.points ?? null,
            kartId: result?.kart_id ?? null,
            hasResult: Boolean(result),
        });
    }

    // Then add any results for drivers not in the series registrations
    for (const r of results) {
        if (!seenUids.has(r.uid)) {
            driverRows.push({
                name: r.driver_name,
                position: r.position,
                fastestLapMs: r.fastest_lap_ms ?? null,
                points: r.points ?? null,
                kartId: r.kart_id ?? null,
                hasResult: true,
            });
        }
    }

    // Sort: drivers with results first (by position/fastest lap), then drivers without results alphabetically
    driverRows.sort((a, b) => {
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
            if (a.position && !b.position) {
                return -1;
            }
            if (!a.position && b.position) {
                return 1;
            }
            const aLap = a.fastestLapMs ?? Infinity;
            const bLap = b.fastestLapMs ?? Infinity;
            if (aLap !== bLap) {
                return aLap - bLap;
            }
        }
        return a.name.localeCompare(b.name);
    });

    const fastestLap = driverRows.reduce((min, d) => {
        const lap = d.fastestLapMs ?? Infinity;
        return lap < min ? lap : min;
    }, Infinity);

    const hasPoints = driverRows.some(d => d.points);
    const hasKarts = driverRows.some(d => d.kartId);

    const driversHtml = driverRows.length > 0 ? `
        <table class="table table-hover align-middle mb-0">
            <thead>
                <tr>
                    <th style="width:3rem">#</th>
                    <th>Driver</th>
                    <th class="text-end">Fastest Lap</th>
                    ${hasPoints ? '<th class="text-end">Pts</th>' : ''}
                    ${hasKarts ? '<th>Kart</th>' : ''}
                </tr>
            </thead>
            <tbody>
                ${driverRows.map((d, i) => {
        const isFastest = d.fastestLapMs === fastestLap && fastestLap < Infinity;
        const posText = d.hasResult ? String(d.position || i + 1) : '';
        let lapText = '\u2014';
        if (d.fastestLapMs) {
            lapText = formatLapTime(d.fastestLapMs);
        } else if (!d.hasResult) {
            lapText = '<span class="text-body-secondary">\u2014</span>';
        }
        return `<tr${!d.hasResult ? ' class="text-body-secondary"' : ''}>
                        <td class="fw-semibold text-body-secondary">${posText}</td>
                        <td>${esc(d.name)}</td>
                        <td class="text-end font-monospace${isFastest ? ' text-success fw-semibold' : ''}">${lapText}</td>
                        ${hasPoints ? `<td class="text-end">${d.points ?? ''}</td>` : ''}
                        ${hasKarts ? `<td>${esc(d.kartId ?? '')}</td>` : ''}
                    </tr>`;
    }).join('')}
            </tbody>
        </table>` :
        '<p class="text-body-secondary">No drivers yet.</p>';

    // Laps table
    const bestLap = laps.reduce((min, l) => l.lap_time_ms < min ? l.lap_time_ms : min, Infinity);
    const hasSpeed = laps.some(l => l.max_speed);
    const lapsHtml = laps.length > 0 ? `
        <table class="table table-hover align-middle mb-0">
            <thead>
                <tr>
                    <th style="width:3rem">Lap</th>
                    <th class="text-end">Time</th>
                    ${hasSpeed ? '<th class="text-end">Max Speed</th>' : ''}
                </tr>
            </thead>
            <tbody>
                ${laps.map(l => {
        const isBest = l.lap_time_ms === bestLap && bestLap < Infinity;
        return `<tr>
                        <td class="fw-semibold text-body-secondary">${l.lap_no}</td>
                        <td class="text-end font-monospace${isBest ? ' text-success fw-semibold' : ''}">${formatLapTime(l.lap_time_ms)}</td>
                        ${hasSpeed ? `<td class="text-end">${l.max_speed ? `${l.max_speed.toFixed(1)} mph` : '\u2014'}</td>` : ''}
                    </tr>`;
    }).join('')}
            </tbody>
        </table>` : '';

    const typeBadgeColors: Record<string, string> = {
        practice: 'text-bg-secondary',
        quali: 'text-bg-info',
        heat: 'text-bg-warning',
        final: 'text-bg-danger',
        driver_meeting: 'text-bg-secondary',
    };
    const sessionType = session.session_type ?? '';
    const badgeColor = typeBadgeColors[sessionType] ?? 'text-bg-secondary';

    const ingestStatus = session.ingest_status;
    const isIngesting = ingestStatus === 'pending' || ingestStatus === 'processing';

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
        actionButtons.push('<button class="btn btn-sm btn-outline-primary" id="upload-data-btn"><i class="fa-solid fa-upload me-1"></i>Upload Data</button>');
    }

    container.innerHTML = `
        ${breadcrumbParts.length > 0 ? `
        <div class="d-flex flex-wrap align-items-center gap-2 mb-3 text-body-secondary small">
            ${breadcrumbParts.join('<i class="fa-solid fa-chevron-right mx-1" style="font-size:.6rem"></i>')}
            <i class="fa-solid fa-chevron-right mx-1" style="font-size:.6rem"></i>
            <span class="active">${esc(sessionName)}</span>
        </div>` : ''}
        <div class="d-flex align-items-center gap-2 mb-4">
            <h1 class="mb-0">${esc(sessionName)}</h1>
            ${sessionType ? `<span class="badge ${badgeColor}">${sessionType.replace('_', ' ')}</span>` : ''}
            ${actionButtons.length > 0 ? `<div class="ms-auto d-flex align-items-center gap-2">${actionButtons.join('')}</div>` : ''}
        </div>
        <div id="ingest-status"></div>
        ${lapsHtml ? `<h3 class="mb-3">Laps</h3><div>${lapsHtml}</div>` : ''}
        <h3 class="mb-3 mt-4">Drivers${driverRows.length > 0 ? ` <span class="badge text-bg-secondary fw-normal">${driverRows.length}</span>` : ''}</h3>
        <div>${driversHtml}</div>

        <!-- Upload Modal -->
        <div class="modal fade" id="upload-modal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Upload Telemetry Data</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label for="xrk-file" class="form-label">AIM Solo XRK File</label>
                            <input type="file" class="form-control" id="xrk-file" accept=".xrk">
                        </div>
                        <div id="upload-progress" class="d-none">
                            <div class="progress mb-2">
                                <div class="progress-bar progress-bar-striped progress-bar-animated" id="upload-bar" style="width:0%"></div>
                            </div>
                            <small class="text-body-secondary" id="upload-status-text">Uploading...</small>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" id="upload-submit-btn" disabled>Upload</button>
                    </div>
                </div>
            </div>
        </div>

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

    // Wire up upload functionality
    if (canManage) {
        const bs = await import('bootstrap');
        const modalEl = document.getElementById('upload-modal');
        const fileInput = document.querySelector<HTMLInputElement>('#xrk-file');
        const submitBtn = document.querySelector<HTMLButtonElement>('#upload-submit-btn');
        const progressDiv = document.getElementById('upload-progress');
        const progressBar = document.getElementById('upload-bar');
        const statusText = document.getElementById('upload-status-text');

        if (modalEl && fileInput && submitBtn && progressDiv && progressBar && statusText) {
            const modal = new bs.Modal(modalEl);

            document.getElementById('upload-data-btn')?.addEventListener('click', () => modal.show());

            fileInput.addEventListener('change', () => {
                submitBtn.disabled = !fileInput.files?.length;
            });

            submitBtn.addEventListener('click', async () => {
                const file = fileInput.files?.[0];
                if (!file) {
                    return;
                }

                submitBtn.disabled = true;
                progressDiv.classList.remove('d-none');
                progressBar.style.width = '0%';
                statusText.textContent = 'Getting upload URL...';

                try {
                    const { data: uploadData } = await api.post<{ upload_url: string; key: string }>('/api/upload-url', {
                        track_id: session.track_id,
                        session_id: session.session_id,
                        filename: file.name,
                    });

                    statusText.textContent = 'Starting ingest...';
                    progressBar.style.width = '10%';
                    await api.post(`/api/sessions/${sessionId}/ingest`, { s3_key: uploadData.key });

                    statusText.textContent = 'Uploading file...';
                    await axios.put(uploadData.upload_url, file, {
                        headers: { 'Content-Type': 'application/octet-stream' },
                        onUploadProgress: e => {
                            if (e.total) {
                                const pct = 10 + Math.round((e.loaded / e.total) * 80);
                                progressBar.style.width = `${pct}%`;
                            }
                        },
                    });

                    progressBar.style.width = '100%';
                    statusText.textContent = 'Upload complete. Processing...';

                    modal.hide();
                    startPolling(sessionId, container);
                } catch {
                    statusText.textContent = 'Upload failed. Please try again.';
                    submitBtn.disabled = false;
                }
            });
        }
    }

    // Auto-poll if currently ingesting
    if (isIngesting) {
        startPolling(sessionId, container);
    }

    // Show ingest error if present
    if (ingestStatus === 'error' && session.ingest_error) {
        const statusDiv = document.getElementById('ingest-status');
        if (statusDiv) {
            statusDiv.innerHTML = `<div class="alert alert-danger alert-dismissible">
                <strong>Ingest error:</strong> ${esc(session.ingest_error)}
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>`;
        }
    }
}

function startPolling(sessionId: string, container: HTMLElement): void {
    const statusDiv = container.querySelector('#ingest-status');
    if (statusDiv) {
        statusDiv.innerHTML = `<div class="alert alert-info d-flex align-items-center gap-2">
            <div class="spinner-border spinner-border-sm"></div>
            Processing telemetry data...
        </div>`;
    }

    const poll = setInterval(async () => {
        try {
            const { data } = await axios.get<Session>(`${apiBase}/api/sessions/${sessionId}/public`);
            if (data.ingest_status === 'complete') {
                clearInterval(poll);
                window.location.reload();
            } else if (data.ingest_status === 'error') {
                clearInterval(poll);
                if (statusDiv) {
                    statusDiv.innerHTML = `<div class="alert alert-danger">
                        <strong>Ingest error:</strong> ${esc(data.ingest_error ?? 'Unknown error')}
                    </div>`;
                }
            }
        } catch {
            // Keep polling on network errors
        }
    }, 2000);
}
