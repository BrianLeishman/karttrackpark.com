import { api, assetsBase } from './api';
import { esc, emptyState, formatDate, typeBadge } from './html';
import { trackDetailUrl, eventDetailUrl, championshipDetailUrl, seriesDetailUrl } from './url-utils';

interface SeriesContext {
    series_id: string;
    series_name: string;
    championship_id: string;
    championship_name: string;
    championship_logo_key?: string;
    round_number: number;
}

interface Event {
    event_id: string;
    track_id: string;
    track_name: string;
    track_logo_key?: string;
    name: string;
    description?: string;
    event_type?: string;
    start_time: string;
    end_time?: string;
    series?: SeriesContext[];
    created_at: string;
}

interface EventsResponse {
    upcoming: Event[];
    recent: Event[];
}

function seriesBadges(event: Event): string {
    if (!event.series || event.series.length === 0) {
        return '';
    }
    return event.series.map(s =>
        `<a href="${championshipDetailUrl(s.championship_id, s.championship_name)}" class="badge text-bg-info text-decoration-none d-inline-flex align-items-center gap-1">${s.championship_logo_key ?
            `<img src="${assetsBase}/${s.championship_logo_key}" alt="" width="14" height="14" class="rounded" style="object-fit:cover">` :
            ''
        }${esc(s.championship_name)}</a>` +
        `<a href="${seriesDetailUrl(s.series_id, s.series_name)}" class="badge text-bg-warning text-decoration-none">${esc(s.series_name)}</a>`,
    ).join('');
}

function eventRow(event: Event): string {
    return `
        <div class="list-group-item d-flex align-items-center gap-3 flex-wrap">
            <div class="flex-grow-1">
                <a href="${eventDetailUrl(event.event_id, event.name, event.series?.[0])}" class="fw-semibold">${esc(event.name)}</a>
                <div class="d-flex align-items-center gap-2 mt-1 flex-wrap">
                    ${typeBadge(event.event_type)}
                    ${seriesBadges(event)}
                </div>
            </div>
            <a href="${trackDetailUrl(event.track_id, event.track_name)}" class="d-flex align-items-center gap-1 text-body-secondary text-decoration-none small text-nowrap" data-track-hover="${event.track_id}">
                ${event.track_logo_key ?
                    `<img src="${assetsBase}/${event.track_logo_key}" alt="" width="20" height="20" class="rounded flex-shrink-0" style="object-fit:cover">` :
                    '<i class="fa-solid fa-flag-checkered"></i>'}
                ${esc(event.track_name)}
            </a>
            <div class="text-body-secondary small text-nowrap">
                <i class="fa-solid fa-clock me-1"></i>${formatDate(event.start_time)}
            </div>
        </div>`;
}

export async function renderEvents(container: HTMLElement): Promise<void> {
    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';

    let data: EventsResponse;
    try {
        const resp = await api.get<EventsResponse>('/api/events');
        data = resp.data;
    } catch {
        container.innerHTML = '<div class="alert alert-danger">Failed to load events.</div>';
        return;
    }

    const upcomingRows = data.upcoming.length > 0 ?
        `<div class="list-group">${data.upcoming.map(eventRow).join('')}</div>` :
        emptyState('No upcoming events.');

    const recentRows = data.recent.length > 0 ?
        `<div class="list-group">${data.recent.map(eventRow).join('')}</div>` :
        emptyState('No recent events.');

    container.innerHTML = `
        <h2 class="mb-3">Upcoming Events</h2>
        ${upcomingRows}
        <h2 class="mb-3 mt-5">Recent Events</h2>
        ${recentRows}`;
}
