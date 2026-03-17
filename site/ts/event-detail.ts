import axios from 'axios';
import { api, apiBase, assetsBase } from './api';
import { getAccessToken } from './auth';
import { esc, dateFmt, typeLabel, formatLapTime, SESSION_TYPES, START_TYPES, startTypeLabel } from './html';
import { getEntityId, ensureCorrectEventUrl, trackDetailUrl, championshipDetailUrl, seriesDetailUrl, sessionDetailUrl } from './url-utils';
import { openUploadManager } from './upload-manager';

interface SeriesContext {
    series_id: string;
    series_name: string;
    championship_id: string;
    championship_name: string;
    championship_logo_key?: string;
    round_number: number;
}

interface EventDetail {
    event_id: string;
    track_id: string;
    track_name: string;
    name: string;
    description?: string;
    event_type?: string;
    start_time: string;
    end_time?: string;
    created_at: string;
    series?: SeriesContext[];
}

interface TrackPublic {
    track_id: string;
    name: string;
    logo_key?: string;
}

interface TrackAuth {
    role: string;
}

interface FullSession {
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
}

interface Layout {
    layout_id: string;
    name: string;
    is_default?: boolean;
}

interface KartClass {
    class_id: string;
    name: string;
    is_default?: boolean;
}

function sessionBadgeClass(type: string): string {
    const map: Record<string, string> = {
        quali: 'badge-session badge-quali',
        heat: 'badge-session badge-heat',
        final: 'badge-session badge-final',
        race: 'badge-session badge-final',
    };
    return map[type] ?? 'badge-session badge-meeting';
}

function sessionAccentClass(type: string): string {
    const map: Record<string, string> = {
        quali: 'session-accent accent-quali',
        heat: 'session-accent accent-heat',
        final: 'session-accent accent-final',
        race: 'session-accent accent-final',
    };
    return map[type] ?? 'session-accent';
}

function sessionSubtitle(s: FullSession): string {
    const type = s.session_type ?? '';
    const lapCount = s.lap_count ?? 0;
    if (lapCount === 0) {
        return '';
    }
    if (type === 'quali') {
        return `${lapCount} laps${s.best_lap_ms ? ` \u00B7 best ${formatLapTime(s.best_lap_ms)}` : ''}`;
    }
    if (type === 'heat' || type === 'final' || type === 'race') {
        return `${lapCount} laps${s.best_lap_driver_name ? ` \u00B7 won by ${esc(s.best_lap_driver_name)}` : ''}`;
    }
    return `${lapCount} laps`;
}

function sessionCardHtml(s: FullSession): string {
    const type = s.session_type ?? '';
    const sub = sessionSubtitle(s);
    const timeHtml = s.best_lap_ms ?
        `<div class="session-time">${formatLapTime(s.best_lap_ms)}</div>` :
        '<div class="session-no-laps">No laps</div>';

    return `
        <a href="${sessionDetailUrl(s.session_id, s.session_name ?? 'session')}" class="session-card">
            <div class="${sessionAccentClass(type)}"></div>
            <div class="session-info">
                <div class="session-name">${esc(s.session_name ?? 'Unnamed')}</div>
                ${sub ? `<div class="session-detail">${sub}</div>` : ''}
            </div>
            <span class="${sessionBadgeClass(type)}">${typeLabel(type)}</span>
            ${timeHtml}
            <span class="session-chevron">\u203A</span>
        </a>`;
}

