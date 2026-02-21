import axios from 'axios';
import { parsePhoneNumberWithError } from 'libphonenumber-js';
import { getAccessToken } from './auth';

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

export async function renderTrackDetail(container: HTMLElement): Promise<void> {
    const trackId = getTrackId();
    if (!trackId) {
        container.innerHTML = '<div class="alert alert-warning">No track ID specified.</div>';
        return;
    }

    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';

    let track: TrackPublic;
    let events: EventsResponse;
    let isMember = false;

    // Check membership in parallel (silently fails if not logged in or not a member)
    const token = getAccessToken();
    const membershipCheck = token
        ? axios.get(`${apiBase}/api/tracks/${trackId}`, {
            headers: { Authorization: `Bearer ${token}` },
        }).then(() => true, () => false)
        : Promise.resolve(false);

    try {
        const [trackResp, eventsResp, memberResult] = await Promise.all([
            axios.get<TrackPublic>(`${apiBase}/api/tracks/${trackId}/public`),
            axios.get<EventsResponse>(`${apiBase}/api/events?track_id=${trackId}`),
            membershipCheck,
        ]);
        track = trackResp.data;
        events = eventsResp.data;
        isMember = memberResult;
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

    container.innerHTML = `
        <div class="d-flex align-items-start gap-3 mb-4">
            ${logoUrl
                ? `<img src="${logoUrl}" alt="" width="96" height="96" class="rounded flex-shrink-0" style="object-fit:cover">`
                : '<div class="rounded bg-body-secondary flex-shrink-0 d-flex align-items-center justify-content-center" style="width:96px;height:96px"><i class="fa-solid fa-flag-checkered fa-2x text-body-secondary"></i></div>'
            }
            <div>
                <div class="d-flex align-items-center gap-2 mb-1">
                    <h1 class="mb-0">${track.name}</h1>
                    ${isMember ? `<a href="/my/tracks/edit/?id=${track.track_id}" class="btn btn-sm btn-outline-secondary"><i class="fa-solid fa-gear me-1"></i>Manage</a>` : ''}
                </div>
                ${location ? `<p class="text-body-secondary mb-1"><i class="fa-solid fa-location-dot me-1"></i>${location}</p>` : ''}
                ${contactItems.length > 0 ? `<div class="d-flex flex-wrap gap-3">${contactItems.join('')}</div>` : ''}
                ${socialLinks(track)}
            </div>
        </div>
        <h2 class="mb-3">Upcoming Events</h2>
        <div class="row g-3 mb-5">${upcomingCards}</div>
        <h2 class="mb-3">Recent Events</h2>
        <div class="row g-3">${recentCards}</div>`;
}
