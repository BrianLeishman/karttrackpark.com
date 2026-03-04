import axios from 'axios';
import { Modal } from 'bootstrap';
import { api } from './api';
import { getAccessToken } from './auth';
import { slugify, trackDetailUrl } from './track-detail';
import { championshipDetailUrl } from './championship-detail';

interface Series {
    series_id: string;
    track_id: string;
    championship_id: string;
    name: string;
    description?: string;
    status?: string;
    rules?: string;
    created_at: string;
}

interface Championship {
    championship_id: string;
    track_id: string;
    name: string;
    logo_key?: string;
}

interface TrackPublic {
    track_id: string;
    name: string;
    logo_key?: string;
}

interface SeriesEvent {
    series_id: string;
    event_id: string;
    round_number: number;
    event_name?: string;
    start_time?: string;
    created_at: string;
}

interface SeriesDriver {
    series_id: string;
    uid: string;
    driver_name: string;
    seeded: boolean;
    total_points?: number;
    created_at: string;
}

interface TrackAuth {
    role: string;
}

interface FormatSession {
    session_name: string;
    session_type: string;
    duration?: number;
    lap_count?: number;
    class_ids?: string[];
    notes?: string;
    layout_id?: string;
    reverse?: boolean;
}

interface Format {
    format_id: string;
    track_id: string;
    name: string;
    sessions: FormatSession[];
}

const apiBase = document.querySelector<HTMLMetaElement>('meta[name="api-base"]')?.content ??
    'https://62lt3y3apd.execute-api.us-east-1.amazonaws.com';

const assetsBase = document.querySelector<HTMLMetaElement>('meta[name="assets-base"]')?.content ??
    'https://assets.karttrackpark.com';

function isHugoServer(): boolean {
    return document.querySelector<HTMLMetaElement>('meta[name="hugo-server"]')?.content === 'true';
}

function getSeriesId(): string | null {
    if (isHugoServer()) {
        return new URLSearchParams(window.location.search).get('id');
    }
    const match = /^\/series\/([a-z0-9]+)/.exec(window.location.pathname);
    return match?.[1] ?? null;
}

export function seriesDetailUrl(seriesId: string, name: string): string {
    if (isHugoServer()) {
        return `/series/?id=${seriesId}`;
    }
    return `/series/${seriesId}/${slugify(name)}`;
}

const typeLabel = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function statusColor(status?: string): string {
    const map: Record<string, string> = {
        active: 'success', upcoming: 'warning', completed: 'info', archived: 'secondary',
    };
    return map[status ?? ''] ?? 'secondary';
}

const shortDate = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
});

function ensureCorrectSlug(series: Series): boolean {
    if (isHugoServer()) {
        return false;
    }
    const expectedSlug = slugify(series.name);
    const pathParts = window.location.pathname.split('/');
    const currentSlug = pathParts[3] ?? '';
    if (currentSlug !== expectedSlug) {
        window.location.replace(`/series/${series.series_id}/${expectedSlug}`);
        return true;
    }
    return false;
}

