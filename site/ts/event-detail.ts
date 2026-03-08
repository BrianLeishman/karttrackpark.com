import axios from 'axios';
import { api, apiBase, assetsBase } from './api';
import { getAccessToken } from './auth';
import { esc, dateFmt, typeBadge, typeLabel, formatLapTime, SESSION_TYPES, START_TYPES, startTypeLabel } from './html';
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
    const sessionsHtml = fullSessions.length > 0 ?
        fullSessions.map(s => {
            const details: string[] = [];
            if (s.layout_id) {
                const name = layoutMap.get(s.layout_id);
                if (name) {
                    details.push(`<i class="fa-solid fa-route me-1"></i>${esc(name)}${s.reverse ? ' (rev)' : ''}`);
                }
            }
            if (s.start_type) {
                details.push(`<i class="fa-solid fa-flag me-1"></i>${startTypeLabel(s.start_type)}`);
            }
            if (s.lap_limit) {
                details.push(`<i class="fa-solid fa-hashtag me-1"></i>${String(s.lap_limit)} lap${s.lap_limit !== 1 ? 's' : ''}`);
            }
            if (s.class_ids && s.class_ids.length > 0) {
                const names = s.class_ids.map(id => classMap.get(id)).filter(Boolean);
                if (names.length > 0) {
                    details.push(`<i class="fa-solid fa-car me-1"></i>${names.map(n => esc(n ?? '')).join(', ')}`);
                }
            }
            let bestLapHtml = '';
            if (s.best_lap_ms) {
                bestLapHtml = `
                    <span class="font-monospace text-success fw-semibold">${formatLapTime(s.best_lap_ms)}</span>
                    ${s.best_lap_driver_name ? `<div class="text-body-tertiary" style="font-size:.75em">${esc(s.best_lap_driver_name)}</div>` : ''}`;
            }
            return `
            <a href="${sessionDetailUrl(s.session_id, s.session_name ?? 'session')}" class="row align-items-center gx-2 py-2 border-bottom text-decoration-none text-body">
                <div class="col-6">
                    <div class="d-flex align-items-center gap-2">
                        <span class="badge rounded-pill font-monospace" style="background:var(--bs-tertiary-bg);color:var(--bs-secondary-color);min-width:2rem">${s.session_order ?? ''}</span>
                        <div>
                            <div>${esc(s.session_name ?? 'Unnamed')}</div>
                            ${details.length > 0 ? `<div class="d-flex flex-wrap gap-3 text-body-secondary small mt-1">${details.map(d => `<span>${d}</span>`).join('')}</div>` : ''}
                        </div>
                    </div>
                </div>
                <div class="col text-center small text-nowrap">
                    ${bestLapHtml}
                </div>
                <div class="col-auto d-flex align-items-center gap-2">
                    ${s.session_type ? `<span class="badge text-bg-secondary">${s.session_type.replace('_', ' ')}</span>` : ''}
                    <i class="fa-solid fa-chevron-right text-body-tertiary"></i>
                </div>
            </a>`;
        }).join('') :
        '<p class="text-body-secondary">No sessions.</p>';

    container.innerHTML = `
        <div class="d-flex flex-wrap align-items-center gap-2 mb-3 text-body-secondary small">
            ${breadcrumbParts.join('<i class="fa-solid fa-chevron-right mx-1" style="font-size:.6rem"></i>')}
            <i class="fa-solid fa-chevron-right mx-1" style="font-size:.6rem"></i>
            <span class="active">${esc(event.name)}</span>
        </div>
        <div class="d-flex align-items-center gap-2 mb-2">
            <h1 class="mb-0">${esc(event.name)}</h1>
            ${typeBadge(event.event_type)}
            ${canManage ? `
                <div class="ms-auto d-flex gap-2">
                    <button class="btn btn-sm btn-outline-primary" id="upload-laps-btn"><i class="fa-solid fa-upload me-1"></i>Upload Laps</button>
                    <button class="btn btn-sm btn-outline-secondary" id="edit-event-btn"><i class="fa-solid fa-pen me-1"></i>Edit</button>
                    <button class="btn btn-sm btn-outline-danger" id="delete-event-btn"><i class="fa-solid fa-trash me-1"></i>Delete</button>
                </div>
            ` : ''}
        </div>
        <p class="text-body-secondary mb-1">
            <i class="fa-solid fa-clock me-1"></i>${dateFmt.format(new Date(event.start_time))}${event.end_time ? ` \u2014 ${dateFmt.format(new Date(event.end_time))}` : ''}
        </p>
        ${event.description ? `<p class="text-body-secondary">${esc(event.description)}</p>` : ''}
        ${event.series && event.series.length > 0 ? `
        <div class="d-flex flex-wrap gap-1 mb-3">
            ${event.series.map(s =>
                `<a href="${seriesDetailUrl(s.series_id, s.series_name)}" class="badge text-bg-info text-decoration-none">R${s.round_number} ${esc(s.series_name)}</a>`,
            ).join('')}
        </div>` : ''}
        ${fullSessions.length > 0 ? `
        <h3 class="mt-4 mb-2">Sessions</h3>
        <div>${sessionsHtml}</div>` : ''}
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
