import { api } from './api';
import { getUser } from './auth';
import { trackDetailUrl } from './track-detail';
import { trackFormFieldsHtml, bindTrackForm, collectTrackFields, setTrackFormTimezone } from './track-form';
import { uploadAsset } from './tracks';

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

export async function renderTrackEdit(container: HTMLElement): Promise<void> {
    const trackId = new URLSearchParams(window.location.search).get('id');
    if (!trackId || !getUser()) {
        window.location.href = '/my/tracks/';
        return;
    }

    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';

    let track: Track;
    try {
        const { data } = await api.get<Track>(`/api/tracks/${trackId}`);
        track = data;
    } catch {
        window.location.href = '/my/tracks/';
        return;
    }

    container.innerHTML = `
        <div class="mx-auto" style="max-width:600px">
            <h4 class="mb-4">Edit Track</h4>
            ${trackFormFieldsHtml({ prefix: 'edit', values: track, collapseSocials: false })}
            <div class="d-flex gap-2">
                <button type="button" class="btn btn-primary" id="save-track-btn">Save</button>
                <a href="${trackDetailUrl(track.track_id, track.name)}" class="btn btn-secondary">Cancel</a>
            </div>
        </div>
    `;

    const bindings = bindTrackForm('edit', track.phone || undefined);
    if (track.timezone) {
        setTrackFormTimezone('edit', track.timezone);
    }

    // Save handler
    document.getElementById('save-track-btn')?.addEventListener('click', async () => {
        const fields = collectTrackFields('edit', bindings, false);
        if (!fields) {
            return;
        }

        const btn = document.getElementById('save-track-btn') as HTMLButtonElement;
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving\u2026';

        try {
            // Upload new logo if selected
            const logo = bindings.croppedBlob ?? bindings.logoInput.files?.[0];
            if (logo) {
                fields.logoKey = await uploadAsset(logo);
            }

            await api.put(`/api/tracks/${trackId}`, fields);
            window.location.href = trackDetailUrl(trackId, fields.name);
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    });
}
