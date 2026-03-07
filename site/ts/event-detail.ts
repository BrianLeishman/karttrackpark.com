import axios from 'axios';
import { api, apiBase, assetsBase } from './api';
import { getAccessToken } from './auth';
import { esc, dateFmt, typeBadge } from './html';
import { getEntityId, ensureCorrectEventUrl, trackDetailUrl, championshipDetailUrl, seriesDetailUrl } from './url-utils';

interface SeriesContext {
    series_id: string;
    series_name: string;
    championship_id: string;
    championship_name: string;
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

interface EventSession {
    session_id: string;
    session_name?: string;
    session_type?: string;
    session_order?: number;
}

export async function renderEventDetail(container: HTMLElement): Promise<void> {
    const eventId = getEntityId('events');
    if (!eventId) {
        container.innerHTML = '<div class="alert alert-warning">No event ID specified.</div>';
        return;
    }

    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';

    let event: EventDetail;
    let sessions: EventSession[];

    try {
        const [eventResp, sessionsResp] = await Promise.all([
            api.get<EventDetail>(`/api/events/${eventId}`),
            axios.get<EventSession[]>(`${apiBase}/api/events/${eventId}/sessions`).catch((): { data: EventSession[] } => ({ data: [] })),
        ]);
        event = eventResp.data;
        sessions = sessionsResp.data;
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

    try {
        const [trackResp, memberResult] = await Promise.all([
            axios.get<TrackPublic>(`${apiBase}/api/tracks/${event.track_id}/public`),
            membershipCheck,
        ]);
        track = trackResp.data;
        role = memberResult;
    } catch {
        container.innerHTML = '<div class="alert alert-danger">Failed to load track info.</div>';
        return;
    }

    const canManage = role === 'owner' || role === 'admin';

    document.title = `${event.name} \u2014 Kart Track Park`;

    // Build breadcrumb from series context
    const breadcrumbParts: string[] = [
        `<a href="${trackDetailUrl(track.track_id, track.name)}" class="d-inline-flex align-items-center gap-2 text-decoration-none text-body-secondary" data-track-hover="${track.track_id}">
            ${track.logo_key ?
                `<img src="${assetsBase}/${track.logo_key}" alt="" width="28" height="28" class="rounded flex-shrink-0" style="object-fit:cover">` :
                '<div class="rounded bg-body-secondary flex-shrink-0 d-flex align-items-center justify-content-center" style="width:28px;height:28px"><i class="fa-solid fa-flag-checkered small"></i></div>'
            }
            <span>${esc(track.name)}</span>
        </a>`,
    ];
    if (seriesCtx) {
        breadcrumbParts.push(
            `<a href="${championshipDetailUrl(seriesCtx.championship_id, seriesCtx.championship_name)}" class="text-decoration-none text-body-secondary"><i class="fa-solid fa-trophy me-1 small"></i>${esc(seriesCtx.championship_name)}</a>`,
        );
        breadcrumbParts.push(
            `<a href="${seriesDetailUrl(seriesCtx.series_id, seriesCtx.series_name)}" class="text-decoration-none text-body-secondary">${esc(seriesCtx.series_name)}</a>`,
        );
    }

    sessions.sort((a, b) => (a.session_order ?? 0) - (b.session_order ?? 0));
    const sessionsHtml = sessions.length > 0 ?
        sessions.map(s => `
            <div class="d-flex align-items-center gap-2 py-2 border-bottom">
                <span class="badge rounded-pill font-monospace" style="background:var(--bs-tertiary-bg);color:var(--bs-secondary-color);min-width:2rem">${s.session_order ?? ''}</span>
                <span class="flex-grow-1">${esc(s.session_name ?? 'Unnamed')}</span>
                ${s.session_type ? `<span class="badge text-bg-secondary">${s.session_type.replace('_', ' ')}</span>` : ''}
            </div>`).join('') :
        '<p class="text-body-secondary">No sessions.</p>';

    container.innerHTML = `
        <div class="d-flex flex-wrap align-items-center gap-2 mb-3 text-body-secondary small">
            ${breadcrumbParts.join('<i class="fa-solid fa-chevron-right mx-1" style="font-size:.6rem"></i>')}
        </div>
        <div class="d-flex align-items-center gap-2 mb-2">
            <h1 class="mb-0">${esc(event.name)}</h1>
            ${typeBadge(event.event_type)}
            ${canManage ? `
                <button class="btn btn-sm btn-outline-danger ms-auto" id="delete-event-btn"><i class="fa-solid fa-trash me-1"></i>Delete</button>
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
        ${sessions.length > 0 ? `
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
}