export async function renderSeriesDetail(container: HTMLElement): Promise<void> {
    const seriesId = getSeriesId();
    if (!seriesId) {
        container.innerHTML = '<div class="alert alert-warning">No series ID specified.</div>';
        return;
    }

    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';

    let series: Series;
    let events: SeriesEvent[];
    let drivers: SeriesDriver[];

    // Fetch series + events + drivers in parallel (all use seriesId)
    try {
        const [seriesResp, eventsResp, driversResp] = await Promise.all([
            api.get<Series>(`/api/series/${seriesId}`),
            api.get<SeriesEvent[]>(`/api/series/${seriesId}/events`),
            api.get<SeriesDriver[]>(`/api/series/${seriesId}/drivers`),
        ]);
        series = seriesResp.data;
        events = eventsResp.data;
        drivers = driversResp.data;
    } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
            container.innerHTML = '<div class="alert alert-warning">Series not found.</div>';
        } else {
            container.innerHTML = '<div class="alert alert-danger">Failed to load series.</div>';
        }
        return;
    }

    if (ensureCorrectSlug(series)) {
        return;
    }

    // Fetch championship + track + membership (need IDs from series)
    const token = getAccessToken();
    const membershipCheck: Promise<string | null> = token ?
        axios.get<TrackAuth>(`${apiBase}/api/tracks/${series.track_id}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        }).then(resp => resp.data.role, () => null) :
        Promise.resolve(null);

    let champ: Championship;
    let track: TrackPublic;
    let formats: Format[];
    let role: string | null;

    try {
        const [champResp, trackResp, formatsResp, memberResult] = await Promise.all([
            api.get<Championship>(`/api/championships/${series.championship_id}`),
            axios.get<TrackPublic>(`${apiBase}/api/tracks/${series.track_id}/public`),
            axios.get<Format[]>(`${apiBase}/api/tracks/${series.track_id}/formats`).catch((): { data: Format[] } => ({ data: [] })),
            membershipCheck,
        ]);
        champ = champResp.data;
        track = trackResp.data;
        formats = formatsResp.data;
        role = memberResult;
    } catch {
        container.innerHTML = '<div class="alert alert-danger">Failed to load details.</div>';
        return;
    }

    const canManage = role === 'owner' || role === 'admin';

    document.title = `${series.name} \u2014 Kart Track Park`;

    // Sort events by round number, drivers by points descending
    events.sort((a, b) => a.round_number - b.round_number);
    drivers.sort((a, b) => (b.total_points ?? 0) - (a.total_points ?? 0));

    const eventsHtml = events.length > 0 ?
        events.map(ev => `
            <div class="d-flex align-items-center gap-2 py-2 border-bottom">
                <span class="badge rounded-pill font-monospace" style="background:var(--bs-tertiary-bg);color:var(--bs-secondary-color);min-width:2.5rem">R${ev.round_number}</span>
                <span class="flex-grow-1">${esc(ev.event_name ?? 'Unnamed event')}</span>
                ${ev.start_time ? `<span class="text-body-secondary small">${shortDate.format(new Date(ev.start_time))}</span>` : ''}
            </div>`).join('') :
        '<p class="text-body-secondary">No events linked yet.</p>';

    const driversHtml = drivers.length > 0 ?
        drivers.map(d => `
            <div class="d-flex align-items-center gap-2 py-2 border-bottom">
                <span class="flex-grow-1">${esc(d.driver_name)}</span>
                ${d.seeded ? '<span class="badge text-bg-info">Seeded</span>' : ''}
                <span class="fw-semibold">${d.total_points ?? 0} pts</span>
            </div>`).join('') :
        '<p class="text-body-secondary">No drivers enrolled yet.</p>';

    container.innerHTML = `
        <a href="${trackDetailUrl(track.track_id, track.name)}" class="d-inline-flex align-items-center gap-2 text-decoration-none text-body-secondary mb-2" data-track-hover="${track.track_id}">
            ${track.logo_key ?
                `<img src="${assetsBase}/${track.logo_key}" alt="" width="28" height="28" class="rounded flex-shrink-0" style="object-fit:cover">` :
                '<div class="rounded bg-body-secondary flex-shrink-0 d-flex align-items-center justify-content-center" style="width:28px;height:28px"><i class="fa-solid fa-flag-checkered small"></i></div>'
            }
            <span>${esc(track.name)}</span>
        </a>
        <div class="mb-2">
            <a href="${championshipDetailUrl(champ.championship_id, champ.name)}" class="d-inline-flex align-items-center gap-2 text-decoration-none text-body-secondary">
                ${champ.logo_key ?
                    `<img src="${assetsBase}/${champ.logo_key}" alt="" width="28" height="28" class="rounded flex-shrink-0" style="object-fit:cover">` :
                    '<div class="rounded bg-body-secondary flex-shrink-0 d-flex align-items-center justify-content-center" style="width:28px;height:28px"><i class="fa-solid fa-trophy small"></i></div>'
                }
                <span>${esc(champ.name)}</span>
            </a>
        </div>
        <div class="d-flex align-items-center gap-2 mb-2">
            <h1 class="mb-0">${esc(series.name)}</h1>
            ${series.status ? `<span class="badge text-bg-${statusColor(series.status)}">${series.status}</span>` : ''}
            ${canManage ? `
                <a href="/my/series/edit/?id=${series.series_id}" class="btn btn-sm btn-outline-secondary ms-auto"><i class="fa-solid fa-pen me-1"></i>Edit</a>
                <button class="btn btn-sm btn-outline-danger" id="delete-series-btn"><i class="fa-solid fa-trash me-1"></i>Delete</button>
            ` : ''}
        </div>
        ${series.description ? `<p class="text-body-secondary">${esc(series.description)}</p>` : ''}
        ${series.rules ? `<div class="mb-4"><h5>Rules</h5><p class="text-body-secondary">${esc(series.rules)}</p></div>` : ''}
        <div class="row g-4 mt-2">
            <div class="col-md-7">
                <div class="d-flex align-items-center mb-3">
                    <h3 class="mb-0">Events</h3>
                    ${canManage ? '<button class="btn btn-sm btn-primary ms-auto" id="new-event-btn"><i class="fa-solid fa-plus me-1"></i>New Event</button>' : ''}
                </div>
                <div>${eventsHtml}</div>
            </div>
            <div class="col-md-5">
                <h3 class="mb-3">Drivers</h3>
                <div>${driversHtml}</div>
            </div>
        </div>
    `;

    // Delete series handler
    document.getElementById('delete-series-btn')?.addEventListener('click', async () => {
        if (!confirm(`Delete "${series.name}"? This cannot be undone.`)) {
            return;
        }
        try {
            await api.delete(`/api/series/${series.series_id}`);
            window.location.href = championshipDetailUrl(champ.championship_id, champ.name);
        } catch { /* api interceptor shows toast */ }
    });

    // New Event button
    document.getElementById('new-event-btn')?.addEventListener('click', () => {
        const nextRound = events.length > 0 ? Math.max(...events.map(e => e.round_number)) + 1 : 1;
        showNewEventModal(series, track, formats, nextRound, async () => {
            await renderSeriesDetail(container);
        });
    });
}

function showNewEventModal(
    series: Series,
    track: TrackPublic,
    formats: Format[],
    nextRound: number,
    onSave: () => Promise<void>,
): void {
    const formatOptions = formats.map(f =>
        `<option value="${f.format_id}">${esc(f.name)} (${f.sessions.length} sessions)</option>`,
    ).join('');

    document.getElementById('new-event-modal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="new-event-modal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">New Event</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <form id="ne-form">
                    <div class="modal-body">
                        <div class="mb-3">
                            <div class="d-flex align-items-center gap-2">
                                <label class="form-label mb-0" for="ne-format">Format</label>
                                <a href="${trackDetailUrl(track.track_id, track.name)}" class="small" target="_blank">Manage formats</a>
                                <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-1" id="ne-refresh-formats" title="Refresh formats"><i class="fa-solid fa-arrows-rotate"></i></button>
                            </div>
                            <select class="form-select mt-1" id="ne-format">
                                <option value="">No format</option>
                                ${formatOptions}
                            </select>
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="ne-name">Event Name</label>
                            <input type="text" class="form-control" id="ne-name" required>
                            <div class="form-text" id="ne-name-hint">Use <code>{n}</code> for the round number with Repeat, e.g. "Race {n}" → Race 1, Race 2, …</div>
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="ne-start">Start Time</label>
                            <input type="datetime-local" class="form-control" id="ne-start" required>
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="ne-end">End Time <span class="text-body-secondary">(optional)</span></label>
                            <input type="datetime-local" class="form-control" id="ne-end">
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="ne-desc">Description <span class="text-body-secondary">(optional)</span></label>
                            <textarea class="form-control" id="ne-desc" rows="2"></textarea>
                        </div>
                        <hr class="my-3">
                        <div class="form-check mb-2">
                            <input type="checkbox" class="form-check-input" id="ne-repeat">
                            <label class="form-check-label" for="ne-repeat">Repeat</label>
                        </div>
                        <div id="ne-repeat-options" style="display:none">
                            <div class="row g-2 mb-2">
                                <div class="col-auto">
                                    <label class="form-label small mb-1" for="ne-recurrence">Frequency</label>
                                    <select class="form-select form-select-sm" id="ne-recurrence">
                                        <option value="1">Weekly</option>
                                        <option value="2">Biweekly</option>
                                    </select>
                                </div>
                                <div class="col-auto">
                                    <label class="form-label small mb-1" for="ne-weeks">Weeks</label>
                                    <input type="number" class="form-control form-control-sm" id="ne-weeks" min="1" max="52" value="7" style="max-width:80px">
                                </div>
                            </div>
                            <div id="ne-date-preview" class="small"></div>
                        </div>

                        <div id="ne-sessions-preview" style="display:none">
                            <label class="form-label">Sessions from format</label>
                            <div id="ne-sessions-list" class="small text-body-secondary"></div>
                        </div>
                        <div class="alert alert-danger mt-3 mb-0 d-none" id="ne-error"></div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="submit" class="btn btn-primary" id="ne-submit">Create</button>
                    </div>
                    </form>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('new-event-modal');
    if (!modalEl) {
        return;
    }
    const bsModal = new Modal(modalEl);
    bsModal.show();
    modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove(), { once: true });

    modalEl.addEventListener('shown.bs.modal', () => {
        const nameEl = document.getElementById('ne-name');
        if (nameEl instanceof HTMLInputElement) {
            nameEl.focus();
        }
    }, { once: true });

    // Format selection -> preview sessions
    const formatSelect = document.getElementById('ne-format');
    if (!(formatSelect instanceof HTMLSelectElement)) {
        return;
    }
    const previewContainer = document.getElementById('ne-sessions-preview');
    if (!previewContainer) {
        return;
    }
    const previewList = document.getElementById('ne-sessions-list');
    if (!previewList) {
        return;
    }

    // Refresh formats list
    const refreshFormatsBtn = document.getElementById('ne-refresh-formats');
    if (refreshFormatsBtn) {
        refreshFormatsBtn.addEventListener('click', async () => {
            const btn = document.getElementById('ne-refresh-formats');
            if (!(btn instanceof HTMLButtonElement)) {
                return;
            }
            btn.disabled = true;
            const icon = btn.querySelector('i');
            if (icon instanceof HTMLElement) {
                icon.classList.add('fa-spin');
            }
            try {
                const resp = await axios.get<Format[]>(`${apiBase}/api/tracks/${series.track_id}/formats`);
                formats = resp.data;
                const prev = formatSelect.value;
                formatSelect.innerHTML = '<option value="">No format</option>' +
                    formats.map(f => `<option value="${f.format_id}">${esc(f.name)} (${f.sessions.length} sessions)</option>`).join('');
                if (formats.some(f => f.format_id === prev)) {
                    formatSelect.value = prev;
                }
                formatSelect.dispatchEvent(new Event('change'));
            } catch { /* api interceptor shows toast */ }
            btn.disabled = false;
            const iconAfter = btn.querySelector('i');
            if (iconAfter instanceof HTMLElement) {
                iconAfter.classList.remove('fa-spin');
            }
        });
    }

    formatSelect.addEventListener('change', () => {
        const selected = formats.find(f => f.format_id === formatSelect.value);
        if (selected && selected.sessions.length > 0) {
            previewContainer.style.display = '';
            previewList.innerHTML = selected.sessions.map((s, i) =>
                `<div class="d-flex align-items-center gap-2 py-1 border-bottom">
                    <span class="badge rounded-pill font-monospace" style="background:var(--bs-tertiary-bg);color:var(--bs-secondary-color);min-width:1.5rem">${i + 1}</span>
                    <span>${esc(s.session_name || typeLabel(s.session_type))}</span>
                    <span class="badge text-bg-secondary">${s.session_type.replace('_', ' ')}</span>
                    ${s.duration ? `<span class="text-body-secondary">${s.duration} min</span>` : ''}
                    ${s.lap_count ? `<span class="text-body-secondary">${s.lap_count} ${s.lap_count === 1 ? 'lap' : 'laps'}</span>` : ''}
                </div>`,
            ).join('');
        } else {
            previewContainer.style.display = 'none';
            previewList.innerHTML = '';
        }
    });

    // Recurrence controls
    const repeatCheck = document.getElementById('ne-repeat');
    if (!(repeatCheck instanceof HTMLInputElement)) {
        return;
    }
    const repeatOptions = document.getElementById('ne-repeat-options');
    if (!repeatOptions) {
        return;
    }
    const recurrenceSelect = document.getElementById('ne-recurrence');
    if (!(recurrenceSelect instanceof HTMLSelectElement)) {
        return;
    }
    const weeksInput = document.getElementById('ne-weeks');
    if (!(weeksInput instanceof HTMLInputElement)) {
        return;
    }
    const datePreview = document.getElementById('ne-date-preview');
    if (!datePreview) {
        return;
    }
    const startInput = document.getElementById('ne-start');
    if (!(startInput instanceof HTMLInputElement)) {
        return;
    }
    const nameInput = document.getElementById('ne-name');
    if (!(nameInput instanceof HTMLInputElement)) {
        return;
    }
    const resolveEventName = (template: string, roundNum: number): string => {
        if (template.includes('{n}')) {
            return template.replace(/\{n\}/g, String(roundNum));
        }
        return `${template} - Round ${roundNum}`;
    };

    // Generate initial dates from start time + frequency + count
    const generateDates = (): Date[] => {
        const val = startInput.value;
        if (!val) {
            return [];
        }
        const base = new Date(val);
        if (isNaN(base.getTime())) {
            return [];
        }

        const intervalWeeks = parseInt(recurrenceSelect.value, 10);
        const count = parseInt(weeksInput.value, 10) || 1;

        const dates: Date[] = [];
        for (let i = 0; i < count; i++) {
            const d = new Date(base);
            d.setDate(base.getDate() + i * intervalWeeks * 7);
            dates.push(d);
        }
        return dates;
    };

    // Editable dates state — regenerated when controls change, individually editable
    let eventDates: Date[] = [];

    // Format a Date to datetime-local input value (YYYY-MM-DDTHH:mm)
    const toLocalInput = (d: Date): string => {
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const renderDatePreview = () => {
        if (!repeatCheck.checked) {
            datePreview.innerHTML = '';
            return;
        }
        if (eventDates.length === 0) {
            datePreview.innerHTML = '<p class="text-body-secondary mb-0">Fill in a start time to see the race days list.</p>';
            return;
        }
        const template = nameInput.value.trim() || 'Event';
        datePreview.innerHTML = '<strong class="d-block mb-1">Race days:</strong>' +
            eventDates.map((d, i) => {
                const roundNum = nextRound + i;
                return `<div class="d-flex align-items-center gap-2 py-1">
                    <span class="badge rounded-pill font-monospace" style="background:var(--bs-tertiary-bg);color:var(--bs-secondary-color);min-width:2rem">R${roundNum}</span>
                    <span>${esc(resolveEventName(template, roundNum))}</span>
                    <input type="datetime-local" class="form-control form-control-sm ne-event-date" data-idx="${i}" value="${toLocalInput(d)}" style="max-width:220px">
                </div>`;
            }).join('');
    };

    // When an individual date input is changed, update that entry
    datePreview.addEventListener('change', e => {
        if (!(e.target instanceof HTMLInputElement) || !e.target.classList.contains('ne-event-date')) {
            return;
        }
        const idx = parseInt(e.target.dataset.idx ?? '', 10);
        if (isNaN(idx) || idx < 0 || idx >= eventDates.length) {
            return;
        }
        const newDate = new Date(e.target.value);
        if (!isNaN(newDate.getTime())) {
            eventDates[idx] = newDate;
        }
    });

    const regenerateAndRender = () => {
        eventDates = generateDates();
        renderDatePreview();
    };

    startInput.addEventListener('change', regenerateAndRender);

    repeatCheck.addEventListener('change', () => {
        repeatOptions.style.display = repeatCheck.checked ? '' : 'none';
        nameInput.placeholder = repeatCheck.checked ? 'e.g. Race {n}' : '';
        regenerateAndRender();
    });

    nameInput.addEventListener('input', renderDatePreview);

    [recurrenceSelect, weeksInput].forEach(el =>
        el.addEventListener('change', regenerateAndRender),
    );
    weeksInput.addEventListener('input', regenerateAndRender);

    // Helper: create one event, its sessions, and link to series
    const createOneEvent = async (
        eventName: string, startTime: string, endTime: string | undefined,
        description: string, selectedFormat: Format | undefined, roundNumber: number,
    ) => {
        const eventResp = await api.post<{ event_id: string }>(`/api/tracks/${series.track_id}/events`, {
            name: eventName,
            start_time: startTime,
            ...endTime && { end_time: endTime },
            ...description && { description },
        });
        const event = eventResp.data;

        if (selectedFormat) {
            for (let i = 0; i < selectedFormat.sessions.length; i++) {
                const s = selectedFormat.sessions[i];
                await api.post(`/api/events/${event.event_id}/sessions`, {
                    session_name: s.session_name || typeLabel(s.session_type),
                    session_type: s.session_type,
                    session_order: i + 1,
                    ...s.class_ids?.length && { class_ids: s.class_ids },
                    ...s.layout_id && { layout_id: s.layout_id },
                    ...s.reverse && { reverse: true },
                });
            }
        }

        await api.post(`/api/series/${series.series_id}/events`, {
            event_id: event.event_id,
            round_number: roundNumber,
        });
    };

    // Submit
    const neForm = document.getElementById('ne-form');
    if (!neForm) {
        return;
    }
    neForm.addEventListener('submit', async e => {
        e.preventDefault();

        const nameEl = document.getElementById('ne-name');
        if (!(nameEl instanceof HTMLInputElement)) {
            return;
        }
        const name = nameEl.value.trim();
        const startLocal = startInput.value;
        const endEl = document.getElementById('ne-end');
        const endLocal = endEl instanceof HTMLInputElement ? endEl.value : '';
        const descEl = document.getElementById('ne-desc');
        const description = descEl instanceof HTMLTextAreaElement ? descEl.value.trim() : '';
        const selectedFormat = formats.find(f => f.format_id === formatSelect.value);

        const btn = document.getElementById('ne-submit');
        if (!(btn instanceof HTMLButtonElement)) {
            return;
        }
        btn.disabled = true;
        const errEl = document.getElementById('ne-error');
        if (errEl) {
            errEl.classList.add('d-none');
        }

        if (!repeatCheck.checked) {
            // --- Single event ---
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Creating\u2026';
            try {
                const startTime = new Date(startLocal).toISOString();
                const endTime = endLocal ? new Date(endLocal).toISOString() : undefined;
                await createOneEvent(name, startTime, endTime, description, selectedFormat, nextRound);
                bsModal.hide();
                await onSave();
            } catch (err) {
                document.getElementById('api-error-toast')?.remove();
                btn.disabled = false;
                btn.textContent = 'Create';
                const msg = err instanceof Error ? err.message : 'Something went wrong';
                if (errEl) {
                    errEl.textContent = `Failed to create event: ${msg}`;
                    errEl.classList.remove('d-none');
                }
            }
            return;
        }

        // --- Recurring events ---
        const dates = eventDates;
        const durationMs = endLocal && startLocal ?
            new Date(endLocal).getTime() - new Date(startLocal).getTime() :
            0;

        let created = 0;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Creating 0/${dates.length}\u2026`;

        try {
            for (let i = 0; i < dates.length; i++) {
                const d = dates[i];
                const startTime = d.toISOString();
                const endTime = durationMs > 0 ?
                    new Date(d.getTime() + durationMs).toISOString() :
                    undefined;
                const roundNum = nextRound + i;
                const eventName = resolveEventName(name, roundNum);

                await createOneEvent(eventName, startTime, endTime, description, selectedFormat, roundNum);
                created++;
                btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Creating ${created}/${dates.length}\u2026`;
            }
            bsModal.hide();
            await onSave();
        } catch (err) {
            document.getElementById('api-error-toast')?.remove();
            btn.disabled = false;
            btn.textContent = 'Create';
            const msg = err instanceof Error ? err.message : 'Something went wrong';
            if (errEl) {
                errEl.textContent = `Failed after creating ${created}/${dates.length} events: ${msg}`;
                errEl.classList.remove('d-none');
            }
        }
    });
}
