import { api } from './api';
import { trackDetailUrl } from './track-detail';

interface Event {
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
    upcoming: Event[];
    recent: Event[];
}

const dateFmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
});

function formatDate(iso: string): string {
    return dateFmt.format(new Date(iso));
}

function typeBadge(eventType?: string): string {
    if (!eventType) {
        return '';
    }
    return `<span class="badge text-bg-secondary">${eventType}</span>`;
}

function eventCard(event: Event): string {
    return `
        <div class="col-md-6 col-lg-4">
            <div class="card h-100">
                <div class="card-body">
                    <h5 class="card-title">${event.name}</h5>
                    <p class="card-text text-body-secondary small mb-2">
                        <i class="fa-solid fa-location-dot me-1"></i><a href="${trackDetailUrl(event.track_id, event.track_name)}" class="text-body-secondary">${event.track_name}</a>
                    </p>
                    <p class="card-text text-body-secondary small mb-2">
                        <i class="fa-solid fa-clock me-1"></i>${formatDate(event.start_time)}${event.end_time ? ` — ${formatDate(event.end_time)}` : ''}
                    </p>
                    ${event.description ? `<p class="card-text small">${event.description}</p>` : ''}
                    <div class="d-flex gap-2 mt-2">${typeBadge(event.event_type)}</div>
                </div>
            </div>
        </div>`;
}

function emptyState(message: string): string {
    return `<div class="col-12"><p class="text-body-secondary text-center py-3">${message}</p></div>`;
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

    const upcomingCards = data.upcoming.length > 0
        ? data.upcoming.map(eventCard).join('')
        : emptyState('No upcoming events.');

    const recentCards = data.recent.length > 0
        ? data.recent.map(eventCard).join('')
        : emptyState('No recent events.');

    container.innerHTML = `
        <h2 class="mb-3">Upcoming Events</h2>
        <div class="row g-3 mb-5">${upcomingCards}</div>
        <h2 class="mb-3">Recent Events</h2>
        <div class="row g-3">${recentCards}</div>`;
}
