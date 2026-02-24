import axios from 'axios';
import { Modal } from 'bootstrap';
import { api } from './api';
import { getAccessToken } from './auth';
import { slugify, trackDetailUrl } from './track-detail';

interface Championship {
    championship_id: string;
    track_id: string;
    name: string;
    description?: string;
    logo_key?: string;
    created_at: string;
}

interface TrackPublic {
    track_id: string;
    name: string;
    logo_key?: string;
}

interface RacingSeries {
    series_id: string;
    championship_id: string;
    name: string;
    description?: string;
    status?: string;
    created_at: string;
}

interface TrackAuth {
    role: string;
}

const apiBase = document.querySelector<HTMLMetaElement>('meta[name="api-base"]')?.content
    ?? 'https://62lt3y3apd.execute-api.us-east-1.amazonaws.com';

const assetsBase = document.querySelector<HTMLMetaElement>('meta[name="assets-base"]')?.content
    ?? 'https://assets.karttrackpark.com';

function isHugoServer(): boolean {
    return document.querySelector<HTMLMetaElement>('meta[name="hugo-server"]')?.content === 'true';
}

function getChampId(): string | null {
    if (isHugoServer()) {
        return new URLSearchParams(window.location.search).get('id');
    }
    const match = /^\/championships\/([a-z0-9]+)/.exec(window.location.pathname);
    return match?.[1] ?? null;
}

export function championshipDetailUrl(champId: string, name: string): string {
    if (isHugoServer()) {
        return `/championships/?id=${champId}`;
    }
    return `/championships/${champId}/${slugify(name)}`;
}

function seriesUrl(seriesId: string, name: string): string {
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

function ensureCorrectSlug(champ: Championship): boolean {
    if (isHugoServer()) return false;
    const expectedSlug = slugify(champ.name);
    const pathParts = window.location.pathname.split('/');
    const currentSlug = pathParts[3] ?? '';
    if (currentSlug !== expectedSlug) {
        window.location.replace(`/championships/${champ.championship_id}/${expectedSlug}`);
        return true;
    }
    return false;
}

export async function renderChampionshipDetail(container: HTMLElement): Promise<void> {
    const champId = getChampId();
    if (!champId) {
        container.innerHTML = '<div class="alert alert-warning">No championship ID specified.</div>';
        return;
    }

    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';

    let champ: Championship;
    let seriesList: RacingSeries[];

    // Fetch championship + series in parallel (both only need champId)
    try {
        const [champResp, seriesResp] = await Promise.all([
            api.get<Championship>(`/api/championships/${champId}`),
            api.get<RacingSeries[]>(`/api/championships/${champId}/series`),
        ]);
        champ = champResp.data;
        seriesList = seriesResp.data;
    } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
            container.innerHTML = '<div class="alert alert-warning">Championship not found.</div>';
        } else {
            container.innerHTML = '<div class="alert alert-danger">Failed to load championship.</div>';
        }
        return;
    }

    if (ensureCorrectSlug(champ)) return;

    // Fetch track public + membership (need trackId from championship)
    const token = getAccessToken();
    const membershipCheck = token
        ? axios.get<TrackAuth>(`${apiBase}/api/tracks/${champ.track_id}`, {
            headers: { Authorization: `Bearer ${token}` },
        }).then(resp => resp.data.role, () => null as string | null)
        : Promise.resolve(null as string | null);

    let track: TrackPublic;
    let role: string | null = null;

    try {
        const [trackResp, memberResult] = await Promise.all([
            axios.get<TrackPublic>(`${apiBase}/api/tracks/${champ.track_id}/public`),
            membershipCheck,
        ]);
        track = trackResp.data;
        role = memberResult;
    } catch {
        container.innerHTML = '<div class="alert alert-danger">Failed to load track info.</div>';
        return;
    }

    const canManage = role === 'owner' || role === 'admin';

    document.title = `${champ.name} \u2014 Kart Track Park`;

    const seriesCards = seriesList.length > 0
        ? seriesList.map(s => `
            <div class="col-md-6 col-lg-4">
                <a href="${seriesUrl(s.series_id, s.name)}" class="text-decoration-none">
                    <div class="card h-100">
                        <div class="card-body">
                            <div class="d-flex align-items-center gap-2 mb-2">
                                <h5 class="card-title mb-0">${esc(s.name)}</h5>
                                ${s.status ? `<span class="badge text-bg-${statusColor(s.status)}">${s.status}</span>` : ''}
                            </div>
                            ${s.description ? `<p class="card-text text-body-secondary small mb-0">${esc(s.description)}</p>` : ''}
                        </div>
                    </div>
                </a>
            </div>`).join('')
        : '<div class="col-12"><p class="text-body-secondary text-center py-3">No series yet.</p></div>';

    container.innerHTML = `
        <a href="${trackDetailUrl(track.track_id, track.name)}" class="d-inline-flex align-items-center gap-2 text-decoration-none text-body-secondary mb-3">
            ${track.logo_key
                ? `<img src="${assetsBase}/${track.logo_key}" alt="" width="28" height="28" class="rounded flex-shrink-0" style="object-fit:cover">`
                : '<div class="rounded bg-body-secondary flex-shrink-0 d-flex align-items-center justify-content-center" style="width:28px;height:28px"><i class="fa-solid fa-flag-checkered small"></i></div>'
            }
            <span>${esc(track.name)}</span>
        </a>
        <div class="d-flex align-items-start gap-3 mb-4">
            ${champ.logo_key
                ? `<img src="${assetsBase}/${champ.logo_key}" alt="" width="96" height="96" class="rounded flex-shrink-0" style="object-fit:cover">`
                : '<div class="rounded bg-body-secondary flex-shrink-0 d-flex align-items-center justify-content-center" style="width:96px;height:96px"><i class="fa-solid fa-trophy fa-2x text-body-secondary"></i></div>'
            }
            <div>
                <div class="d-flex align-items-center gap-2 mb-1">
                    <h1 class="mb-0">${esc(champ.name)}</h1>
                    ${canManage ? `
                        <a href="/my/championships/edit/?id=${champ.championship_id}" class="btn btn-sm btn-outline-secondary"><i class="fa-solid fa-pen me-1"></i>Edit</a>
                        <button class="btn btn-sm btn-outline-danger" id="delete-champ-btn"><i class="fa-solid fa-trash me-1"></i>Delete</button>
                    ` : ''}
                </div>
                ${champ.description ? `<p class="text-body-secondary mb-0">${esc(champ.description)}</p>` : ''}
            </div>
        </div>
        <div class="d-flex align-items-center mb-3">
            <h2 class="mb-0">Series</h2>
            ${canManage ? '<button class="btn btn-sm btn-primary ms-auto" id="new-series-btn"><i class="fa-solid fa-plus me-1"></i>New Series</button>' : ''}
        </div>
        <div class="row g-3">${seriesCards}</div>
    `;

    // Delete championship handler
    document.getElementById('delete-champ-btn')?.addEventListener('click', async () => {
        if (!confirm(`Delete "${champ.name}"? This cannot be undone.`)) return;
        try {
            await api.delete(`/api/championships/${champ.championship_id}`);
            window.location.href = trackDetailUrl(track.track_id, track.name);
        } catch { /* api interceptor shows toast */ }
    });

    // New series modal
    document.getElementById('new-series-btn')?.addEventListener('click', () => {
        showNewSeriesModal(champ.championship_id, async () => {
            await renderChampionshipDetail(container);
        });
    });
}

