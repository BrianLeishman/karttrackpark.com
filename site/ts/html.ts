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

export const SESSION_TYPES = ['practice', 'quali', 'heat', 'race', 'final', 'driver_meeting'];
export const START_TYPES = ['rolling', 'standing', 'pit'];

export function startTypeLabel(t: string): string {
    if (t === 'pit') {
        return 'From Pit';
    }
    return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Info needed to build session info pills. */
export interface SessionPillsInput {
    layout_id?: string;
    reverse?: boolean;
    start_type?: string;
    lap_limit?: number;
    session_type?: string;
    class_ids?: string[];
    track_id?: string;
}

/**
 * Build the session info pills HTML array.
 * layoutMap/classMap are id→name lookups; trackId is for the hover card data attribute.
 */
export function buildSessionInfoPills(
    session: SessionPillsInput,
    layoutMap: Map<string, string>,
    classMap: Map<string, string>,
): string[] {
    const pills: string[] = [];

    if (session.layout_id) {
        const layoutName = layoutMap.get(session.layout_id);
        if (layoutName) {
            pills.push(`<span class="d-inline-flex align-items-center gap-1" data-bs-toggle="tooltip" data-bs-title="Track layout" data-track-hover="${session.track_id ?? ''}" data-layout-id="${session.layout_id}">
                <i class="fa-solid fa-route"></i>${esc(layoutName)}${session.reverse ? ' <span class="badge text-bg-secondary">rev</span>' : ''}
            </span>`);
        }
    }
    if (session.class_ids && session.class_ids.length > 0) {
        const names = session.class_ids.map(id => classMap.get(id)).filter(Boolean);
        if (names.length > 0) {
            pills.push(`<span class="d-inline-flex align-items-center gap-1" data-bs-toggle="tooltip" data-bs-title="Kart class"><i class="fa-solid fa-car"></i>${names.map(n => esc(n ?? '')).join(', ')}</span>`);
        }
    }
    if (session.start_type) {
        pills.push(`<span class="d-inline-flex align-items-center gap-1" data-bs-toggle="tooltip" data-bs-title="Start type"><i class="fa-solid fa-flag"></i>${startTypeLabel(session.start_type)}</span>`);
    }
    if (session.lap_limit) {
        pills.push(`<span class="d-inline-flex align-items-center gap-1" data-bs-toggle="tooltip" data-bs-title="Maximum laps per driver"><i class="fa-solid fa-hashtag"></i>${session.lap_limit} lap${session.lap_limit !== 1 ? 's' : ''} max</span>`);
    }

    const useTotalTime = scoringUsesTotalTime(session.session_type);
    pills.push(`<span class="d-inline-flex align-items-center gap-1" data-bs-toggle="tooltip" data-bs-title="${useTotalTime ? 'Winner is first to cross the finish line' : 'Winner has the fastest single lap'}"><i class="fa-solid fa-ranking-star"></i>${useTotalTime ? 'First to Finish' : 'Fastest Lap'}</span>`);

    return pills;
}

/** Whether scoring uses total time (first to finish) vs fastest single lap. */
export function scoringUsesTotalTime(sessionType?: string): boolean {
    return sessionType === 'heat' || sessionType === 'race' || sessionType === 'final';
}

/** Session type → Bootstrap badge color class. */
export const SESSION_TYPE_BADGE_COLORS: Record<string, string> = {
    practice: 'text-bg-secondary',
    quali: 'text-bg-info',
    heat: 'text-bg-warning',
    race: 'text-bg-danger',
    final: 'text-bg-danger',
    driver_meeting: 'text-bg-secondary',
};

/** Sector color constants. */
export const SECTOR_COLORS = {
    best: '#c632c8',
    good: '#198754',
    ok: '#6c757d',
    slow: '#dc3545',
};

/** Render colored sector blocks HTML for a lap's sectors. */
export function sectorBlocksHtml(
    sectors: number[],
    bestPerSector: number[],
    worstPerSector: number[],
): string {
    return sectors.map((ms, i) => {
        let color = SECTOR_COLORS.ok;
        let title = `S${i + 1}: ${formatLapTime(ms)}`;
        if (ms === bestPerSector[i]) {
            color = SECTOR_COLORS.best;
            title += ' (best)';
        } else if (bestPerSector[i] > 0 && ms <= bestPerSector[i] * 1.02) {
            color = SECTOR_COLORS.good;
        } else if (ms === worstPerSector[i]) {
            color = SECTOR_COLORS.slow;
        }
        return `<span class="d-inline-block rounded-1 me-1" style="width:28px;height:14px;background:${color}" data-bs-toggle="tooltip" data-bs-title="${title}"></span>`;
    }).join('');
}

/** Initialize Bootstrap tooltips within a container element. */
const bsPromise = import('bootstrap');
export function initTooltips(container: HTMLElement): void {
    void bsPromise.then(bs => {
        container.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
            new bs.Tooltip(el);
        });
    });
}

export function formatLapTime(ms: number): string {
    if (ms <= 0) {
        return '\u2014';
    }
    const totalSeconds = ms / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) {
        return `${String(minutes)}:${seconds.toFixed(3).padStart(6, '0')}`;
    }
    return seconds.toFixed(3);
}
