import { api } from './api';
import { getUser } from './auth';
import { championshipDetailUrl } from './championship-detail';
import { championshipFormHtml, bindChampionshipForm } from './championship-form';
import type { ChampionshipFormBindings } from './championship-form';
import { uploadAsset } from './tracks';

interface Championship {
    championship_id: string;
    track_id: string;
    name: string;
    description?: string;
    logo_key?: string;
}

export async function renderChampionshipEdit(container: HTMLElement): Promise<void> {
    const champId = new URLSearchParams(window.location.search).get('id');
    if (!champId || !getUser()) {
        window.location.href = '/';
        return;
    }

    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';

    let champ: Championship;
    try {
        const { data } = await api.get<Championship>(`/api/championships/${champId}`);
        champ = data;
    } catch {
        window.location.href = '/';
        return;
    }

    container.innerHTML = `
        <div class="mx-auto" style="max-width:600px">
            <h4 class="mb-4">Edit Championship</h4>
            ${championshipFormHtml({ prefix: 'edit', values: champ })}
            <div class="d-flex gap-2">
                <button type="button" class="btn btn-primary" id="save-champ-btn">Save</button>
                <a href="${championshipDetailUrl(champ.championship_id, champ.name)}" class="btn btn-secondary">Cancel</a>
            </div>
        </div>
    `;

    const bindings: ChampionshipFormBindings = bindChampionshipForm('edit');

    document.getElementById('save-champ-btn')?.addEventListener('click', async () => {
        const nameInput = document.getElementById('edit-name') as HTMLInputElement;
        const name = nameInput.value.trim();
        if (!name) {
            nameInput.classList.add('is-invalid');
            return;
        }

        const btn = document.getElementById('save-champ-btn') as HTMLButtonElement;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving\u2026';

        try {
            const body: Record<string, string> = {
                name,
                description: (document.getElementById('edit-desc') as HTMLTextAreaElement).value.trim(),
            };

            const logo = bindings.croppedBlob ?? bindings.logoInput.files?.[0];
            if (logo) {
                body.logoKey = await uploadAsset(logo);
            }

            await api.put(`/api/championships/${champId}`, body);
            window.location.href = championshipDetailUrl(champId, name);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Save';
        }
    });
}
