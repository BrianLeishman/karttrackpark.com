import axios from 'axios';
import { Modal } from 'bootstrap';
import { parsePhoneNumberWithError } from 'libphonenumber-js';
import Sortable from 'sortablejs';
import { api, apiBase, assetsBase } from './api';
import { getAccessToken } from './auth';
import { getEntityId, ensureCorrectSlug, trackDetailUrl, championshipDetailUrl, seriesDetailUrl, eventDetailUrl } from './url-utils';
import { championshipFormHtml, bindChampionshipForm } from './championship-form';
import type { ChampionshipFormBindings } from './championship-form';
import { outlineMapHtml, bindOutlineMap } from './track-form';
import type { TrackAnnotation } from './track-form';
import { esc, emptyState, formatDate, typeBadge, typeLabel, SESSION_TYPES, START_TYPES, startTypeLabel } from './html';
import { uploadAsset } from './tracks';

interface TrackPublic {
    track_id: string;
    name: string;
    logo_key: string;
    map_bounds?: string;
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

interface SeriesContext {
    series_id: string;
    series_name: string;
    championship_id: string;
    championship_name: string;
    round_number: number;
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
    series?: SeriesContext[];
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

export interface Layout {
    layout_id: string;
    track_id: string;
    name: string;
    is_default?: boolean;
    track_outline?: string;
    annotations?: TrackAnnotation[];
    created_at: string;
}

export interface KartClass {
    class_id: string;
    track_id: string;
    name: string;
    chassis?: string;
    engine?: string;
    description?: string;
    is_default?: boolean;
    created_at: string;
}

export interface FormatSession {
    session_name: string;
    session_type: string;
    duration?: number;
    lap_count?: number;
    lap_limit?: number;
    start_type?: string;
    class_ids?: string[];
    notes?: string;
    layout_id?: string;
    reverse?: boolean;
}

export interface Format {
    format_id: string;
    track_id: string;
    name: string;
    sessions: FormatSession[];
    created_at: string;
}

export { slugify, isHugoServer, trackDetailUrl } from './url-utils';

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

function seriesBadges(event: TrackEvent): string {
    if (!event.series?.length) {
        return '';
    }
    return event.series.map(s =>
        `<a href="${championshipDetailUrl(s.championship_id, s.championship_name)}" class="badge text-bg-warning text-decoration-none me-1" title="${esc(s.championship_name)}">${esc(s.championship_name)}</a>` +
        `<a href="${seriesDetailUrl(s.series_id, s.series_name)}" class="badge text-bg-info text-decoration-none me-1" title="${esc(s.series_name)}">R${s.round_number} ${esc(s.series_name)}</a>`,
    ).join('');
}

function eventRow(event: TrackEvent): string {
    return `
        <div class="d-flex align-items-center gap-2 py-2 border-bottom">
            <div class="flex-grow-1">
                <a href="${eventDetailUrl(event.event_id, event.name, event.series?.[0])}" class="fw-semibold">${esc(event.name)}</a>
                <div class="d-flex flex-wrap gap-1 mt-1">
                    ${typeBadge(event.event_type)}
                    ${seriesBadges(event)}
                </div>
            </div>
            <span class="text-body-secondary small text-nowrap">${formatDate(event.start_time)}</span>
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

function bindShowMore(containerId: string, buttonId: string, allItems: string[], pageSize: number): void {
    let shown = pageSize;
    document.getElementById(buttonId)?.addEventListener('click', () => {
        const el = document.getElementById(containerId);
        if (!el) {
            return;
        }
        const next = allItems.slice(shown, shown + pageSize);
        el.insertAdjacentHTML('beforeend', next.join(''));
        shown += next.length;
        if (shown >= allItems.length) {
            document.getElementById(buttonId)?.remove();
        }
    });
}

interface TrackListItem {
    track_id: string;
    name: string;
    logo_key?: string;
    city?: string;
    state?: string;
}

async function renderTrackList(container: HTMLElement): Promise<void> {
    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';

    try {
        const { data: tracks } = await axios.get<TrackListItem[]>(`${apiBase}/api/tracks/public`);

        if (tracks.length === 0) {
            container.innerHTML = emptyState('No tracks yet.');
            return;
        }

        container.innerHTML = `
            <h4 class="mb-3">Tracks</h4>
            <div class="list-group">
                ${tracks.map(t => {
        const location = [t.city, t.state].filter(Boolean).join(', ');
        const logo = t.logo_key ?
            `<img src="${assetsBase}/${t.logo_key}" alt="" width="40" height="40" class="rounded flex-shrink-0" style="object-fit:cover">` :
            '<div class="rounded bg-body-secondary flex-shrink-0 d-flex align-items-center justify-content-center" style="width:40px;height:40px"><i class="fa-solid fa-flag-checkered"></i></div>';
        return `
                    <a href="${trackDetailUrl(t.track_id, t.name)}" class="list-group-item list-group-item-action d-flex align-items-center gap-3" data-track-hover="${t.track_id}">
                        ${logo}
                        <div>
                            <div class="fw-semibold">${esc(t.name)}</div>
                            ${location ? `<div class="text-body-secondary small">${esc(location)}</div>` : ''}
                        </div>
                    </a>`;
    }).join('')}
            </div>
        `;
    } catch {
        container.innerHTML = '<div class="alert alert-danger">Failed to load tracks.</div>';
    }
}

export async function renderTrackDetail(container: HTMLElement): Promise<void> {
    const trackId = getEntityId('tracks');
    if (!trackId) {
        void renderTrackList(container);
        return;
    }

    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';

    let track: TrackPublic;
    let events: EventsResponse;
    let championships: Championship[];
    let role: string | null;

    // Check membership in parallel (silently fails if not logged in or not a member)
    const token = getAccessToken();
    const membershipCheck: Promise<string | null> = token ?
        axios.get<TrackAuth>(`${apiBase}/api/tracks/${trackId}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        }).then(resp => resp.data.role, () => null) :
        Promise.resolve(null);