function showNewSeriesModal(champId: string, onSave: () => Promise<void>): void {
    const statusOptions = ['upcoming', 'active', 'completed', 'archived'];

    document.getElementById('modal-container')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal fade" id="modal-container" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">New Series</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label class="form-label" for="series-name">Name <span class="text-danger">*</span></label>
                            <input type="text" class="form-control" id="series-name" required>
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="series-desc">Description</label>
                            <textarea class="form-control" id="series-desc" rows="2"></textarea>
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="series-status">Status</label>
                            <select class="form-select" id="series-status">
                                ${statusOptions.map(s =>
                                    `<option value="${s}"${s === 'upcoming' ? ' selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`,
                                ).join('')}
                            </select>
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="series-rules">Rules</label>
                            <textarea class="form-control" id="series-rules" rows="2"></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" id="series-submit">Create</button>
                    </div>
                </div>
            </div>
        </div>
    `);

    const modalEl = document.getElementById('modal-container')!;
    const bsModal = new Modal(modalEl);
    bsModal.show();
    modalEl.addEventListener('hidden.bs.modal', () => modalEl.remove(), { once: true });

    modalEl.addEventListener('shown.bs.modal', () => {
        (document.getElementById('series-name') as HTMLInputElement).focus();
    }, { once: true });

    document.getElementById('series-submit')!.addEventListener('click', async () => {
        const nameInput = document.getElementById('series-name') as HTMLInputElement;
        const name = nameInput.value.trim();
        if (!name) {
            nameInput.classList.add('is-invalid');
            return;
        }

        const btn = document.getElementById('series-submit') as HTMLButtonElement;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Creating\u2026';

        try {
            await api.post(`/api/championships/${champId}/series`, {
                name,
                description: (document.getElementById('series-desc') as HTMLTextAreaElement).value.trim(),
                status: (document.getElementById('series-status') as HTMLSelectElement).value,
                rules: (document.getElementById('series-rules') as HTMLTextAreaElement).value.trim(),
            });
            bsModal.hide();
            await onSave();
        } catch {
            btn.disabled = false;
            btn.textContent = 'Create';
        }
    });
}
