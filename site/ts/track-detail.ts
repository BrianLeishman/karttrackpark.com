import axios from 'axios';
import { Modal } from 'bootstrap';
import { parsePhoneNumberWithError } from 'libphonenumber-js';
import Sortable from 'sortablejs';
import { api } from './api';
import { getAccessToken } from './auth';
import { championshipDetailUrl } from './championship-detail';
import { championshipFormHtml, bindChampionshipForm } from './championship-form';
import type { ChampionshipFormBindings } from './championship-form';
import { uploadAsset } from './tracks';

interface TrackPublic {
    track_id: string;
    name: string;
    logo_key: string;
    email: string;
    phone: string;
    city?: string;
    state?: string;
    timezone?: string;
    website?: string;
    facebook?: string;
    instagram?: string;
    youtube?: string;
    tiktok?: string;
    created_at: string;
}

interface TrackAuth {
    role: string;
}

interface TrackEvent {
    event_id: string;
    track_id: string;
    track_name: string;
    name: string;
    description?: string;
    event_type?: string;
    start_time: string;
    end_time?: string;
    created_at: string;
}

interface EventsResponse {
    upcoming: TrackEvent[];
    recent: TrackEvent[];
}

interface Championship {
    championship_id: string;
    name: string;
    description?: string;
    logo_key?: string;
}

interface FormatSession {
    session_name: string;
    session_type: string;
    duration?: number;
    lap_count?: number;
    kart_class?: string;
    notes?: string;
}

interface Format {
    format_id: string;
    track_id: string;
    name: string;
    sessions: FormatSession[];
    created_at: string;
}

const apiBase = document.querySelector<HTMLMetaElement>('meta[name="api-base"]')?.content ??
    'https://62lt3y3apd.execute-api.us-east-1.amazonaws.com';

const assetsBase = document.querySelector<HTMLMetaElement>('meta[name="assets-base"]')?.content ??
    'https://assets.karttrackpark.com';

const dateFmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
});

function isHugoServer(): boolean {
    return document.querySelector<HTMLMetaElement>('meta[name="hugo-server"]')?.content === 'true';
}

function getTrackId(): string | null {
    if (isHugoServer()) {
        return new URLSearchParams(window.location.search).get('id');
    }
    const match = /^\/tracks\/([a-z0-9]+)/.exec(window.location.pathname);
    return match?.[1] ?? null;
}

export function slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function trackDetailUrl(trackId: string, trackName: string): string {
    if (isHugoServer()) {
        return `/tracks/?id=${trackId}`;
    }
    return `/tracks/${trackId}/${slugify(trackName)}`;
}

function ensureCorrectSlug(track: TrackPublic): boolean {
    if (isHugoServer()) {
        return false;
    }
    const expectedSlug = slugify(track.name);
    const pathParts = window.location.pathname.split('/');
    const currentSlug = pathParts[3] ?? '';
    if (currentSlug !== expectedSlug) {
        window.location.replace(`/tracks/${track.track_id}/${expectedSlug}`);
        return true;
    }
    return false;
}

function formatPhone(rfc3966: string): { href: string; display: string } {
    try {
        const num = rfc3966.replace(/^tel:/, '');
        const pn = parsePhoneNumberWithError(num);
        return { href: rfc3966, display: pn.formatNational() };
    } catch {
        const num = rfc3966.replace(/^tel:/, '');
        return { href: rfc3966, display: num };
    }
}

function formatDate(iso: string): string {
    return dateFmt.format(new Date(iso));
}

function typeBadge(eventType?: string): string {
    if (!eventType) {
        return '';
    }
    return `<span class="badge text-bg-secondary">${eventType}</span>`;
}

function eventCard(event: TrackEvent): string {
    return `
        <div class="col-md-6 col-lg-4">
            <div class="card h-100">
                <div class="card-body">
                    <h5 class="card-title">${event.name}</h5>
                    <p class="card-text text-body-secondary small mb-2">
                        <i class="fa-solid fa-clock me-1"></i>${formatDate(event.start_time)}${event.end_time ? ` \u2014 ${formatDate(event.end_time)}` : ''}
                    </p>
                    ${event.description ? `<p class="card-text small">${event.description}</p>` : ''}
                    <div class="d-flex gap-2 mt-2">${typeBadge(event.event_type)}</div>
                </div>
            </div>
        </div>`;
}