    try {
        const [trackResp, eventsResp, champsResp, memberResult] = await Promise.all([
            axios.get<TrackPublic>(`${apiBase}/api/tracks/${trackId}/public`),
            axios.get<EventsResponse>(`${apiBase}/api/events?track_id=${trackId}`),
            axios.get<Championship[]>(`${apiBase}/api/tracks/${trackId}/championships`).catch((): { data: Championship[] } => ({ data: [] })),
            membershipCheck,
        ]);
        track = trackResp.data;
        events = eventsResp.data;
        championships = champsResp.data;
        role = memberResult;
    } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
            container.innerHTML = '<div class="alert alert-warning">Track not found.</div>';
        } else {
            container.innerHTML = '<div class="alert alert-danger">Failed to load track.</div>';
        }
        return;
    }

    if (ensureCorrectSlug('tracks', track.track_id, track.name)) {
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
        contactItems.push(`<a href="mailto:${track.email}" class="text-body-secondary"><i class="fa-solid fa-envelope me-1"></i>${track.email}</a>`);
    }
    if (phone) {
        contactItems.push(`<a href="${phone.href}" class="text-body-secondary"><i class="fa-solid fa-phone me-1"></i>${phone.display}</a>`);
    }
    if (track.website) {
        contactItems.push(`<a href="${track.website}" target="_blank" rel="noopener" class="text-body-secondary"><i class="fa-solid fa-globe me-1"></i>${track.website}</a>`);
    }

    const PAGE_SIZE = 5;

    const recentAll = events.recent.map(eventRow);
    const upcomingAll = events.upcoming.map(eventRow);

    const recentInitial = recentAll.slice(0, PAGE_SIZE).join('') ||
        '<p class="text-body-secondary text-center py-3">No recent events.</p>';
    const upcomingInitial = upcomingAll.slice(0, PAGE_SIZE).join('') ||
        '<p class="text-body-secondary text-center py-3">No upcoming events.</p>';

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
        <ul class="nav nav-tabs mb-3" role="tablist">
            <li class="nav-item" role="presentation">
                <button class="nav-link active" id="events-tab" data-bs-toggle="tab" data-bs-target="#events-pane" type="button" role="tab">Events</button>
            </li>
            <li class="nav-item" role="presentation">
                <button class="nav-link" id="champs-tab" data-bs-toggle="tab" data-bs-target="#champs-pane" type="button" role="tab">Championships</button>
            </li>
        </ul>
        <div class="tab-content">
            <div class="tab-pane fade show active" id="events-pane" role="tabpanel">
                <h3 class="mb-2">Upcoming</h3>
                <div id="upcoming-events">${upcomingInitial}</div>
                ${upcomingAll.length > PAGE_SIZE ? '<button class="btn btn-sm btn-outline-secondary mt-2" id="show-more-upcoming">Show more</button>' : ''}
                <h3 class="mb-2 mt-4">Recent</h3>
                <div id="recent-events">${recentInitial}</div>
                ${recentAll.length > PAGE_SIZE ? '<button class="btn btn-sm btn-outline-secondary mt-2" id="show-more-recent">Show more</button>' : ''}
            </div>
            <div class="tab-pane fade" id="champs-pane" role="tabpanel">
                <div class="d-flex align-items-center mb-3">
                    ${canManage ? '<button class="btn btn-sm btn-primary ms-auto" id="new-champ-btn"><i class="fa-solid fa-plus me-1"></i>New Championship</button>' : ''}
                </div>
                <div class="row g-3">${champCards}</div>
            </div>
        </div>`;

    // Show more buttons
    bindShowMore('recent-events', 'show-more-recent', recentAll, PAGE_SIZE);
    bindShowMore('upcoming-events', 'show-more-upcoming', upcomingAll, PAGE_SIZE);

    // New Championship modal handler
    document.getElementById('new-champ-btn')?.addEventListener('click', () => {
        showNewChampModal(trackId, async () => {
            await renderTrackDetail(container);
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

export function showLayoutModal(trackId: string, trackMapBounds: string | undefined, allLayouts: Layout[], layout: Layout | undefined, onSave: () => Promise<void>, duplicate = false, trackTurns?: TrackAnnotation[]): void {
    const isEdit = Boolean(layout) && !duplicate;
    let title = 'New Layout';
    if (duplicate) {
        title = 'Duplicate Layout';
    } else if (isEdit) {
        title = 'Edit Layout';
    }
    const submitLabel = isEdit ? 'Save' : 'Create';
    const currentDefault = allLayouts.find(l => l.is_default && l.layout_id !== layout?.layout_id);
    const shouldDefault = !duplicate && (layout?.is_default || !currentDefault);

    document.getElementById('layout-modal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="layout-modal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">${title}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <form id="layout-form">
                    <div class="modal-body">
                        <div class="mb-3">
                            <label class="form-label" for="layout-name">Name</label>
                            <input type="text" class="form-control" id="layout-name" value="${esc(duplicate && layout ? `${layout.name} (Copy)` : layout?.name ?? '')}" required>
                        </div>
                        <div class="form-check mb-3">
                            <input type="checkbox" class="form-check-input" id="layout-default" ${shouldDefault ? 'checked' : ''}>
                            <label class="form-check-label" for="layout-default">Default Layout</label>
                            <div class="form-text">The default layout is shown in hover card previews.</div>
                            ${currentDefault ? `<div class="text-warning small mt-1 d-none" id="layout-default-warn"><i class="fa-solid fa-triangle-exclamation me-1"></i>This will replace \u201c${esc(currentDefault.name)}\u201d as the default layout.</div>` : ''}
                        </div>
                        <label class="form-label">Track Outline</label>
                        ${outlineMapHtml('layout')}
                        <div class="alert alert-danger mt-3 mb-0 d-none" id="layout-error"></div>
                    </div>
                    <div class="modal-footer">
                        ${isEdit ? '<button type="button" class="btn btn-outline-danger me-auto" id="layout-delete-btn"><i class="fa-solid fa-trash me-1"></i>Delete</button>' : ''}
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="submit" class="btn btn-primary" id="layout-submit">${submitLabel}</button>
                    </div>
                    </form>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('layout-modal');
    if (!modalEl) {
        return;
    }
    const bsModal = new Modal(modalEl);

    // Bind map after DOM is ready (returns null if no track bounds)
    const mapBindings = bindOutlineMap('layout', {
        track_outline: layout?.track_outline,
        map_bounds: trackMapBounds,
        annotations: layout?.annotations,
        turns: trackTurns,
    });

    // Show/hide default warning
    const layoutDefaultCheck = document.getElementById('layout-default');
    const layoutDefaultWarn = document.getElementById('layout-default-warn');
    if (layoutDefaultCheck instanceof HTMLInputElement && layoutDefaultWarn) {
        const updateWarn = () => {
            layoutDefaultWarn.classList.toggle('d-none', !layoutDefaultCheck.checked); 
        };
        updateWarn();
        layoutDefaultCheck.addEventListener('change', updateWarn);
    }

    bsModal.show();
    modalEl.addEventListener('hidden.bs.modal', () => {
        mapBindings?.destroy();
        modalEl.remove();
    }, { once: true });

    // Invalidate map size after modal animation completes
    modalEl.addEventListener('shown.bs.modal', () => {
        mapBindings?.invalidateSize();
        const nameEl = document.getElementById('layout-name');
        if (nameEl instanceof HTMLInputElement) {
            nameEl.focus();
        }
    }, { once: true });

    // Submit
    const layoutForm = document.getElementById('layout-form');
    if (!layoutForm) {
        return;
    }
    layoutForm.addEventListener('submit', async e => {
        e.preventDefault();

        const nameInput = document.getElementById('layout-name');
        if (!(nameInput instanceof HTMLInputElement)) {
            return;
        }
        const name = nameInput.value.trim();
        const defaultCheck = document.getElementById('layout-default');
        const isDefault = defaultCheck instanceof HTMLInputElement ? defaultCheck.checked : false;

        const btn = document.getElementById('layout-submit');
        if (!(btn instanceof HTMLButtonElement)) {
            return;
        }
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>${isEdit ? 'Saving' : 'Creating'}\u2026`;

        // Build outline GeoJSON
        let trackOutline = '';
        if (mapBindings && mapBindings.outlinePoints.length >= 2) {
            const coords = mapBindings.outlinePoints.map(([lat, lng]) => [lng, lat]);
            const first = coords[0];
            const last = coords[coords.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
                coords.push([...first]);
            }
            trackOutline = JSON.stringify({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coords },
            });
        }
        try {
            if (isEdit && layout) {
                await api.put(`/api/tracks/${trackId}/layouts/${layout.layout_id}`, {
                    name,
                    isDefault: isDefault,
                    trackOutline,
                    annotations: mapBindings?.annotations ?? [],
                });
            } else {
                await api.post(`/api/tracks/${trackId}/layouts`, {
                    name,
                    is_default: isDefault,
                    track_outline: trackOutline,
                    annotations: mapBindings?.annotations ?? [],
                });
            }
            bsModal.hide();
            await onSave();
        } catch (err) {
            btn.disabled = false;
            btn.textContent = submitLabel;
            const errEl = document.getElementById('layout-error');
            if (errEl) {
                const msg = err instanceof Error ? err.message : 'Something went wrong';
                errEl.textContent = `Failed to save layout: ${msg}`;
                errEl.classList.remove('d-none');
            }
        }
    });

    // Delete
    document.getElementById('layout-delete-btn')?.addEventListener('click', async () => {
        if (!layout) {
            return;
        }
        if (!confirm(`Delete "${layout.name}"? This cannot be undone.`)) {
            return;
        }
        try {
            await api.delete(`/api/tracks/${trackId}/layouts/${layout.layout_id}`);
            bsModal.hide();
            await onSave();
        } catch { /* api interceptor shows toast */ }
    });
}

