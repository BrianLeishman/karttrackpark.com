import axios from 'axios';
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
}

interface TrackPublic {
    track_id: string;
    name: string;
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

const apiBase = document.querySelector<HTMLMetaElement>('meta[name="api-base"]')?.content
    ?? 'https://62lt3y3apd.execute-api.us-east-1.amazonaws.com';

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
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
});

function ensureCorrectSlug(series: Series): boolean {
    if (isHugoServer()) return false;
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

    if (ensureCorrectSlug(series)) return;

    // Fetch championship + track + membership (need IDs from series)
    const token = getAccessToken();
    const membershipCheck = token
        ? axios.get<TrackAuth>(`${apiBase}/api/tracks/${series.track_id}`, {
            headers: { Authorization: `Bearer ${token}` },
        }).then(resp => resp.data.role, () => null as string | null)
        : Promise.resolve(null as string | null);

    let champ: Championship;
    let track: TrackPublic;
    let role: string | null = null;

    try {
        const [champResp, trackResp, memberResult] = await Promise.all([
            api.get<Championship>(`/api/championships/${series.championship_id}`),
            axios.get<TrackPublic>(`${apiBase}/api/tracks/${series.track_id}/public`),
            membershipCheck,
        ]);
        champ = champResp.data;
        track = trackResp.data;
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

    const eventsHtml = events.length > 0
        ? events.map(ev => `
            <div class="d-flex align-items-center gap-2 py-2 border-bottom">
                <span class="badge rounded-pill font-monospace" style="background:var(--bs-tertiary-bg);color:var(--bs-secondary-color);min-width:2.5rem">R${ev.round_number}</span>
                <span class="flex-grow-1">${esc(ev.event_name ?? 'Unnamed event')}</span>
                ${ev.start_time ? `<span class="text-body-secondary small">${shortDate.format(new Date(ev.start_time))}</span>` : ''}
            </div>`).join('')
        : '<p class="text-body-secondary">No events linked yet.</p>';

    const driversHtml = drivers.length > 0
        ? drivers.map(d => `
            <div class="d-flex align-items-center gap-2 py-2 border-bottom">
                <span class="flex-grow-1">${esc(d.driver_name)}</span>
                ${d.seeded ? '<span class="badge text-bg-info">Seeded</span>' : ''}
                <span class="fw-semibold">${d.total_points ?? 0} pts</span>
            </div>`).join('')
        : '<p class="text-body-secondary">No drivers enrolled yet.</p>';

    container.innerHTML = `
        <nav aria-label="breadcrumb" class="mb-3">
            <ol class="breadcrumb">
                <li class="breadcrumb-item"><a href="${trackDetailUrl(track.track_id, track.name)}">${esc(track.name)}</a></li>
                <li class="breadcrumb-item"><a href="${championshipDetailUrl(champ.championship_id, champ.name)}">${esc(champ.name)}</a></li>
                <li class="breadcrumb-item active" aria-current="page">${esc(series.name)}</li>
            </ol>
        </nav>
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
                <h3 class="mb-3">Events</h3>
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
        if (!confirm(`Delete "${series.name}"? This cannot be undone.`)) return;
        try {
            await api.delete(`/api/series/${series.series_id}`);
            window.location.href = championshipDetailUrl(champ.championship_id, champ.name);
        } catch { /* api interceptor shows toast */ }
    });
}