function socialLinks(track: TrackPublic): string {
    const links: { url: string; icon: string; label: string }[] = [];
    if (track.facebook) {
        links.push({ url: track.facebook, icon: 'fa-brands fa-facebook-f', label: 'Facebook' });
    }
    if (track.instagram) {
        links.push({ url: track.instagram, icon: 'fa-brands fa-instagram', label: 'Instagram' });
    }
    if (track.youtube) {
        links.push({ url: track.youtube, icon: 'fa-brands fa-youtube', label: 'YouTube' });
    }
    if (track.tiktok) {
        links.push({ url: track.tiktok, icon: 'fa-brands fa-tiktok', label: 'TikTok' });
    }
    if (links.length === 0) {
        return '';
    }
    return `<div class="d-flex gap-3 mt-3">${links.map(l =>
        `<a href="${l.url}" target="_blank" rel="noopener" class="text-body-secondary" title="${l.label}"><i class="${l.icon} fa-lg"></i></a>`,
    ).join('')}</div>`;
}

function emptyState(message: string): string {
    return `<div class="col-12"><p class="text-body-secondary text-center py-3">${message}</p></div>`;
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function renderTrackDetail(container: HTMLElement): Promise<void> {
    const trackId = getTrackId();
    if (!trackId) {
        container.innerHTML = '<div class="alert alert-warning">No track ID specified.</div>';
        return;
    }

    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';

    let track: TrackPublic;
    let events: EventsResponse;
    let championships: Championship[];
    let formats: Format[];
    let role: string | null;

    // Check membership in parallel (silently fails if not logged in or not a member)
    const token = getAccessToken();
    const membershipCheck: Promise<string | null> = token ?
        axios.get<TrackAuth>(`${apiBase}/api/tracks/${trackId}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        }).then(resp => resp.data.role, () => null) :
        Promise.resolve(null);

    try {
        const [trackResp, eventsResp, champsResp, formatsResp, memberResult] = await Promise.all([
            axios.get<TrackPublic>(`${apiBase}/api/tracks/${trackId}/public`),
            axios.get<EventsResponse>(`${apiBase}/api/events?track_id=${trackId}`),
            axios.get<Championship[]>(`${apiBase}/api/tracks/${trackId}/championships`).catch((): { data: Championship[] } => ({ data: [] })),
            axios.get<Format[]>(`${apiBase}/api/tracks/${trackId}/formats`).catch((): { data: Format[] } => ({ data: [] })),
            membershipCheck,
        ]);
        track = trackResp.data;
        events = eventsResp.data;
        championships = champsResp.data;
        formats = formatsResp.data;
        role = memberResult;
    } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
            container.innerHTML = '<div class="alert alert-warning">Track not found.</div>';
        } else {
            container.innerHTML = '<div class="alert alert-danger">Failed to load track.</div>';
        }
        return;
    }

    if (ensureCorrectSlug(track)) {
        return;
    }

    const isMember = Boolean(role);
    const canManage = role === 'owner' || role === 'admin';

    document.title = `${track.name} \u2014 Kart Track Park`;

    const location = [track.city, track.state].filter(Boolean).join(', ');
    const logoUrl = track.logo_key ? `${assetsBase}/${track.logo_key}` : '';
    const phone = track.phone ? formatPhone(track.phone) : null;

    const contactItems: string[] = [];
    if (track.email) {
        contactItems.push(`<a href="mailto:${track.email}" class="text-body-secondary text-decoration-none"><i class="fa-solid fa-envelope me-1"></i>${track.email}</a>`);
    }
    if (phone) {
        contactItems.push(`<a href="${phone.href}" class="text-body-secondary text-decoration-none"><i class="fa-solid fa-phone me-1"></i>${phone.display}</a>`);
    }
    if (track.website) {
        contactItems.push(`<a href="${track.website}" target="_blank" rel="noopener" class="text-body-secondary text-decoration-none"><i class="fa-solid fa-globe me-1"></i>${track.website}</a>`);
    }

    const upcomingCards = events.upcoming.length > 0 ?
        events.upcoming.map(eventCard).join('') :
        emptyState('No upcoming events.');

    const recentCards = events.recent.length > 0 ?
        events.recent.map(eventCard).join('') :
        emptyState('No recent events.');

    const showChampSection = championships.length > 0 || canManage;
    const champCards = championships.length > 0 ?
        championships.map(c => `
            <div class="col-md-6 col-lg-4">
                <a href="${championshipDetailUrl(c.championship_id, c.name)}" class="text-decoration-none">
                    <div class="card h-100">
                        <div class="card-body">
                            <div class="d-flex align-items-center gap-2 mb-1">
                                ${c.logo_key ?
                                    `<img src="${assetsBase}/${c.logo_key}" alt="" width="32" height="32" class="rounded flex-shrink-0" style="object-fit:cover">` :
                                    '<i class="fa-solid fa-trophy text-warning-emphasis" style="font-size:.9rem"></i>'
                                }
                                <h5 class="card-title mb-0">${esc(c.name)}</h5>
                            </div>
                            ${c.description ? `<p class="card-text text-body-secondary small mb-0">${esc(c.description)}</p>` : ''}
                        </div>
                    </div>
                </a>
            </div>`).join('') :
        emptyState('No championships yet.');

    container.innerHTML = `
        <div class="d-flex align-items-start gap-3 mb-4">
            ${logoUrl ?
                `<img src="${logoUrl}" alt="" width="96" height="96" class="rounded flex-shrink-0" style="object-fit:cover">` :
                '<div class="rounded bg-body-secondary flex-shrink-0 d-flex align-items-center justify-content-center" style="width:96px;height:96px"><i class="fa-solid fa-flag-checkered fa-2x text-body-secondary"></i></div>'
            }
            <div>
                <div class="d-flex align-items-center gap-2 mb-1">
                    <h1 class="mb-0">${track.name}</h1>
                    ${isMember ? `<a href="/my/tracks/edit/?id=${track.track_id}" class="btn btn-sm btn-outline-secondary"><i class="fa-solid fa-gear me-1"></i>Settings</a>` : ''}
                </div>
                ${location ? `<p class="text-body-secondary mb-1"><i class="fa-solid fa-location-dot me-1"></i>${location}</p>` : ''}
                ${contactItems.length > 0 ? `<div class="d-flex flex-wrap gap-3">${contactItems.join('')}</div>` : ''}
                ${socialLinks(track)}
            </div>
        </div>
        ${showChampSection ? `
        <div class="d-flex align-items-center mb-3">
            <h2 class="mb-0">Championships</h2>
            ${canManage ? '<button class="btn btn-sm btn-primary ms-auto" id="new-champ-btn"><i class="fa-solid fa-plus me-1"></i>New</button>' : ''}
        </div>
        <div class="row g-3 mb-5">${champCards}</div>
        ` : ''}
        ${canManage ? `
        <div class="d-flex align-items-center mb-3">
            <h2 class="mb-0">Formats</h2>
            <button class="btn btn-sm btn-primary ms-auto" id="new-format-btn"><i class="fa-solid fa-plus me-1"></i>New</button>
        </div>
        <div class="row g-3 mb-5" id="formats-list">
            ${formats.length > 0 ?
                formats.map(f => `
                    <div class="col-md-6 col-lg-4">
                        <div class="card h-100 format-card" data-format-id="${f.format_id}" role="button">
                            <div class="card-body">
                                <div class="d-flex align-items-center gap-2 mb-1">
                                    <i class="fa-solid fa-list-ol text-primary-emphasis" style="font-size:.9rem"></i>
                                    <h5 class="card-title mb-0">${esc(f.name)}</h5>
                                </div>
                                <p class="card-text text-body-secondary small mb-0">${f.sessions.length} session${f.sessions.length !== 1 ? 's' : ''}</p>
                            </div>
                        </div>
                    </div>`).join('') :
                emptyState('No formats yet.')}
        </div>
        ` : ''}
        <h2 class="mb-3">Upcoming Events</h2>
        <div class="row g-3 mb-5">${upcomingCards}</div>
        <h2 class="mb-3">Recent Events</h2>
        <div class="row g-3">${recentCards}</div>`;

    // New Championship modal handler
    document.getElementById('new-champ-btn')?.addEventListener('click', () => {
        showNewChampModal(trackId, async () => {
            await renderTrackDetail(container);
        });
    });

    // New Format button
    document.getElementById('new-format-btn')?.addEventListener('click', () => {
        showFormatModal(trackId, undefined, async () => {
            await renderTrackDetail(container);
        });
    });

    // Edit format on card click
    document.querySelectorAll('.format-card').forEach(card => {
        card.addEventListener('click', () => {
            if (!(card instanceof HTMLElement)) {
                return;
            }
            const formatId = card.dataset.formatId;
            if (!formatId) {
                return;
            }
            const format = formats.find(f => f.format_id === formatId);
            if (format) {
                showFormatModal(trackId, format, async () => {
                    await renderTrackDetail(container);
                });
            }
        });
    });
}

function showNewChampModal(trackId: string, onSave: () => Promise<void>): void {
    document.getElementById('modal-container')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="modal-container" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">New Championship</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <form id="champ-form">
                    <div class="modal-body">
                        ${championshipFormHtml({ prefix: 'new' })}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="submit" class="btn btn-primary" id="champ-submit">Create</button>
                    </div>
                    </form>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('modal-container');
    if (!modalEl) {
        return;
    }
    const bsModal = new Modal(modalEl);
    const bindings: ChampionshipFormBindings = bindChampionshipForm('new');
    bsModal.show();
    modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove(), { once: true });

    modalEl.addEventListener('shown.bs.modal', () => {
        const nameEl = document.getElementById('new-name');
        if (nameEl instanceof HTMLInputElement) {
            nameEl.focus();
        }
    }, { once: true });

    const champForm = document.getElementById('champ-form');
    if (!champForm) {
        return;
    }
    champForm.addEventListener('submit', async e => {
        e.preventDefault();

        const btn = document.getElementById('champ-submit');
        if (!(btn instanceof HTMLButtonElement)) {
            return;
        }
        const nameInput = document.getElementById('new-name');
        if (!(nameInput instanceof HTMLInputElement)) {
            return;
        }
        const name = nameInput.value.trim();
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Creating\u2026';

        try {
            const descEl = document.getElementById('new-desc');
            const body: Record<string, string> = {
                name,
                description: descEl instanceof HTMLTextAreaElement ? descEl.value.trim() : '',
            };

            const logo = bindings.croppedBlob ?? bindings.logoInput.files?.[0];
            if (logo) {
                body.logo_key = await uploadAsset(logo);
            }

            await api.post(`/api/tracks/${trackId}/championships`, body);
            bsModal.hide();
            await onSave();
        } catch {
            btn.disabled = false;
            btn.textContent = 'Create';
        }
    });
}

const SESSION_TYPES = ['practice', 'quali', 'heat', 'race', 'final', 'driver_meeting'];
const typeLabel = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

function sessionRowHtml(s: FormatSession, idx: number): string {
    const typeOptions = SESSION_TYPES.map(t =>
        `<option value="${t}" ${s.session_type === t ? 'selected' : ''}>${typeLabel(t)}</option>`,
    ).join('');

    return `
        <div class="format-session-row border rounded p-2 mb-2" data-idx="${idx}">
            <div class="d-flex align-items-center gap-2 mb-2">
                <span class="drag-handle text-body-secondary" style="cursor:grab" title="Drag to reorder"><i class="fa-solid fa-grip-vertical"></i></span>
                <input type="text" class="form-control form-control-sm sess-name" placeholder="Session name" value="${esc(s.session_name)}">
                <select class="form-select form-select-sm sess-type" style="max-width:130px">${typeOptions}</select>
                <input type="number" class="form-control form-control-sm sess-duration" placeholder="Min" min="1" style="max-width:80px" value="${s.duration ?? ''}" title="Duration (minutes)">
                <input type="number" class="form-control form-control-sm sess-laps" placeholder="Laps" min="1" style="max-width:80px" value="${s.lap_count ?? ''}" title="Lap count">
                <button type="button" class="btn btn-sm btn-outline-secondary toggle-notes" title="Notes"><i class="fa-solid fa-note-sticky"></i></button>
                <button type="button" class="btn btn-sm btn-outline-danger remove-session" title="Remove"><i class="fa-solid fa-trash"></i></button>
            </div>
            <div class="sess-notes-wrap" style="${s.notes ? '' : 'display:none'}">
                <input type="text" class="form-control form-control-sm sess-notes" placeholder="Notes (optional)" value="${esc(s.notes ?? '')}">
            </div>
        </div>`;
}

function collectSessions(container: HTMLElement): FormatSession[] {
    const rows = container.querySelectorAll('.format-session-row');
    const sessions: FormatSession[] = [];
    rows.forEach(row => {
        const nameEl = row.querySelector('.sess-name');
        const typeEl = row.querySelector('.sess-type');
        const durationEl = row.querySelector('.sess-duration');
        const lapsEl = row.querySelector('.sess-laps');
        const notesEl = row.querySelector('.sess-notes');
        const name = nameEl instanceof HTMLInputElement ? nameEl.value.trim() : '';
        const type = typeEl instanceof HTMLSelectElement ? typeEl.value : 'heat';
        const duration = parseInt(durationEl instanceof HTMLInputElement ? durationEl.value : '', 10) || 0;
        const lapCount = parseInt(lapsEl instanceof HTMLInputElement ? lapsEl.value : '', 10) || 0;
        const notes = notesEl instanceof HTMLInputElement ? notesEl.value.trim() : '';
        const s: FormatSession = { session_name: name, session_type: type };
        if (duration > 0) {
            s.duration = duration;
        }
        if (lapCount > 0) {
            s.lap_count = lapCount;
        }
        if (notes) {
            s.notes = notes;
        }
        sessions.push(s);
    });
    return sessions;
}

function bindSessionListEvents(listEl: HTMLElement): void {
    // Click handlers for remove and toggle-notes
    listEl.addEventListener('click', e => {
        if (!(e.target instanceof HTMLElement)) {
            return;
        }
        const target = e.target.closest('button');
        if (!target) {
            return;
        }
        const row = target.closest('.format-session-row');
        if (!(row instanceof HTMLElement)) {
            return;
        }

        if (target.classList.contains('remove-session')) {
            row.remove();
        } else if (target.classList.contains('toggle-notes')) {
            const wrap = row.querySelector('.sess-notes-wrap');
            if (wrap instanceof HTMLElement) {
                wrap.style.display = wrap.style.display === 'none' ? '' : 'none';
            }
        }
    });

    // Auto-fill session name when type changes and name is empty or matches a type label
    const typeLabels = new Set(SESSION_TYPES.map(typeLabel));
    listEl.addEventListener('change', e => {
        if (!(e.target instanceof HTMLElement)) {
            return;
        }
        if (!e.target.classList.contains('sess-type')) {
            return;
        }
        const row = e.target.closest('.format-session-row');
        if (!(row instanceof HTMLElement)) {
            return;
        }
        const nameInput = row.querySelector('.sess-name');
        if (!(nameInput instanceof HTMLInputElement)) {
            return;
        }
        const current = nameInput.value.trim();
        if (!current || typeLabels.has(current)) {
            if (e.target instanceof HTMLSelectElement) {
                nameInput.value = typeLabel(e.target.value);
            }
        }
    });

    // Drag-and-drop reordering via SortableJS
    Sortable.create(listEl, {
        handle: '.drag-handle',
        animation: 150,
        ghostClass: 'drag-over',
    });
}

function showFormatModal(trackId: string, format: Format | undefined, onSave: () => Promise<void>): void {
    const isEdit = Boolean(format);
    const title = isEdit ? 'Edit Format' : 'New Format';
    const submitLabel = isEdit ? 'Save' : 'Create';
    const sessions = format?.sessions ?? [];

    document.getElementById('format-modal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="format-modal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">${title}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <form id="format-form">
                    <div class="modal-body">
                        <div class="mb-3">
                            <label class="form-label" for="format-name">Name</label>
                            <input type="text" class="form-control" id="format-name" value="${esc(format?.name ?? '')}" required>
                        </div>
                        <label class="form-label">Sessions</label>
                        <div id="format-session-list">
                            ${sessions.map((s, i) => sessionRowHtml(s, i)).join('')}
                        </div>
                        <button type="button" class="btn btn-sm btn-outline-primary" id="add-session-btn"><i class="fa-solid fa-plus me-1"></i>Add Session</button>
                        <div class="alert alert-danger mt-3 mb-0 d-none" id="format-error"></div>
                    </div>
                    <div class="modal-footer">
                        ${isEdit ? '<button type="button" class="btn btn-outline-danger me-auto" id="format-delete-btn"><i class="fa-solid fa-trash me-1"></i>Delete</button>' : ''}
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="submit" class="btn btn-primary" id="format-submit">${submitLabel}</button>
                    </div>
                    </form>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('format-modal');
    if (!modalEl) {
        return;
    }
    const bsModal = new Modal(modalEl);
    const listEl = document.getElementById('format-session-list');
    if (!listEl) {
        return;
    }

    bindSessionListEvents(listEl);

    bsModal.show();
    modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove(), { once: true });

    modalEl.addEventListener('shown.bs.modal', () => {
        const nameEl = document.getElementById('format-name');
        if (nameEl instanceof HTMLInputElement) {
            nameEl.focus();
        }
    }, { once: true });

    // Add session
    const addSessionBtn = document.getElementById('add-session-btn');
    if (addSessionBtn) {
        addSessionBtn.addEventListener('click', () => {
            const idx = listEl.querySelectorAll('.format-session-row').length;
            listEl.insertAdjacentHTML('beforeend', sessionRowHtml({
                session_name: typeLabel('heat'), session_type: 'heat',
            }, idx));
        });
    }

    // Submit
    const formatForm = document.getElementById('format-form');
    if (!formatForm) {
        return;
    }
    formatForm.addEventListener('submit', async e => {
        e.preventDefault();

        const nameInput = document.getElementById('format-name');
        if (!(nameInput instanceof HTMLInputElement)) {
            return;
        }
        const name = nameInput.value.trim();
        const sess = collectSessions(listEl);

        const btn = document.getElementById('format-submit');
        if (!(btn instanceof HTMLButtonElement)) {
            return;
        }
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>${isEdit ? 'Saving' : 'Creating'}\u2026`;

        try {
            if (isEdit && format) {
                await api.put(`/api/formats/${format.format_id}`, { name, sessions: sess });
            } else {
                await api.post(`/api/tracks/${trackId}/formats`, { name, sessions: sess });
            }
            bsModal.hide();
            await onSave();
        } catch (err) {
            btn.disabled = false;
            btn.textContent = submitLabel;
            const errEl = document.getElementById('format-error');
            if (errEl) {
                const msg = err instanceof Error ? err.message : 'Something went wrong';
                errEl.textContent = `Failed to save format: ${msg}`;
                errEl.classList.remove('d-none');
            }
        }
    });

    // Delete
    document.getElementById('format-delete-btn')?.addEventListener('click', async () => {
        if (!format) {
            return;
        }
        if (!confirm(`Delete "${format.name}"? This cannot be undone.`)) {
            return;
        }
        try {
            await api.delete(`/api/formats/${format.format_id}`);
            bsModal.hide();
            await onSave();
        } catch { /* api interceptor shows toast */ }
    });
}
