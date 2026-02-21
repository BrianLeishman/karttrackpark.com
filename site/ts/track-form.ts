import type { Iti } from 'intl-tel-input';
import { initPhoneInput } from './phone-input';
import { timezoneOptions } from './tracks';

const assetsBase = document.querySelector<HTMLMetaElement>('meta[name="assets-base"]')?.content
    ?? 'https://assets.karttrackpark.com';

export interface TrackFormValues {
    name?: string;
    logo_key?: string;
    email?: string;
    phone?: string;
    city?: string;
    state?: string;
    timezone?: string;
    website?: string;
    facebook?: string;
    instagram?: string;
    youtube?: string;
    tiktok?: string;
}

interface TrackFormOptions {
    /** ID prefix for all form elements (e.g. "track" → "track-name", "track-email") */
    prefix: string;
    /** Pre-fill values for edit mode */
    values?: TrackFormValues;
    /** Whether a logo file is required (true for create, false for edit) */
    logoRequired?: boolean;
    /** Whether to collapse social fields behind a toggle */
    collapseSocials?: boolean;
}

export interface TrackFormBindings {
    iti: Iti;
    logoInput: HTMLInputElement;
    logoPreview: HTMLElement;
}

function escAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Render the track form fields HTML (no outer wrapper, no buttons).
 */
export function trackFormFieldsHtml(opts: TrackFormOptions): string {
    const p = opts.prefix;
    const v = opts.values ?? {};
    const logoUrl = v.logo_key ? `${assetsBase}/${v.logo_key}` : '';
    const logoLabel = opts.logoRequired ? 'Logo <span class="text-danger">*</span>' : 'Logo';

    const socialFields = `
        <div class="mb-2">
            <div class="input-group input-group-sm">
                <span class="input-group-text"><i class="fa-brands fa-facebook-f fa-fw"></i></span>
                <input type="url" class="form-control" id="${p}-facebook" value="${escAttr(v.facebook ?? '')}" placeholder="Facebook URL">
            </div>
        </div>
        <div class="mb-2">
            <div class="input-group input-group-sm">
                <span class="input-group-text"><i class="fa-brands fa-instagram fa-fw"></i></span>
                <input type="url" class="form-control" id="${p}-instagram" value="${escAttr(v.instagram ?? '')}" placeholder="Instagram URL">
            </div>
        </div>
        <div class="mb-2">
            <div class="input-group input-group-sm">
                <span class="input-group-text"><i class="fa-brands fa-youtube fa-fw"></i></span>
                <input type="url" class="form-control" id="${p}-youtube" value="${escAttr(v.youtube ?? '')}" placeholder="YouTube URL">
            </div>
        </div>
        <div>
            <div class="input-group input-group-sm">
                <span class="input-group-text"><i class="fa-brands fa-tiktok fa-fw"></i></span>
                <input type="url" class="form-control" id="${p}-tiktok" value="${escAttr(v.tiktok ?? '')}" placeholder="TikTok URL">
            </div>
        </div>`;

    const socialsBlock = opts.collapseSocials
        ? `<div class="mb-3">
            <a class="text-decoration-none small" data-bs-toggle="collapse" href="#${p}-social-fields" role="button" aria-expanded="false">
                <i class="fa-solid fa-chevron-right me-1" id="${p}-social-chevron"></i>Social Profiles
            </a>
            <div class="collapse mt-2" id="${p}-social-fields">${socialFields}</div>
        </div>`
        : `<div class="mb-3">
            <label class="form-label">Social Profiles</label>
            ${socialFields}
        </div>`;

    return `
        <div class="mb-3">
            <label class="form-label" for="${p}-logo">${logoLabel}</label>
            <div class="d-flex align-items-center gap-3">
                <div id="${p}-logo-preview" class="rounded bg-body-secondary d-flex align-items-center justify-content-center flex-shrink-0" style="width:96px;height:96px;overflow:hidden;cursor:pointer" title="Click to ${logoUrl ? 'change' : 'choose'} logo">
                    ${logoUrl
                        ? `<img src="${logoUrl}" alt="Logo" style="width:100%;height:100%;object-fit:cover">`
                        : '<i class="fa-solid fa-image fa-2x text-body-secondary"></i>'
                    }
                </div>
                <div>
                    <input type="file" class="form-control" id="${p}-logo" accept="image/png,image/jpeg,image/webp,image/svg+xml"${opts.logoRequired ? ' required' : ''}>
                    <div class="form-text">PNG, JPG, WebP, or SVG</div>
                </div>
            </div>
        </div>
        <div class="mb-3">
            <label class="form-label" for="${p}-name">Track name <span class="text-danger">*</span></label>
            <input type="text" class="form-control" id="${p}-name" value="${escAttr(v.name ?? '')}" placeholder="e.g. Speedway Indoor Karting" required>
        </div>
        <div class="mb-3">
            <label class="form-label" for="${p}-email">Email <span class="text-danger">*</span></label>
            <input type="email" class="form-control" id="${p}-email" value="${escAttr(v.email ?? '')}" placeholder="info@example.com" required>
        </div>
        <div class="mb-3">
            <label class="form-label" for="${p}-phone">Phone <span class="text-danger">*</span></label>
            <input type="tel" class="form-control" id="${p}-phone" required>
        </div>
        <div class="row g-2 mb-3">
            <div class="col">
                <label class="form-label" for="${p}-city">City</label>
                <input type="text" class="form-control" id="${p}-city" value="${escAttr(v.city ?? '')}" placeholder="City">
            </div>
            <div class="col-auto" style="width:100px">
                <label class="form-label" for="${p}-state">State</label>
                <input type="text" class="form-control" id="${p}-state" value="${escAttr(v.state ?? '')}" placeholder="OH" maxlength="2">
            </div>
        </div>
        <div class="mb-3">
            <label class="form-label" for="${p}-timezone">Timezone</label>
            <select class="form-select" id="${p}-timezone">
                <option value="">— Select —</option>
                ${timezoneOptions()}
            </select>
        </div>
        <div class="mb-3">
            <label class="form-label" for="${p}-website">Website</label>
            <input type="url" class="form-control" id="${p}-website" value="${escAttr(v.website ?? '')}" placeholder="https://example.com">
        </div>
        ${socialsBlock}`;
}

