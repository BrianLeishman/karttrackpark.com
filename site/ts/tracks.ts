import axios from 'axios';
import { parsePhoneNumberWithError, ParseError } from 'libphonenumber-js';
import { Modal } from 'bootstrap';
import { api } from './api';
import { trackDetailUrl } from './track-detail';
import { trackFormFieldsHtml, bindTrackForm, collectTrackFields } from './track-form';

const assetsBase = document.querySelector<HTMLMetaElement>('meta[name="assets-base"]')?.content
    ?? 'https://assets.karttrackpark.com';

interface Track {
    track_id: string;
    name: string;
    logo_key: string;
    email: string;
    phone: string;
    city?: string;
    state?: string;
    timezone?: string;
    website?: string;
    facebook?: string;
    instagram?: string;
    youtube?: string;
    tiktok?: string;
    role: string;
    created_at: string;
}

async function fetchTracks(): Promise<Track[]> {
    try {
        const { data } = await api.get<Track[]>('/api/tracks');
        return data ?? [];
    } catch {
        return [];
    }
}

export async function getAssetUploadUrl(filename: string, contentType: string): Promise<{ upload_url: string; key: string }> {
    const { data } = await api.post<{ upload_url: string; key: string }>('/api/asset-url', {
        filename,
        content_type: contentType,
    });
    return data;
}

export async function uploadAsset(file: File): Promise<string> {
    const { upload_url: uploadUrl, key } = await getAssetUploadUrl(file.name, file.type);
    await axios.put(uploadUrl, file, {
        headers: { 'Content-Type': file.type },
    });
    return key;
}

async function createTrack(fields: {
    name: string;
    logo_key: string;
    email: string;
    phone: string;
    city?: string;
    state?: string;
    timezone?: string;
    website?: string;
    facebook?: string;
    instagram?: string;
    youtube?: string;
    tiktok?: string;
}): Promise<Track | null> {
    try {
        const { data } = await api.post<Track>('/api/tracks', fields);
        return data;
    } catch {
        return null;
    }
}

function renderTrackCard(track: Track): string {
    const location = [track.city, track.state].filter(Boolean).join(', ');
    const logoUrl = track.logo_key ? `${assetsBase}/${track.logo_key}` : '';
    return `
        <div class="col-md-6 col-lg-4">
            <a href="${trackDetailUrl(track.track_id, track.name)}" class="text-decoration-none text-body">
                <div class="card h-100">
                    <div class="card-body d-flex align-items-start gap-3">
                        ${logoUrl
                            ? `<img src="${logoUrl}" alt="" width="48" height="48" class="rounded flex-shrink-0" style="object-fit:cover">`
                            : '<div class="rounded bg-body-secondary flex-shrink-0 d-flex align-items-center justify-content-center" style="width:48px;height:48px"><i class="fa-solid fa-flag-checkered text-body-secondary"></i></div>'
                        }
                        <div class="min-w-0">
                            <h5 class="card-title mb-1">${track.name}</h5>
                            ${location ? `<p class="card-text text-body-secondary mb-1 small">${location}</p>` : ''}
                            <span class="badge text-bg-secondary">${track.role}</span>
                        </div>
                    </div>
                </div>
            </a>
        </div>
    `;
}

export function timezoneOptions(): string {
    const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const zones = Intl.supportedValuesOf('timeZone');
    return zones.map(tz =>
        `<option value="${tz}"${tz === userTz ? ' selected' : ''}>${tz.replace(/_/g, ' ')}</option>`,
    ).join('');
}

/**
 * Parse a user-entered phone string into RFC 3966 (tel:+...) format.
 * Returns null if the number is invalid.
 */
export function toRfc3966(raw: string): string | null {
    try {
        const pn = parsePhoneNumberWithError(raw, 'US');
        if (!pn.isValid()) {
            return null;
        }
        // pn.format('RFC3966') returns "tel:+1..."
        return pn.format('RFC3966');
    } catch (e) {
        if (e instanceof ParseError) {
            return null;
        }
        throw e;
    }
}

export async function renderMyTracks(container: HTMLElement): Promise<void> {
    container.innerHTML = '<div class="text-center py-4"><div class="spinner-border" role="status"></div></div>';

    const tracks = await fetchTracks();

    const trackCards = tracks.length > 0
        ? tracks.map(renderTrackCard).join('')
        : '';

    container.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-4">
            <h4 class="mb-0">My Tracks</h4>
            <button class="btn btn-primary btn-sm" data-bs-toggle="modal" data-bs-target="#create-track-modal">New Track</button>
        </div>
        <div class="alert alert-info small mb-4">
            This page is for track owners and operators. If you don't own or run a track, you're probably in the wrong place.
            If your track is already on Kart Track Park, ask your track admin or owner to send you an invite.
        </div>
        ${tracks.length > 0
            ? `<div class="row g-3">${trackCards}</div>`
            : '<p class="text-body-secondary">You don\'t have any tracks yet. Create one to get started.</p>'
        }

        <div class="modal fade" id="create-track-modal" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">New Track</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        ${trackFormFieldsHtml({ prefix: 'track', logoRequired: true, collapseSocials: true })}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" id="create-track-btn">Create</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    const bindings = bindTrackForm('track');

    // Create handler
    document.getElementById('create-track-btn')?.addEventListener('click', async () => {
        const fields = collectTrackFields('track', bindings, true);
        if (!fields) {
            return;
        }

        const btn = document.getElementById('create-track-btn') as HTMLButtonElement;
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Creating\u2026';

        try {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guaranteed by collectTrackFields with logoRequired: true
            const file = bindings.logoInput.files![0];
            const logoKey = await uploadAsset(file);
            fields.logo_key = logoKey;

            const track = await createTrack(fields as Parameters<typeof createTrack>[0]);
            if (track) {
                // Properly dismiss the modal before re-rendering to clean up the backdrop
                const modalEl = document.getElementById('create-track-modal');
                if (modalEl) {
                    const modal = Modal.getInstance(modalEl);
                    modal?.hide();
                    // Wait for the modal hidden transition to complete
                    await new Promise<void>(resolve => {
                        modalEl.addEventListener('hidden.bs.modal', () => resolve(), { once: true });
                    });
                }
                await renderMyTracks(container);
            }
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    });
}
