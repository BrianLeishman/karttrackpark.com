export function isHugoServer(): boolean {
    return document.querySelector<HTMLMetaElement>('meta[name="hugo-server"]')?.content === 'true';
}

export function slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function detailUrl(prefix: string, id: string, name: string): string {
    if (isHugoServer()) {
        return `/${prefix}/?id=${id}`;
    }
    return `/${prefix}/${id}/${slugify(name)}`;
}

export const trackDetailUrl = (id: string, name: string): string => detailUrl('tracks', id, name);
export const championshipDetailUrl = (id: string, name: string): string => detailUrl('championships', id, name);
export const seriesDetailUrl = (id: string, name: string): string => detailUrl('series', id, name);
export const sessionDetailUrl = (id: string, name: string): string => detailUrl('sessions', id, name);

export interface EventSeriesContext {
    championship_name: string;
    series_name: string;
}

export function eventDetailUrl(id: string, name: string, series?: EventSeriesContext): string {
    if (isHugoServer()) {
        return `/events/?id=${id}`;
    }
    if (series) {
        return `/events/${slugify(series.championship_name)}/${slugify(series.series_name)}/${id}/${slugify(name)}`;
    }
    return `/events/${id}/${slugify(name)}`;
}

const xidRe = /^[0-9a-v]{20}$/;

export function getEntityId(prefix: string): string | null {
    if (isHugoServer()) {
        return new URLSearchParams(window.location.search).get('id');
    }
    if (prefix === 'events') {
        // Event URLs can be /events/{id}/{slug} or /events/{champ}/{series}/{id}/{slug}
        const segments = window.location.pathname.split('/').filter(Boolean);
        if (segments[0] !== 'events') {
            return null;
        }
        for (const seg of segments) {
            if (xidRe.test(seg)) {
                return seg;
            }
        }
        return null;
    }
    const match = new RegExp(`^/${prefix}/([a-z0-9]+)`).exec(window.location.pathname);
    return match?.[1] ?? null;
}

export function ensureCorrectSlug(prefix: string, id: string, name: string): boolean {
    if (isHugoServer()) {
        return false;
    }
    const expectedSlug = slugify(name);
    const pathParts = window.location.pathname.split('/');
    const currentSlug = pathParts[3] ?? '';
    if (currentSlug !== expectedSlug) {
        window.location.replace(`/${prefix}/${id}/${expectedSlug}`);
        return true;
    }
    return false;
}

export function ensureCorrectEventUrl(id: string, name: string, series?: EventSeriesContext): boolean {
    if (isHugoServer()) {
        return false;
    }
    const expected = eventDetailUrl(id, name, series);
    if (window.location.pathname !== expected) {
        window.location.replace(expected);
        return true;
    }
    return false;
}
