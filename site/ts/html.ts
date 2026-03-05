export function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function emptyState(message: string): string {
    return `<div class="col-12"><p class="text-body-secondary text-center py-3">${message}</p></div>`;
}

export const dateFmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
});

export function formatDate(iso: string): string {
    return dateFmt.format(new Date(iso));
}

export function typeBadge(eventType?: string): string {
    if (!eventType) {
        return '';
    }
    return `<span class="badge text-bg-secondary">${eventType}</span>`;
}

export function statusColor(status?: string): string {
    const map: Record<string, string> = {
        active: 'success', upcoming: 'warning', completed: 'info', archived: 'secondary',
    };
    return map[status ?? ''] ?? 'secondary';
}

export const typeLabel = (t: string): string => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
