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
export const eventDetailUrl = (id: string, name: string): string => detailUrl('events', id, name);

export function getEntityId(prefix: string): string | null {
    if (isHugoServer()) {
        return new URLSearchParams(window.location.search).get('id');
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
