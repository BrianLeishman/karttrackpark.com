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
    registration_mode?: string;
    max_spots?: number;
    price_cents?: number;
    currency?: string;
    registration_deadline?: string;
    method?: string;
    points_scheme?: number[];
    drop_rounds?: number;
    tiebreaker?: string;
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
                <a href="${trackDetailUrl(track.track_id, track.name)}" class="d-inline-flex align-items-center gap-2 text-body-secondary" data-track-hover="${track.track_id}">
                    ${track.logo_key ?
                        `<img src="${assetsBase}/${track.logo_key}" alt="" width="24" height="24" class="rounded flex-shrink-0" style="object-fit:cover">` :
                        '<div class="rounded bg-body-secondary flex-shrink-0 d-flex align-items-center justify-content-center" style="width:24px;height:24px"><i class="fa-solid fa-flag-checkered small"></i></div>'
                    }
                    <span>${esc(track.name)}</span>
                </a>
                ${champ ? `
                    <i class="fa-solid fa-chevron-right mx-1" style="font-size:.6rem"></i>
                    <a href="${championshipDetailUrl(champ.championship_id, champ.name)}" class="d-inline-flex align-items-center gap-2 text-body-secondary">
                        ${champ.logo_key ?
                            `<img src="${assetsBase}/${champ.logo_key}" alt="" width="24" height="24" class="rounded flex-shrink-0" style="object-fit:cover">` :
                            '<i class="fa-solid fa-trophy small"></i>'
                        }
                        <span>${esc(champ.name)}</span>
                    </a>
                ` : ''}
                <i class="fa-solid fa-chevron-right mx-1" style="font-size:.6rem"></i>
                <a href="${seriesDetailUrl(series.series_id, series.name)}" class="text-body-secondary">${esc(series.name)}</a>
                <i class="fa-solid fa-chevron-right mx-1" style="font-size:.6rem"></i>
                <span class="active">Edit Series</span>
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
            <hr>
            <h5 class="mb-3">Registration Settings</h5>
            <div class="mb-3">
                <label class="form-label" for="series-reg-mode">Registration Mode</label>
                <select class="form-select" id="series-reg-mode">
                    <option value="closed"${(series.registration_mode ?? 'closed') === 'closed' ? ' selected' : ''}>Closed</option>
                    <option value="open"${series.registration_mode === 'open' ? ' selected' : ''}>Open</option>
                    <option value="invite_only"${series.registration_mode === 'invite_only' ? ' selected' : ''}>Invite Only</option>
                    <option value="approval_required"${series.registration_mode === 'approval_required' ? ' selected' : ''}>Approval Required</option>
                </select>
            </div>
            <div class="row g-3 mb-3">
                <div class="col-md-4">
                    <label class="form-label" for="series-max-spots">Max Spots <span class="text-body-secondary">(0 = unlimited)</span></label>
                    <input type="number" class="form-control" id="series-max-spots" min="0" value="${series.max_spots ?? 0}">
                </div>
                <div class="col-md-4">
                    <label class="form-label" for="series-price">Price (cents)</label>
                    <input type="number" class="form-control" id="series-price" min="0" value="${series.price_cents ?? 0}">
                </div>
                <div class="col-md-4">
                    <label class="form-label" for="series-currency">Currency</label>
                    <input type="text" class="form-control" id="series-currency" value="${esc(series.currency ?? 'USD')}" maxlength="3">
                </div>
            </div>
            <div class="mb-3">
                <label class="form-label" for="series-deadline">Registration Deadline</label>
                <input type="datetime-local" class="form-control" id="series-deadline" value="${series.registration_deadline ? series.registration_deadline.slice(0, 16) : ''}">
            </div>
            <hr>
            <h5 class="mb-3">Scoring</h5>
            <div class="mb-3">
                <label class="form-label" for="series-scoring-method">Scoring Method</label>
                <select class="form-select" id="series-scoring-method">
                    <option value=""${!series.method ? ' selected' : ''}>None</option>
                    <option value="points"${series.method === 'points' ? ' selected' : ''}>Points</option>
                    <option value="best_time"${series.method === 'best_time' ? ' selected' : ''}>Best Time</option>
                    <option value="total_time"${series.method === 'total_time' ? ' selected' : ''}>Total Time</option>
                </select>
            </div>
            <div class="mb-3">
                <label class="form-label" for="series-points-scheme">Points Scheme <span class="text-body-secondary">(comma-separated, e.g. 25,18,15,12,10,8,6,4,2,1)</span></label>
                <input type="text" class="form-control" id="series-points-scheme" value="${(series.points_scheme ?? []).join(',')}">
            </div>
            <div class="row g-3 mb-3">
                <div class="col-md-6">
                    <label class="form-label" for="series-drop-rounds">Drop Rounds</label>
                    <input type="number" class="form-control" id="series-drop-rounds" min="0" value="${series.drop_rounds ?? 0}">
                </div>
                <div class="col-md-6">
                    <label class="form-label" for="series-tiebreaker">Tiebreaker</label>
                    <select class="form-select" id="series-tiebreaker">
                        <option value=""${!series.tiebreaker ? ' selected' : ''}>None</option>
                        <option value="most_wins"${series.tiebreaker === 'most_wins' ? ' selected' : ''}>Most Wins</option>
                        <option value="best_finish"${series.tiebreaker === 'best_finish' ? ' selected' : ''}>Best Finish</option>
                    </select>
                </div>
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

            const regModeEl = document.getElementById('series-reg-mode');
            const maxSpotsEl = document.getElementById('series-max-spots');
            const priceEl = document.getElementById('series-price');
            const currencyEl = document.getElementById('series-currency');
            const deadlineEl = document.getElementById('series-deadline');
            const methodEl = document.getElementById('series-scoring-method');
            const pointsSchemeEl = document.getElementById('series-points-scheme');
            const dropRoundsEl = document.getElementById('series-drop-rounds');
            const tiebreakerEl = document.getElementById('series-tiebreaker');

            const deadlineVal = deadlineEl instanceof HTMLInputElement && deadlineEl.value ?
                new Date(deadlineEl.value).toISOString() :
                '';

            const pointsSchemeStr = pointsSchemeEl instanceof HTMLInputElement ?
                pointsSchemeEl.value.trim() :
                '';
            const pointsScheme = pointsSchemeStr ?
                pointsSchemeStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) :
                [];

            await api.put(`/api/series/${seriesId}`, {
                name,
                description: descEl instanceof HTMLTextAreaElement ? descEl.value.trim() : '',
                rules: rulesEl instanceof HTMLTextAreaElement ? rulesEl.value.trim() : '',
                ...champId !== series.championship_id && { championship_id: champId },
                registrationMode: regModeEl instanceof HTMLSelectElement ? regModeEl.value : 'closed',
                maxSpots: maxSpotsEl instanceof HTMLInputElement ? parseInt(maxSpotsEl.value, 10) || 0 : 0,
                priceCents: priceEl instanceof HTMLInputElement ? parseInt(priceEl.value, 10) || 0 : 0,
                currency: currencyEl instanceof HTMLInputElement ? currencyEl.value.trim() : 'USD',
                registrationDeadline: deadlineVal,
                method: methodEl instanceof HTMLSelectElement ? methodEl.value : '',
                pointsScheme: pointsScheme.length > 0 ? pointsScheme : [],
                dropRounds: dropRoundsEl instanceof HTMLInputElement ? parseInt(dropRoundsEl.value, 10) || 0 : 0,
                tiebreaker: tiebreakerEl instanceof HTMLSelectElement ? tiebreakerEl.value : '',
            });
            window.location.href = seriesDetailUrl(seriesId, name);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Save';
        }
    });
}
