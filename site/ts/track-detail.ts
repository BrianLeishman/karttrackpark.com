import axios from 'axios';
import { Modal } from 'bootstrap';
import { parsePhoneNumberWithError } from 'libphonenumber-js';
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

const apiBase = document.querySelector<HTMLMetaElement>('meta[name="api-base"]')?.content
    ?? 'https://62lt3y3apd.execute-api.us-east-1.amazonaws.com';

const assetsBase = document.querySelector<HTMLMetaElement>('meta[name="assets-base"]')?.content
    ?? 'https://assets.karttrackpark.com';

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
    let championships: Championship[] = [];
    let role: string | null = null;

    // Check membership in parallel (silently fails if not logged in or not a member)
    const token = getAccessToken();
    const membershipCheck = token
        ? axios.get<TrackAuth>(`${apiBase}/api/tracks/${trackId}`, {
            headers: { Authorization: `Bearer ${token}` },
        }).then(resp => resp.data.role, () => null as string | null)
        : Promise.resolve(null as string | null);

    try {
        const [trackResp, eventsResp, champsResp, memberResult] = await Promise.all([
            axios.get<TrackPublic>(`${apiBase}/api/tracks/${trackId}/public`),
            axios.get<EventsResponse>(`${apiBase}/api/events?track_id=${trackId}`),
            axios.get<Championship[]>(`${apiBase}/api/tracks/${trackId}/championships`).catch(() => ({ data: [] as Championship[] })),
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

    if (ensureCorrectSlug(track)) {
        return;
    }

    const isMember = !!role;
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

    const upcomingCards = events.upcoming.length > 0
        ? events.upcoming.map(eventCard).join('')
        : emptyState('No upcoming events.');

    const recentCards = events.recent.length > 0
        ? events.recent.map(eventCard).join('')
        : emptyState('No recent events.');

    const showChampSection = championships.length > 0 || canManage;
    const champCards = championships.length > 0
        ? championships.map(c => `
            <div class="col-md-6 col-lg-4">
                <a href="${championshipDetailUrl(c.championship_id, c.name)}" class="text-decoration-none">
                    <div class="card h-100">
                        <div class="card-body">
                            <div class="d-flex align-items-center gap-2 mb-1">
                                ${c.logo_key
                                    ? `<img src="${assetsBase}/${c.logo_key}" alt="" width="32" height="32" class="rounded flex-shrink-0" style="object-fit:cover">`
                                    : '<i class="fa-solid fa-trophy text-warning-emphasis" style="font-size:.9rem"></i>'
                                }
                                <h5 class="card-title mb-0">${esc(c.name)}</h5>
                            </div>
                            ${c.description ? `<p class="card-text text-body-secondary small mb-0">${esc(c.description)}</p>` : ''}
                        </div>
                    </div>
                </a>
            </div>`).join('')
        : emptyState('No championships yet.');

    container.innerHTML = `
        <div class="d-flex align-items-start gap-3 mb-4">
            ${logoUrl
                ? `<img src="${logoUrl}" alt="" width="96" height="96" class="rounded flex-shrink-0" style="object-fit:cover">`
                : '<div class="rounded bg-body-secondary flex-shrink-0 d-flex align-items-center justify-content-center" style="width:96px;height:96px"><i class="fa-solid fa-flag-checkered fa-2x text-body-secondary"></i></div>'
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
                    <div class="modal-body">
                        ${championshipFormHtml({ prefix: 'new' })}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" id="champ-submit">Create</button>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('modal-container')!;
    const bsModal = new Modal(modalEl);
    const bindings: ChampionshipFormBindings = bindChampionshipForm('new');
    bsModal.show();
    modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove(), { once: true });

    modalEl.addEventListener('shown.bs.modal', () => {
        (document.getElementById('new-name') as HTMLInputElement).focus();
    }, { once: true });

    document.getElementById('champ-submit')!.addEventListener('click', async () => {
        const nameInput = document.getElementById('new-name') as HTMLInputElement;
        const name = nameInput.value.trim();
        if (!name) {
            nameInput.classList.add('is-invalid');
            return;
        }

        const btn = document.getElementById('champ-submit') as HTMLButtonElement;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Creating\u2026';

        try {
            const body: Record<string, string> = {
                name,
                description: (document.getElementById('new-desc') as HTMLTextAreaElement).value.trim(),
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
