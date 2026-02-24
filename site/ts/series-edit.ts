import { api } from './api';
import { getUser } from './auth';
import { seriesDetailUrl } from './series-detail';

interface Series {
    series_id: string;
    championship_id: string;
    name: string;
    description?: string;
    status?: string;
    rules?: string;
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

    const statusOptions = ['upcoming', 'active', 'completed', 'archived'];

    container.innerHTML = `
        <div class="mx-auto" style="max-width:600px">
            <h4 class="mb-4">Edit Series</h4>
            <div class="mb-3">
                <label class="form-label" for="series-name">Name <span class="text-danger">*</span></label>
                <input type="text" class="form-control" id="series-name" value="${esc(series.name)}" required>
            </div>
            <div class="mb-3">
                <label class="form-label" for="series-desc">Description</label>
                <textarea class="form-control" id="series-desc" rows="3">${esc(series.description ?? '')}</textarea>
            </div>
            <div class="mb-3">
                <label class="form-label" for="series-status">Status</label>
                <select class="form-select" id="series-status">
                    ${statusOptions.map(s =>
                        `<option value="${s}"${s === (series.status ?? 'upcoming') ? ' selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`,
                    ).join('')}
                </select>
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
        const nameInput = document.getElementById('series-name') as HTMLInputElement;
        const name = nameInput.value.trim();
        if (!name) {
            nameInput.classList.add('is-invalid');
            return;
        }

        const btn = document.getElementById('save-series-btn') as HTMLButtonElement;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving\u2026';

        try {
            await api.put(`/api/series/${seriesId}`, {
                name,
                description: (document.getElementById('series-desc') as HTMLTextAreaElement).value.trim(),
                status: (document.getElementById('series-status') as HTMLSelectElement).value,
                rules: (document.getElementById('series-rules') as HTMLTextAreaElement).value.trim(),
            });
            window.location.href = seriesDetailUrl(seriesId, name);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Save';
        }
    });
}