/**
 * Bind interactive behaviors after the form HTML is in the DOM.
 * Returns handles needed by collectTrackFields.
 */
export function bindTrackForm(prefix: string, phone?: string): TrackFormBindings {
    const p = prefix;

    // Logo preview click-to-upload
    const logoInput = document.getElementById(`${p}-logo`) as HTMLInputElement;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- element is in the template
    const logoPreview = document.getElementById(`${p}-logo-preview`)!;
    logoPreview.addEventListener('click', () => logoInput.click());
    logoInput.addEventListener('change', () => {
        const file = logoInput.files?.[0];
        if (file) {
            const url = URL.createObjectURL(file);
            logoPreview.innerHTML = `<img src="${url}" alt="Preview" style="width:100%;height:100%;object-fit:cover">`;
        }
    });

    // Phone input with country picker
    const phoneInput = document.getElementById(`${p}-phone`) as HTMLInputElement;
    const iti = initPhoneInput(phoneInput, phone);

    // Social section chevron rotation (only present when collapseSocials is true)
    const socialFieldsEl = document.getElementById(`${p}-social-fields`);
    const socialChevron = document.getElementById(`${p}-social-chevron`);
    if (socialFieldsEl && socialChevron) {
        socialFieldsEl.addEventListener('show.bs.collapse', () => socialChevron.classList.replace('fa-chevron-right', 'fa-chevron-down'));
        socialFieldsEl.addEventListener('hide.bs.collapse', () => socialChevron.classList.replace('fa-chevron-down', 'fa-chevron-right'));
    }

    return { iti, logoInput, logoPreview };
}

/**
 * Set the timezone <select> to a specific value after binding.
 * Call after bindTrackForm when editing an existing track.
 */
export function setTrackFormTimezone(prefix: string, tz: string): void {
    const sel = document.getElementById(`${prefix}-timezone`) as HTMLSelectElement | null;
    if (sel && tz) {
        sel.value = tz;
    }
}

/**
 * Validate required fields and collect all form values.
 * Returns null if validation fails (fields are marked is-invalid).
 */
export function collectTrackFields(
    prefix: string,
    bindings: TrackFormBindings,
    logoRequired: boolean,
): Record<string, string> | null {
    const p = prefix;
    const nameInput = document.getElementById(`${p}-name`) as HTMLInputElement;
    const emailInput = document.getElementById(`${p}-email`) as HTMLInputElement;
    const phoneInput = document.getElementById(`${p}-phone`) as HTMLInputElement;

    let valid = true;

    if (!nameInput.value.trim()) {
        nameInput.classList.add('is-invalid');
        valid = false;
    } else {
        nameInput.classList.remove('is-invalid');
    }

    if (!emailInput.value.trim()) {
        emailInput.classList.add('is-invalid');
        valid = false;
    } else {
        emailInput.classList.remove('is-invalid');
    }

    if (!bindings.iti.isValidNumber()) {
        phoneInput.classList.add('is-invalid');
        valid = false;
    } else {
        phoneInput.classList.remove('is-invalid');
    }

    if (logoRequired && !bindings.logoInput.files?.[0]) {
        bindings.logoInput.classList.add('is-invalid');
        valid = false;
    } else {
        bindings.logoInput.classList.remove('is-invalid');
    }

    if (!valid) {
        return null;
    }

    const fields: Record<string, string> = {
        name: nameInput.value.trim(),
        email: emailInput.value.trim(),
        phone: `tel:${bindings.iti.getNumber()}`,
    };

    const optionals: [string, string][] = [
        ['city', (document.getElementById(`${p}-city`) as HTMLInputElement).value.trim()],
        ['state', (document.getElementById(`${p}-state`) as HTMLInputElement).value.trim().toUpperCase()],
        ['timezone', (document.getElementById(`${p}-timezone`) as HTMLSelectElement).value],
        ['website', (document.getElementById(`${p}-website`) as HTMLInputElement).value.trim()],
        ['facebook', (document.getElementById(`${p}-facebook`) as HTMLInputElement).value.trim()],
        ['instagram', (document.getElementById(`${p}-instagram`) as HTMLInputElement).value.trim()],
        ['youtube', (document.getElementById(`${p}-youtube`) as HTMLInputElement).value.trim()],
        ['tiktok', (document.getElementById(`${p}-tiktok`) as HTMLInputElement).value.trim()],
    ];
    for (const [key, val] of optionals) {
        if (val) {
            fields[key] = val;
        }
    }

    return fields;
}