function buildSessionGroups(sessions: FullSession[]): string {
    if (sessions.length === 0) {
        return '<p class="text-body-secondary">No sessions.</p>';
    }

    const parts: string[] = [];
    const meetings: FullSession[] = [];
    const nonMeetings = sessions.filter(s => {
        if (s.session_type === 'driver_meeting') {
            meetings.push(s);
            return false;
        }
        return true;
    });

    // Group into rounds: each quali + its following heat form a pair
    // Finals form their own section
    let roundNum = 0;
    let i = 0;
    while (i < nonMeetings.length) {
        const s = nonMeetings[i];
        const type = s.session_type ?? '';

        if (type === 'final' || type === 'race') {
            // Collect all consecutive finals
            const finals: FullSession[] = [];
            while (i < nonMeetings.length) {
                const ft = nonMeetings[i].session_type ?? '';
                if (ft !== 'final' && ft !== 'race') {
                    break;
                }
                finals.push(nonMeetings[i]);
                i++;
            }
            parts.push('<div class="section-label">Finals</div>');
            if (finals.length === 1) {
                parts.push(sessionCardHtml(finals[0]));
            } else {
                parts.push('<div class="pair-group">');
                for (const f of finals) {
                    parts.push(sessionCardHtml(f));
                }
                parts.push('</div>');
            }
            continue;
        }

        // Quali + heat pair
        if (type === 'quali') {
            roundNum++;
            parts.push(`<div class="section-label">Round ${roundNum}</div>`);
            const pair: FullSession[] = [s];
            i++;
            // Check if next session is a heat (pair it)
            if (i < nonMeetings.length && nonMeetings[i].session_type === 'heat') {
                pair.push(nonMeetings[i]);
                i++;
            }
            if (pair.length > 1) {
                parts.push('<div class="pair-group">');
                for (const p of pair) {
                    parts.push(sessionCardHtml(p));
                }
                parts.push('</div>');
            } else {
                parts.push(sessionCardHtml(pair[0]));
            }
            continue;
        }

        // Standalone session (heat without preceding quali, practice, etc.)
        parts.push(sessionCardHtml(s));
        i++;
    }

    // Driver meetings at the bottom, dimmed
    for (const m of meetings) {
        parts.push(`<div class="session-card-meeting">${sessionCardHtml(m)}</div>`);
    }

    return parts.join('\n');
}

