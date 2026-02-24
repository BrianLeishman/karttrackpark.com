import { showCropModal } from './crop-modal';

const assetsBase = document.querySelector<HTMLMetaElement>('meta[name="assets-base"]')?.content
    ?? 'https://assets.karttrackpark.com';

export interface ChampionshipFormValues {
    name?: string;
    logo_key?: string;
    description?: string;
}

interface ChampionshipFormOptions {
    prefix: string;
    values?: ChampionshipFormValues;
}

export interface ChampionshipFormBindings {
    logoInput: HTMLInputElement;
    logoPreview: HTMLElement;
    croppedBlob: Blob | null;
}

function escAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function championshipFormHtml(opts: ChampionshipFormOptions): string {
    const p = opts.prefix;
    const v = opts.values ?? {};
    const logoUrl = v.logo_key ? `${assetsBase}/${v.logo_key}` : '';

    return `
        <div class="mb-3">
            <label class="form-label" for="${p}-logo">Logo</label>
            <div class="d-flex align-items-center gap-3">
                <div id="${p}-logo-preview" class="rounded bg-body-secondary d-flex align-items-center justify-content-center flex-shrink-0" style="width:96px;height:96px;overflow:hidden;cursor:pointer" title="Click to ${logoUrl ? 'change' : 'choose'} logo">
                    ${logoUrl
                        ? `<img src="${logoUrl}" alt="Logo" style="width:100%;height:100%;object-fit:cover">`
                        : '<i class="fa-solid fa-trophy fa-2x text-body-secondary"></i>'
                    }
                </div>
                <div>
                    <input type="file" class="form-control" id="${p}-logo" accept="image/png,image/jpeg,image/webp,image/svg+xml">
                    <div class="form-text">PNG, JPG, WebP, or SVG</div>
                </div>
            </div>
        </div>
        <div class="mb-3">
            <label class="form-label" for="${p}-name">Name <span class="text-danger">*</span></label>
            <input type="text" class="form-control" id="${p}-name" value="${escAttr(v.name ?? '')}" required>
        </div>
        <div class="mb-3">
            <label class="form-label" for="${p}-desc">Description</label>
            <textarea class="form-control" id="${p}-desc" rows="2">${escAttr(v.description ?? '')}</textarea>
        </div>`;
}

export function bindChampionshipForm(prefix: string): ChampionshipFormBindings {
    const p = prefix;

    const logoInput = document.getElementById(`${p}-logo`) as HTMLInputElement;
    const logoPreview = document.getElementById(`${p}-logo-preview`)!;
    logoPreview.addEventListener('click', () => logoInput.click());

    let croppedBlob: Blob | null = null;
    logoInput.addEventListener('change', async () => {
        const file = logoInput.files?.[0];
        if (!file) return;

        if (file.type === 'image/svg+xml') {
            croppedBlob = null;
            const url = URL.createObjectURL(file);
            logoPreview.innerHTML = `<img src="${url}" alt="Preview" style="width:100%;height:100%;object-fit:cover">`;
            return;
        }

        const blob = await showCropModal(file);
        if (blob) {
            croppedBlob = blob;
            const url = URL.createObjectURL(blob);
            logoPreview.innerHTML = `<img src="${url}" alt="Preview" style="width:100%;height:100%;object-fit:cover">`;
        } else {
            logoInput.value = '';
        }
    });

    return {
        logoInput, logoPreview,
        get croppedBlob() { return croppedBlob; },
        set croppedBlob(v: Blob | null) { croppedBlob = v; },
    };
}
