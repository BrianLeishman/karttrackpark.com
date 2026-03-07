import axios from 'axios';
import { api, apiBase, assetsBase } from './api';
import { getUser } from './auth';
import { esc } from './html';
import { seriesDetailUrl, trackDetailUrl, championshipDetailUrl } from './url-utils';

interface Series {
    series_id: string;
    track_id: string;
    championship_id: string;
    name: string;
    description?: string;
    rules?: string;
}

interface TrackPublic {
    track_id: string;
    name: string;
    logo_key?: string;
}

interface Championship {
    championship_id: string;
    name: string;
    logo_key?: string;
}

export async function renderSeriesEdit(container: HTMLElement): Promise<void> {
    const seriesId = new URLSearchParams(window.location.search).get('id');
    if (!seriesId || !getUser()) {
        window.location.href = '/';
        return;
    }

    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';

    let series: Series;
    try {
        const { data } = await api.get<Series>(`/api/series/${seriesId}`);
        series = data;
    } catch {
        window.location.href = '/';
        return;
    }

    let track: TrackPublic;
    let champ: Championship | null = null;
    let championships: Championship[];
    try {
        const [trackResp, champsResp] = await Promise.all([
            axios.get<TrackPublic>(`${apiBase}/api/tracks/${series.track_id}/public`),
            api.get<Championship[]>(`/api/tracks/${series.track_id}/championships`),
        ]);
        track = trackResp.data;
        championships = champsResp.data;
        if (series.championship_id) {
            champ = championships.find(c => c.championship_id === series.championship_id) ?? null;
        }
    } catch {
        window.location.href = '/';
        return;
    }

    container.innerHTML = `
        <div class="mx-auto" style="max-width:600px">
            <div class="d-flex flex-wrap align-items-center gap-2 mb-3 text-body-secondary small">
                <a href="${trackDetailUrl(track.track_id, track.name)}" class="d-inline-flex align-items-center gap-2 text-decoration-none text-body-secondary" data-track-hover="${track.track_id}">
                    ${track.logo_key ?
                        `<img src="${assetsBase}/${track.logo_key}" alt="" width="24" height="24" class="rounded flex-shrink-0" style="object-fit:cover">` :
                        '<div class="rounded bg-body-secondary flex-shrink-0 d-flex align-items-center justify-content-center" style="width:24px;height:24px"><i class="fa-solid fa-flag-checkered small"></i></div>'
                    }
                    <span>${esc(track.name)}</span>
                </a>
                ${champ ? `
                    <i class="fa-solid fa-chevron-right mx-1" style="font-size:.6rem"></i>
                    <a href="${championshipDetailUrl(champ.championship_id, champ.name)}" class="text-decoration-none text-body-secondary">
                        <i class="fa-solid fa-trophy me-1 small"></i>${esc(champ.name)}
                    </a>
                ` : ''}
            </div>
            <h4 class="mb-4">Edit Series</h4>
            <div class="mb-3">
                <label class="form-label" for="series-name">Name <span class="text-danger">*</span></label>
                <input type="text" class="form-control" id="series-name" value="${esc(series.name)}" required>
            </div>
            <div class="mb-3">
                <label class="form-label" for="series-champ">Championship</label>
                <select class="form-select" id="series-champ">
                    <option value=""${!series.championship_id ? ' selected' : ''}>None</option>
                    ${championships.map(c =>
                        `<option value="${c.championship_id}"${c.championship_id === series.championship_id ? ' selected' : ''}>${esc(c.name)}</option>`,
                    ).join('')}
                </select>
            </div>
            <div class="mb-3">
                <label class="form-label" for="series-desc">Description</label>
                <textarea class="form-control" id="series-desc" rows="3">${esc(series.description ?? '')}</textarea>
            </div>
            <div class="mb-3">
                <label class="form-label" for="series-rules">Rules</label>
                <textarea class="form-control" id="series-rules" rows="3">${esc(series.rules ?? '')}</textarea>
            </div>
            <div class="d-flex gap-2">
                <button type="button" class="btn btn-primary" id="save-series-btn">Save</button>
                <a href="${seriesDetailUrl(series.series_id, series.name)}" class="btn btn-secondary">Cancel</a>
            </div>
        </div>
    `;

    document.getElementById('save-series-btn')?.addEventListener('click', async () => {
        const nameInput = document.getElementById('series-name');
        if (!(nameInput instanceof HTMLInputElement)) {
            return;
        }
        const name = nameInput.value.trim();
        if (!name) {
            nameInput.classList.add('is-invalid');
            return;
        }

        const btn = document.getElementById('save-series-btn');
        if (!(btn instanceof HTMLButtonElement)) {
            return;
        }
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving\u2026';

        try {
            const descEl = document.getElementById('series-desc');
            const rulesEl = document.getElementById('series-rules');
            const champEl = document.getElementById('series-champ');
            const champId = champEl instanceof HTMLSelectElement ? champEl.value : series.championship_id;
            await api.put(`/api/series/${seriesId}`, {
                name,
                description: descEl instanceof HTMLTextAreaElement ? descEl.value.trim() : '',
                rules: rulesEl instanceof HTMLTextAreaElement ? rulesEl.value.trim() : '',
                ...champId !== series.championship_id && { championship_id: champId },
            });
            window.location.href = seriesDetailUrl(seriesId, name);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Save';
        }
    });
}