function toLocalDatetime(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function renderEventDetail(container: HTMLElement): Promise<void> {
    const eventId = getEntityId('events');
    if (!eventId) {
        container.innerHTML = '<div class="alert alert-warning">No event ID specified.</div>';
        return;
    }

    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';

    let event: EventDetail;
    let fullSessions: FullSession[];

    try {
        const [eventResp, sessionsResp] = await Promise.all([
            api.get<EventDetail>(`/api/events/${eventId}`),
            axios.get<FullSession[]>(`${apiBase}/api/events/${eventId}/sessions?full=true`).
                catch((): { data: FullSession[] } => ({ data: [] })),
        ]);
        event = eventResp.data;
        fullSessions = sessionsResp.data;
    } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
            container.innerHTML = '<div class="alert alert-warning">Event not found.</div>';
        } else {
            container.innerHTML = '<div class="alert alert-danger">Failed to load event.</div>';
        }
        return;
    }

    const seriesCtx = event.series?.[0];
    if (ensureCorrectEventUrl(event.event_id, event.name, seriesCtx ? { championship_name: seriesCtx.championship_name, series_name: seriesCtx.series_name } : undefined)) {
        return;
    }

    const token = getAccessToken();
    const membershipCheck: Promise<string | null> = token ?
        axios.get<TrackAuth>(`${apiBase}/api/tracks/${event.track_id}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        }).then(resp => resp.data.role, () => null) :
        Promise.resolve(null);

    let track: TrackPublic;
    let role: string | null;
    let layouts: Layout[] = [];
    let classes: KartClass[] = [];

    try {
        const [trackResp, memberResult, layoutsResp, classesResp] = await Promise.all([
            axios.get<TrackPublic>(`${apiBase}/api/tracks/${event.track_id}/public`),
            membershipCheck,
            axios.get<Layout[]>(`${apiBase}/api/tracks/${event.track_id}/layouts`).
                catch((): { data: Layout[] } => ({ data: [] })),
            axios.get<KartClass[]>(`${apiBase}/api/tracks/${event.track_id}/classes`).
                catch((): { data: KartClass[] } => ({ data: [] })),
        ]);
        track = trackResp.data;
        role = memberResult;
        layouts = layoutsResp.data;
        classes = classesResp.data;
    } catch {
        container.innerHTML = '<div class="alert alert-danger">Failed to load track info.</div>';
        return;
    }

    const layoutMap = new Map(layouts.map(l => [l.layout_id, l.name]));
    const classMap = new Map(classes.map(c => [c.class_id, c.name]));

    const canManage = role === 'owner' || role === 'admin';

    document.title = `${event.name} \u2014 Kart Track Park`;

    // Build breadcrumb from series context
    const breadcrumbParts: string[] = [
        `<a href="${trackDetailUrl(track.track_id, track.name)}" class="d-inline-flex align-items-center gap-2 text-body-secondary" data-track-hover="${track.track_id}">
            ${track.logo_key ?
                `<img src="${assetsBase}/${track.logo_key}" alt="" width="28" height="28" class="rounded flex-shrink-0" style="object-fit:cover">` :
                '<div class="rounded bg-body-secondary flex-shrink-0 d-flex align-items-center justify-content-center" style="width:28px;height:28px"><i class="fa-solid fa-flag-checkered small"></i></div>'
            }
            <span>${esc(track.name)}</span>
        </a>`,
    ];
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

    fullSessions.sort((a, b) => (a.session_order ?? 0) - (b.session_order ?? 0));

    // Build layout + class info for the header (show once, not per session)
    const layoutIds = [...new Set(fullSessions.map(s => s.layout_id).filter(Boolean))];
    const layoutNames = layoutIds.map(id => layoutMap.get(id ?? '')).filter(Boolean);
    const classIds = [...new Set(fullSessions.flatMap(s => s.class_ids ?? []))];
    const classNames = classIds.map(id => classMap.get(id)).filter(Boolean);
    const metaParts: string[] = [
        dateFmt.format(new Date(event.start_time)),
    ];
    const metaLine2: string[] = [];
    if (layoutNames.length > 0) {
        metaLine2.push(layoutNames.map(n => esc(n ?? '')).join(', ') + ' layout');
    }
    if (classNames.length > 0) {
        metaLine2.push(classNames.map(n => esc(n ?? '')).join(', '));
    }

    // Compute stat card data
    let fastestLapMs = 0;
    let fastestLapDriver = '';
    let fastestLapSession = '';
    let eventWinner = '';
    let eventWinnerTime = 0;
    let totalDrivers = 0;

    for (const s of fullSessions) {
        if (s.best_lap_ms && (fastestLapMs === 0 || s.best_lap_ms < fastestLapMs)) {
            fastestLapMs = s.best_lap_ms;
            fastestLapDriver = s.best_lap_driver_name ?? '';
            fastestLapSession = s.session_name ?? '';
        }
        totalDrivers += s.lap_count ?? 0;
    }

    // Event winner = best from highest-tier final
    const finals = fullSessions.filter(s => s.session_type === 'final' || s.session_type === 'race');
    if (finals.length > 0) {
        const topFinal = finals[finals.length - 1];
        if (topFinal.best_lap_driver_name) {
            eventWinner = topFinal.best_lap_driver_name;
            eventWinnerTime = topFinal.best_lap_ms ?? 0;
        }
    }

    // Group sessions into pair groups and sections
    const sessionsHtml = buildSessionGroups(fullSessions);

    // Series tag
    const seriesTag = seriesCtx ?
        `<span class="race-tag">R${seriesCtx.round_number} ${esc(seriesCtx.series_name)}</span>` :
        '';

    container.innerHTML = `
        <div class="breadcrumb-flat">
            ${breadcrumbParts.map((part, i) =>
                (i > 0 ? '<span class="breadcrumb-sep">\u203A</span>' : '') + part,
            ).join('')}
            <span class="breadcrumb-sep">\u203A</span>
            <span class="breadcrumb-current">${esc(event.name)}</span>
        </div>
        <div class="d-flex align-items-start gap-3 mb-3">
            <div>
                <div class="race-title">${esc(event.name)}</div>
                <div class="race-meta">
                    ${metaParts.join('')}${metaLine2.length > 0 ? `<br>${metaLine2.join(' \u00B7 ')}` : ''}
                </div>
                ${seriesTag}
                ${event.description ? `<p class="text-body-secondary mt-2 mb-0" style="font-size:13px">${esc(event.description)}</p>` : ''}
            </div>
            ${canManage ? `
                <div class="ms-auto d-flex gap-2 flex-shrink-0">
                    <button class="btn btn-sm btn-primary" id="upload-laps-btn"><i class="fa-solid fa-upload me-1"></i>Upload Laps</button>
                    <button class="btn btn-sm btn-outline-secondary" id="edit-event-btn"><i class="fa-solid fa-pen me-1"></i>Edit</button>
                    <button class="btn-ghost-danger" id="delete-event-btn"><i class="fa-solid fa-trash me-1"></i>Delete</button>
                </div>
            ` : ''}
        </div>
        ${fastestLapMs > 0 ? `
        <div class="stats-row">
            <div class="stat-card">
                <div class="stat-label">Fastest Lap</div>
                <div class="stat-value font-monospace">${formatLapTime(fastestLapMs)}</div>
                <div class="stat-sub">${fastestLapDriver ? `${esc(fastestLapDriver)} \u00B7 ${esc(fastestLapSession)}` : esc(fastestLapSession)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Event Winner</div>
                <div class="stat-value">${eventWinner ? esc(eventWinner) : '\u2014'}</div>
                ${eventWinnerTime ? `<div class="stat-sub font-monospace">${formatLapTime(eventWinnerTime)}</div>` : ''}
            </div>
            <div class="stat-card">
                <div class="stat-label">Total Laps</div>
                <div class="stat-value">${totalDrivers}</div>
                <div class="stat-sub">${fullSessions.filter(s => s.session_type !== 'driver_meeting').length} sessions</div>
            </div>
        </div>` : ''}
        ${sessionsHtml}
        ${canManage && fullSessions.some(s => s.lap_count && s.lap_count > 0) ? '<div class="text-end mt-2"><button class="btn btn-sm btn-outline-secondary" id="reprocess-all-btn"><i class="fa-solid fa-arrows-rotate me-1"></i>Reprocess All Laps</button></div>' : ''}
    `;

    document.getElementById('delete-event-btn')?.addEventListener('click', async () => {
        if (!confirm(`Delete "${event.name}"? This cannot be undone.`)) {
            return;
        }
        try {
            await api.delete(`/api/events/${event.event_id}`);
            window.location.href = trackDetailUrl(track.track_id, track.name);
        } catch { /* api interceptor shows toast */ }
    });

    document.getElementById('edit-event-btn')?.addEventListener('click', () => {
        void openEditModal(event, fullSessions, layouts, classes, container);
    });

    document.getElementById('upload-laps-btn')?.addEventListener('click', () => {
        void openUploadManager({
            trackId: event.track_id,
            eventId: event.event_id,
            onComplete: () => void renderEventDetail(container),
        });
    });

    document.getElementById('reprocess-all-btn')?.addEventListener('click', async () => {
        const sessionsWithLaps = fullSessions.filter(s => s.lap_count && s.lap_count > 0);
        if (sessionsWithLaps.length === 0) {
            return;
        }
        const btn = document.getElementById('reprocess-all-btn');
        if (!(btn instanceof HTMLButtonElement)) {
            return;
        }
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Reprocessing\u2026';

        try {
            for (const s of sessionsWithLaps) {
                await api.post(`/api/sessions/${s.session_id}/reprocess`);
            }
            await renderEventDetail(container);
        } catch {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-arrows-rotate me-1"></i>Reprocess Laps';
        }
    });
}

// --- Edit Event Modal ---

function sessionRowHtml(s: FullSession, idx: number, layouts: Layout[], classes: KartClass[]): string {
    const typeOptions = SESSION_TYPES.map(t =>
        `<option value="${t}" ${s.session_type === t ? 'selected' : ''}>${typeLabel(t)}</option>`,
    ).join('');

    const startTypeOptions = START_TYPES.map(t =>
        `<option value="${t}" ${s.start_type === t ? 'selected' : ''}>${startTypeLabel(t)}</option>`,
    ).join('');

    const layoutOptions = layouts.map(l =>
        `<option value="${l.layout_id}" ${s.layout_id === l.layout_id ? 'selected' : ''}>${esc(l.name)}${l.is_default ? ' (default)' : ''}</option>`,
    ).join('');

    const classCheckboxes = classes.map(kc => {
        const checked = s.class_ids?.includes(kc.class_id) ?? kc.is_default;
        const cbId = `edit-sess-${idx}-class-${kc.class_id}`;
        return `<div class="form-check form-check-inline mb-0">
            <input type="checkbox" class="form-check-input edit-sess-class" id="${cbId}" data-class-id="${kc.class_id}" ${checked ? 'checked' : ''}>
            <label class="form-check-label small" for="${cbId}">${esc(kc.name)}</label>
        </div>`;
    }).join('');

    return `
        <div class="edit-session-row border rounded p-2 mb-2" data-idx="${idx}" data-session-id="${s.session_id}">
            <div class="d-flex align-items-center gap-2 mb-2">
                <span class="text-body-secondary fw-semibold" style="min-width:1.5rem">${idx + 1}</span>
                <input type="text" class="form-control form-control-sm edit-sess-name" placeholder="Session name" value="${esc(s.session_name ?? '')}">
                <select class="form-select form-select-sm edit-sess-type" style="max-width:130px">${typeOptions}</select>
            </div>
            <div class="d-flex align-items-center gap-2 mb-2">
                <div style="min-width:1.5rem"></div>
                <select class="form-select form-select-sm edit-sess-layout" style="max-width:200px" title="Layout">
                    ${layoutOptions}
                </select>
                <div class="form-check form-check-inline mb-0">
                    <input type="checkbox" class="form-check-input edit-sess-reverse" ${s.reverse ? 'checked' : ''}>
                    <label class="form-check-label small">Reverse</label>
                </div>
                <select class="form-select form-select-sm edit-sess-start-type" style="max-width:140px" title="Start type">
                    <option value="">Start type\u2026</option>
                    ${startTypeOptions}
                </select>
                <input type="number" class="form-control form-control-sm edit-sess-lap-limit" placeholder="Lap limit" min="1" style="max-width:100px" value="${s.lap_limit ?? ''}" title="Max laps to count">
            </div>
            ${classes.length > 0 ? `<div class="d-flex align-items-center gap-1 mb-2">
                <div style="min-width:1.5rem"></div>
                <span class="text-body-secondary small me-1">Classes:</span>
                ${classCheckboxes}
            </div>` : ''}
            <div class="d-flex align-items-center gap-2">
                <div style="min-width:1.5rem"></div>
                <input type="text" class="form-control form-control-sm edit-sess-notes" placeholder="Notes (optional)" value="${esc(s.notes ?? '')}">
            </div>
        </div>`;
}

function collectSessionEdits(modalEl: HTMLElement): { sessionId: string; fields: Record<string, unknown> }[] {
    const results: { sessionId: string; fields: Record<string, unknown> }[] = [];
    modalEl.querySelectorAll('.edit-session-row').forEach((row, idx) => {
        if (!(row instanceof HTMLElement)) {
            return;
        }
        const sessionId = row.dataset.sessionId ?? '';
        if (!sessionId) {
            return;
        }

        const name = row.querySelector<HTMLInputElement>('.edit-sess-name')?.value.trim() ?? '';
        const type = row.querySelector<HTMLSelectElement>('.edit-sess-type')?.value ?? '';
        const layoutId = row.querySelector<HTMLSelectElement>('.edit-sess-layout')?.value ?? '';
        const reverse = row.querySelector<HTMLInputElement>('.edit-sess-reverse')?.checked ?? false;
        const startType = row.querySelector<HTMLSelectElement>('.edit-sess-start-type')?.value ?? '';
        const lapLimit = parseInt(row.querySelector<HTMLInputElement>('.edit-sess-lap-limit')?.value ?? '', 10) || 0;
        const notes = row.querySelector<HTMLInputElement>('.edit-sess-notes')?.value.trim() ?? '';
        const classIds: string[] = [];
        row.querySelectorAll('.edit-sess-class').forEach(cb => {
            if (cb instanceof HTMLInputElement && cb.checked && cb.dataset.classId) {
                classIds.push(cb.dataset.classId);
            }
        });

        const fields: Record<string, unknown> = {
            sessionName: name,
            sessionType: type,
            sessionOrder: idx + 1,
            layoutId,
            reverse,
            startType,
            lapLimit,
            notes,
            classIds,
        };
        results.push({ sessionId, fields });
    });
    return results;
}

async function openEditModal(event: EventDetail, sessions: FullSession[], layouts: Layout[], classes: KartClass[], container: HTMLElement): Promise<void> {
    const bs = await import('bootstrap');

    const sorted = [...sessions].sort((a, b) => (a.session_order ?? 0) - (b.session_order ?? 0));

    const sessionsRowsHtml = sorted.map((s, i) =>
        sessionRowHtml(s, i, layouts, classes),
    ).join('');

    const modalId = 'edit-event-modal';
    let modalEl = document.getElementById(modalId);
    if (modalEl) {
        modalEl.remove();
    }

    modalEl = document.createElement('div');
    modalEl.id = modalId;
    modalEl.className = 'modal fade';
    modalEl.tabIndex = -1;
    modalEl.innerHTML = `
        <div class="modal-dialog modal-lg modal-dialog-scrollable">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title"><i class="fa-solid fa-pen me-2"></i>Edit Event</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <div class="mb-3">
                        <label class="form-label fw-semibold">Event Name</label>
                        <input type="text" class="form-control" id="edit-event-name" value="${esc(event.name)}">
                    </div>
                    <div class="mb-3">
                        <label class="form-label fw-semibold">Description</label>
                        <textarea class="form-control" id="edit-event-desc" rows="2">${esc(event.description ?? '')}</textarea>
                    </div>
                    <div class="row mb-3">
                        <div class="col">
                            <label class="form-label fw-semibold">Start Time</label>
                            <input type="datetime-local" class="form-control" id="edit-event-start" value="${toLocalDatetime(event.start_time)}">
                        </div>
                        <div class="col">
                            <label class="form-label fw-semibold">End Time</label>
                            <input type="datetime-local" class="form-control" id="edit-event-end" value="${event.end_time ? toLocalDatetime(event.end_time) : ''}">
                        </div>
                    </div>
                    ${sorted.length > 0 ? `
                    <hr>
                    <h6 class="fw-semibold mb-3">Sessions</h6>
                    <div id="edit-sessions-list">${sessionsRowsHtml}</div>
                    ` : ''}
                    <div class="alert alert-danger d-none mt-3 mb-0" id="edit-event-error"></div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                    <button type="button" class="btn btn-primary" id="edit-event-save">
                        <i class="fa-solid fa-check me-1"></i>Save
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modalEl);

    const modal = new bs.Modal(modalEl);
    modal.show();

    // Clean up on hide
    modalEl.addEventListener('hidden.bs.modal', () => {
        modalEl?.remove();
    }, { once: true });

    // Save handler
    modalEl.querySelector('#edit-event-save')?.addEventListener('click', async () => {
        const saveBtn = modalEl?.querySelector<HTMLButtonElement>('#edit-event-save');
        const errorEl = modalEl?.querySelector('#edit-event-error');
        if (!saveBtn || !modalEl) {
            return;
        }
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving\u2026';
        if (errorEl) {
            errorEl.classList.add('d-none');
        }

        try {
            const name = modalEl.querySelector<HTMLInputElement>('#edit-event-name')?.value.trim() ?? '';
            const desc = modalEl.querySelector<HTMLTextAreaElement>('#edit-event-desc')?.value.trim() ?? '';
            const startVal = modalEl.querySelector<HTMLInputElement>('#edit-event-start')?.value ?? '';
            const endVal = modalEl.querySelector<HTMLInputElement>('#edit-event-end')?.value ?? '';

            const eventFields: Record<string, unknown> = { name };
            if (desc) {
                eventFields.description = desc;
            }
            if (startVal) {
                eventFields.startTime = new Date(startVal).toISOString();
            }
            if (endVal) {
                eventFields.endTime = new Date(endVal).toISOString();
            }

            // Update event
            await api.put(`/api/events/${event.event_id}`, eventFields);

            // Update all sessions in parallel
            const sessionEdits = collectSessionEdits(modalEl);
            await Promise.all(sessionEdits.map(edit =>
                api.put(`/api/sessions/${edit.sessionId}`, edit.fields),
            ));

            modal.hide();
            // Re-render the page with updated data
            await renderEventDetail(container);
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