export function showClassModal(trackId: string, allClasses: KartClass[], kc: KartClass | undefined, onSave: () => Promise<void>): void {
    const isEdit = Boolean(kc);
    const title = isEdit ? 'Edit Class' : 'New Class';
    const submitLabel = isEdit ? 'Save' : 'Create';
    const currentDefault = allClasses.find(c => c.is_default && c.class_id !== kc?.class_id);
    const shouldDefault = kc?.is_default || !currentDefault;

    document.getElementById('class-modal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="class-modal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">${title}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <form id="class-form">
                    <div class="modal-body">
                        <div class="mb-3">
                            <label class="form-label" for="class-name">Name <span class="text-danger">*</span></label>
                            <input type="text" class="form-control" id="class-name" value="${esc(kc?.name ?? '')}" required>
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="class-chassis">Chassis</label>
                            <input type="text" class="form-control" id="class-chassis" value="${esc(kc?.chassis ?? '')}" placeholder="e.g. Sodi RT8 EVO">
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="class-engine">Engine</label>
                            <input type="text" class="form-control" id="class-engine" value="${esc(kc?.engine ?? '')}" placeholder="e.g. Honda GX390">
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="class-desc">Description</label>
                            <textarea class="form-control" id="class-desc" rows="2" placeholder="Any additional details about this class">${esc(kc?.description ?? '')}</textarea>
                        </div>
                        <div class="form-check mb-3">
                            <input type="checkbox" class="form-check-input" id="class-default" ${shouldDefault ? 'checked' : ''}>
                            <label class="form-check-label" for="class-default">Default Class</label>
                            <div class="form-text">The default class is pre-checked when adding sessions to formats.</div>
                            ${currentDefault ? `<div class="text-warning small mt-1 d-none" id="class-default-warn"><i class="fa-solid fa-triangle-exclamation me-1"></i>This will replace \u201c${esc(currentDefault.name)}\u201d as the default class.</div>` : ''}
                        </div>
                        <div class="alert alert-danger mt-3 mb-0 d-none" id="class-error"></div>
                    </div>
                    <div class="modal-footer">
                        ${isEdit ? '<button type="button" class="btn btn-outline-danger me-auto" id="class-delete-btn"><i class="fa-solid fa-trash me-1"></i>Delete</button>' : ''}
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="submit" class="btn btn-primary" id="class-submit">${submitLabel}</button>
                    </div>
                    </form>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('class-modal');
    if (!modalEl) {
        return;
    }

    // Show/hide default warning
    const classDefaultCheck = document.getElementById('class-default');
    const classDefaultWarn = document.getElementById('class-default-warn');
    if (classDefaultCheck instanceof HTMLInputElement && classDefaultWarn) {
        const updateWarn = () => {
            classDefaultWarn.classList.toggle('d-none', !classDefaultCheck.checked); 
        };
        updateWarn();
        classDefaultCheck.addEventListener('change', updateWarn);
    }

    const bsModal = new Modal(modalEl);
    bsModal.show();
    modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove(), { once: true });

    modalEl.addEventListener('shown.bs.modal', () => {
        const nameEl = document.getElementById('class-name');
        if (nameEl instanceof HTMLInputElement) {
            nameEl.focus();
        }
    }, { once: true });

    const classForm = document.getElementById('class-form');
    if (!classForm) {
        return;
    }
    classForm.addEventListener('submit', async e => {
        e.preventDefault();

        const nameInput = document.getElementById('class-name');
        if (!(nameInput instanceof HTMLInputElement)) {
            return;
        }
        const name = nameInput.value.trim();
        const chassisEl = document.getElementById('class-chassis');
        const chassis = chassisEl instanceof HTMLInputElement ? chassisEl.value.trim() : '';
        const engineEl = document.getElementById('class-engine');
        const engine = engineEl instanceof HTMLInputElement ? engineEl.value.trim() : '';
        const descEl = document.getElementById('class-desc');
        const description = descEl instanceof HTMLTextAreaElement ? descEl.value.trim() : '';
        const defaultCheck = document.getElementById('class-default');
        const isDefault = defaultCheck instanceof HTMLInputElement ? defaultCheck.checked : false;

        const btn = document.getElementById('class-submit');
        if (!(btn instanceof HTMLButtonElement)) {
            return;
        }
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>${isEdit ? 'Saving' : 'Creating'}\u2026`;

        try {
            if (isEdit && kc) {
                await api.put(`/api/tracks/${trackId}/classes/${kc.class_id}`, {
                    name,
                    chassis,
                    engine,
                    description,
                    isDefault: isDefault,
                });
            } else {
                await api.post(`/api/tracks/${trackId}/classes`, {
                    name,
                    chassis,
                    engine,
                    description,
                    is_default: isDefault,
                });
            }
            bsModal.hide();
            await onSave();
        } catch (err) {
            btn.disabled = false;
            btn.textContent = submitLabel;
            const errEl = document.getElementById('class-error');
            if (errEl) {
                const msg = err instanceof Error ? err.message : 'Something went wrong';
                errEl.textContent = `Failed to save class: ${msg}`;
                errEl.classList.remove('d-none');
            }
        }
    });

    // Delete
    document.getElementById('class-delete-btn')?.addEventListener('click', async () => {
        if (!kc) {
            return;
        }
        if (!confirm(`Delete "${kc.name}"? This cannot be undone.`)) {
            return;
        }
        try {
            await api.delete(`/api/tracks/${trackId}/classes/${kc.class_id}`);
            bsModal.hide();
            await onSave();
        } catch { /* api interceptor shows toast */ }
    });
}

function sessionRowHtml(s: FormatSession, idx: number, layouts: Layout[], classes: KartClass[]): string {
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
        const cbId = `sess-${idx}-class-${kc.class_id}`;
        return `<div class="form-check form-check-inline mb-0">
            <input type="checkbox" class="form-check-input sess-class" id="${cbId}" data-class-id="${kc.class_id}" ${checked ? 'checked' : ''}>
            <label class="form-check-label small" for="${cbId}">${esc(kc.name)}</label>
        </div>`;
    }).join('');

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
            <div class="d-flex align-items-center gap-2 mb-2">
                <select class="form-select form-select-sm sess-layout" style="max-width:200px" title="Layout" required>
                    ${layoutOptions}
                </select>
                <div class="form-check form-check-inline mb-0">
                    <input type="checkbox" class="form-check-input sess-reverse" ${s.reverse ? 'checked' : ''}>
                    <label class="form-check-label small">Reverse</label>
                </div>
                <select class="form-select form-select-sm sess-start-type" style="max-width:140px" title="Start type">
                    <option value="">Start type\u2026</option>
                    ${startTypeOptions}
                </select>
                <input type="number" class="form-control form-control-sm sess-lap-limit" placeholder="Lap limit" min="1" style="max-width:100px" value="${s.lap_limit ?? ''}" title="Max laps to count">
            </div>
            ${classes.length > 0 ? `<div class="d-flex align-items-center gap-1 mb-2">
                <span class="text-body-secondary small me-1">Classes:</span>
                ${classCheckboxes}
            </div>` : ''}
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
        const layoutEl = row.querySelector('.sess-layout');
        const reverseEl = row.querySelector('.sess-reverse');
        const startTypeEl = row.querySelector('.sess-start-type');
        const lapLimitEl = row.querySelector('.sess-lap-limit');
        const name = nameEl instanceof HTMLInputElement ? nameEl.value.trim() : '';
        const type = typeEl instanceof HTMLSelectElement ? typeEl.value : 'heat';
        const duration = parseInt(durationEl instanceof HTMLInputElement ? durationEl.value : '', 10) || 0;
        const lapCount = parseInt(lapsEl instanceof HTMLInputElement ? lapsEl.value : '', 10) || 0;
        const notes = notesEl instanceof HTMLInputElement ? notesEl.value.trim() : '';
        const layoutId = layoutEl instanceof HTMLSelectElement ? layoutEl.value : '';
        const reverse = reverseEl instanceof HTMLInputElement ? reverseEl.checked : false;
        const startType = startTypeEl instanceof HTMLSelectElement ? startTypeEl.value : '';
        const lapLimit = parseInt(lapLimitEl instanceof HTMLInputElement ? lapLimitEl.value : '', 10) || 0;
        const classIds: string[] = [];
        row.querySelectorAll('.sess-class').forEach(cb => {
            if (cb instanceof HTMLInputElement && cb.checked && cb.dataset.classId) {
                classIds.push(cb.dataset.classId);
            }
        });
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
        if (layoutId) {
            s.layout_id = layoutId;
        }
        if (reverse) {
            s.reverse = true;
        }
        if (startType) {
            s.start_type = startType;
        }
        if (lapLimit > 0) {
            s.lap_limit = lapLimit;
        }
        if (classIds.length > 0) {
            s.class_ids = classIds;
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

export function showFormatModal(trackId: string, layouts: Layout[], classes: KartClass[], format: Format | undefined, onSave: () => Promise<void>): void {
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
                            ${sessions.map((s, i) => sessionRowHtml(s, i, layouts, classes)).join('')}
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
            }, idx, layouts, classes));
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
