import axios from 'axios';
import { api, apiBase } from './api';
import { getUser } from './auth';
import { trackDetailUrl } from './url-utils';
import { showLayoutModal, showClassModal, showFormatModal } from './track-detail';
import type { Layout, KartClass, Format } from './track-detail';
import type { TrackAnnotation } from './track-form';
import { trackFormFieldsHtml, bindTrackForm, collectTrackFields, setTrackFormTimezone, boundsMapHtml, bindBoundsMap, turnsMapHtml, bindTurnsMap } from './track-form';
import type { TurnsMapBindings } from './track-form';
import { esc, emptyState, typeLabel } from './html';
import { uploadAsset } from './tracks';

interface Track {
    track_id: string;
    name: string;
    logo_key: string;
    map_bounds?: string;
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
    turns?: TrackAnnotation[];
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
    let layouts: Layout[];
    let classes: KartClass[];
    let formats: Format[];

    try {
        const [trackResp, layoutsResp, classesResp, formatsResp] = await Promise.all([
            api.get<Track>(`/api/tracks/${trackId}`),
            axios.get<Layout[]>(`${apiBase}/api/tracks/${trackId}/layouts`).catch((): { data: Layout[] } => ({ data: [] })),
            axios.get<KartClass[]>(`${apiBase}/api/tracks/${trackId}/classes`).catch((): { data: KartClass[] } => ({ data: [] })),
            axios.get<Format[]>(`${apiBase}/api/tracks/${trackId}/formats`).catch((): { data: Format[] } => ({ data: [] })),
        ]);
        track = trackResp.data;
        layouts = layoutsResp.data;
        classes = classesResp.data;
        formats = formatsResp.data;
    } catch {
        window.location.href = '/my/tracks/';
        return;
    }

    // Get default layout for turn placement
    const defaultLayout = layouts.find(l => l.is_default) ?? layouts[0];

    container.innerHTML = `
        <div class="mx-auto" style="max-width:720px">
            <div class="d-flex align-items-center gap-2 mb-4">
                <h4 class="mb-0">Track Settings</h4>
                <a href="${trackDetailUrl(track.track_id, track.name)}" class="btn btn-sm btn-outline-secondary ms-auto"><i class="fa-solid fa-arrow-left me-1"></i>Back</a>
            </div>
            <ul class="nav nav-tabs mb-4" id="settings-tabs" role="tablist">
                <li class="nav-item" role="presentation">
                    <button class="nav-link active" id="tab-general" data-bs-toggle="tab" data-bs-target="#pane-general" type="button" role="tab">General</button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link" id="tab-turns" data-bs-toggle="tab" data-bs-target="#pane-turns" type="button" role="tab">Turns</button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link" id="tab-layouts" data-bs-toggle="tab" data-bs-target="#pane-layouts" type="button" role="tab">Layouts</button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link" id="tab-classes" data-bs-toggle="tab" data-bs-target="#pane-classes" type="button" role="tab">Classes</button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link" id="tab-formats" data-bs-toggle="tab" data-bs-target="#pane-formats" type="button" role="tab">Formats</button>
                </li>
            </ul>
            <div class="tab-content">
                <!-- General Tab -->
                <div class="tab-pane fade show active" id="pane-general" role="tabpanel">
                    ${trackFormFieldsHtml({ prefix: 'edit', values: track, collapseSocials: false })}
                    <div class="mb-3">
                        <label class="form-label">Track Location</label>
                        ${boundsMapHtml('edit')}
                    </div>
                    <div class="d-flex align-items-center gap-2">
                        <button type="button" class="btn btn-primary" id="save-track-btn">Save</button>
                        <span id="save-status" class="ms-1"></span>
                    </div>
                </div>

                <!-- Turns Tab -->
                <div class="tab-pane fade" id="pane-turns" role="tabpanel">
                    <p class="text-body-secondary small mb-3">Turn numbers belong to the track and stay the same across layouts. Click a turn marker to edit its number or nickname.</p>
                    ${turnsMapHtml('turns')}
                    <div class="d-flex align-items-center gap-2 mt-3">
                        <button type="button" class="btn btn-primary" id="save-turns-btn">Save Turns</button>
                        <span id="save-turns-status" class="ms-1"></span>
                    </div>
                </div>

                <!-- Layouts Tab -->
                <div class="tab-pane fade" id="pane-layouts" role="tabpanel">
                    <div class="d-flex align-items-center mb-3">
                        <button class="btn btn-sm btn-primary ms-auto" id="new-layout-btn"><i class="fa-solid fa-plus me-1"></i>New Layout</button>
                    </div>
                    <div class="row g-3" id="layouts-list">
                        ${layouts.length > 0 ?
                            layouts.map(l => `
                                <div class="col-md-6">
                                    <div class="card h-100 layout-card" data-layout-id="${l.layout_id}" role="button">
                                        <div class="card-body">
                                            <div class="d-flex align-items-center gap-2 mb-1">
                                                <i class="fa-solid fa-route text-primary-emphasis" style="font-size:.9rem"></i>
                                                <h5 class="card-title mb-0">${esc(l.name)}</h5>
                                                ${l.is_default ? '<span class="badge text-bg-success">Default</span>' : ''}
                                                <button type="button" class="btn btn-sm btn-outline-secondary ms-auto layout-dup-btn" data-layout-id="${l.layout_id}" title="Duplicate"><i class="fa-solid fa-copy"></i></button>
                                            </div>
                                            <p class="card-text text-body-secondary small mb-0">${l.track_outline ? 'Has outline' : 'No outline'}</p>
                                        </div>
                                    </div>
                                </div>`).join('') :
                            emptyState('No layouts yet.')}
                    </div>
                </div>

                <!-- Classes Tab -->
                <div class="tab-pane fade" id="pane-classes" role="tabpanel">
                    <div class="d-flex align-items-center mb-3">
                        <button class="btn btn-sm btn-primary ms-auto" id="new-class-btn"><i class="fa-solid fa-plus me-1"></i>New Class</button>
                    </div>
                    <div class="row g-3" id="classes-list">
                        ${classes.length > 0 ?
                            classes.map(kc => {
                                const details = [kc.chassis, kc.engine].filter(Boolean).join(' · ');
                                return `
                                <div class="col-md-6">
                                    <div class="card h-100 class-card" data-class-id="${kc.class_id}" role="button">
                                        <div class="card-body">
                                            <div class="d-flex align-items-center gap-2 mb-1">
                                                <i class="fa-solid fa-helmet-safety text-primary-emphasis" style="font-size:.9rem"></i>
                                                <h5 class="card-title mb-0">${esc(kc.name)}</h5>
                                                ${kc.is_default ? '<span class="badge text-bg-success">Default</span>' : ''}
                                            </div>
                                            ${details ? `<p class="card-text text-body-secondary small mb-0">${esc(details)}</p>` : ''}
                                            ${kc.description ? `<p class="card-text text-body-secondary small mb-0">${esc(kc.description)}</p>` : ''}
                                        </div>
                                    </div>
                                </div>`;
                            }).join('') :
                            emptyState('No classes yet.')}
                    </div>
                </div>

                <!-- Formats Tab -->
                <div class="tab-pane fade" id="pane-formats" role="tabpanel">
                    <div class="d-flex align-items-center mb-3">
                        <button class="btn btn-sm btn-primary ms-auto" id="new-format-btn"><i class="fa-solid fa-plus me-1"></i>New Format</button>
                    </div>
                    <div class="row g-3" id="formats-list">
                        ${formats.length > 0 ?
                            formats.map(f => `
                                <div class="col-md-6">
                                    <div class="card h-100 format-card" data-format-id="${f.format_id}" role="button">
                                        <div class="card-body">
                                            <div class="d-flex align-items-center gap-2 mb-1">
                                                <i class="fa-solid fa-list-ol text-primary-emphasis" style="font-size:.9rem"></i>
                                                <h5 class="card-title mb-0">${esc(f.name)}</h5>
                                            </div>
                                            ${f.sessions.length > 0 ? `
                                            <div class="small text-body-secondary mt-2">
                                                ${f.sessions.map((s, i) => `<div class="d-flex align-items-center gap-2 py-1${i < f.sessions.length - 1 ? ' border-bottom' : ''}">
                                                    <span class="font-monospace" style="min-width:1.2rem">${i + 1}.</span>
                                                    <span>${esc(s.session_name || typeLabel(s.session_type))}</span>
                                                    <span class="badge text-bg-secondary" style="font-size:.65rem">${s.session_type.replace('_', ' ')}</span>
                                                    ${s.duration ? `<span class="ms-auto text-nowrap">${s.duration} min</span>` : ''}
                                                    ${s.lap_count ? `<span class="${s.duration ? '' : 'ms-auto '}text-nowrap">${s.lap_count} lap${s.lap_count !== 1 ? 's' : ''}</span>` : ''}
                                                </div>`).join('')}
                                            </div>` : '<p class="card-text text-body-secondary small mb-0">No sessions</p>'}
                                        </div>
                                    </div>
                                </div>`).join('') :
                            emptyState('No formats yet.')}
                    </div>
                </div>
            </div>
        </div>
    `;

    // --- General tab bindings ---
    const bindings = bindTrackForm('edit', track.phone || undefined);
    const mapBindings = bindBoundsMap('edit', track.map_bounds);
    if (track.timezone) {
        setTrackFormTimezone('edit', track.timezone);
    }

    document.getElementById('save-track-btn')?.addEventListener('click', async () => {
        const fields = collectTrackFields('edit', bindings, false);
        if (!fields) {
            return;
        }

        const btn = document.getElementById('save-track-btn');
        if (!(btn instanceof HTMLButtonElement)) {
            return;
        }
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving\u2026';
        const status = document.getElementById('save-status');

        try {
            const logo = bindings.croppedBlob ?? bindings.logoInput.files?.[0];
            if (logo) {
                fields.logoKey = await uploadAsset(logo);
            }
            fields.mapBounds = JSON.stringify(mapBindings.getMapBounds());
            await api.put(`/api/tracks/${trackId}`, fields);
            btn.disabled = false;
            btn.textContent = 'Save';
            if (status) {
                status.innerHTML = '<i class="fa-solid fa-check text-success"></i>';
                setTimeout(() => {
                    status.innerHTML = ''; 
                }, 2000);
            }
        } catch {
            btn.disabled = false;
            btn.textContent = 'Save';
            if (status) {
                status.innerHTML = '<span class="text-danger small">Failed to save</span>';
                setTimeout(() => {
                    status.innerHTML = ''; 
                }, 3000);
            }
        }
    });

    // --- Turns tab bindings ---
    let turnsMapBindings: TurnsMapBindings | null = null;

    // Lazy-init turns map when tab is shown, resize on every switch
    document.getElementById('tab-turns')?.addEventListener('shown.bs.tab', () => {
        if (!turnsMapBindings) {
            turnsMapBindings = bindTurnsMap('turns', {
                track_outline: defaultLayout?.track_outline,
                map_bounds: track.map_bounds,
                turns: track.turns,
            });
        }
        turnsMapBindings?.invalidateSize();
    });

    document.getElementById('save-turns-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('save-turns-btn');
        if (!(btn instanceof HTMLButtonElement)) {
            return;
        }
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Saving\u2026';
        const status = document.getElementById('save-turns-status');

        try {
            await api.put(`/api/tracks/${trackId}`, {
                turns: turnsMapBindings?.turns ?? [],
            });
            btn.disabled = false;
            btn.textContent = 'Save Turns';
            if (status) {
                status.innerHTML = '<i class="fa-solid fa-check text-success"></i>';
                setTimeout(() => {
                    status.innerHTML = ''; 
                }, 2000);
            }
        } catch {
            btn.disabled = false;
            btn.textContent = 'Save Turns';
            if (status) {
                status.innerHTML = '<span class="text-danger small">Failed to save</span>';
                setTimeout(() => {
                    status.innerHTML = ''; 
                }, 3000);
            }
        }
    });

    // --- Layouts tab bindings ---
    const reloadPage = async () => {
        await renderTrackEdit(container);
    };

    document.getElementById('new-layout-btn')?.addEventListener('click', () => {
        showLayoutModal(trackId, track.map_bounds, layouts, undefined, reloadPage, false, track.turns);
    });

    document.querySelectorAll('.layout-card').forEach(card => {
        card.addEventListener('click', e => {
            if (!(card instanceof HTMLElement)) {
                return;
            }
            if (e.target instanceof HTMLElement && e.target.closest('.layout-dup-btn')) {
                return;
            }
            const layoutId = card.dataset.layoutId;
            if (!layoutId) {
                return;
            }
            const layout = layouts.find(l => l.layout_id === layoutId);
            if (layout) {
                showLayoutModal(trackId, track.map_bounds, layouts, layout, reloadPage, false, track.turns);
            }
        });
    });

    document.querySelectorAll('.layout-dup-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!(btn instanceof HTMLElement)) {
                return;
            }
            const layoutId = btn.dataset.layoutId;
            if (!layoutId) {
                return;
            }
            const layout = layouts.find(l => l.layout_id === layoutId);
            if (layout) {
                showLayoutModal(trackId, track.map_bounds, layouts, layout, reloadPage, true, track.turns);
            }
        });
    });

    // --- Classes tab bindings ---
    document.getElementById('new-class-btn')?.addEventListener('click', () => {
        showClassModal(trackId, classes, undefined, reloadPage);
    });

    document.querySelectorAll('.class-card').forEach(card => {
        card.addEventListener('click', () => {
            if (!(card instanceof HTMLElement)) {
                return;
            }
            const classId = card.dataset.classId;
            if (!classId) {
                return;
            }
            const kc = classes.find(c => c.class_id === classId);
            if (kc) {
                showClassModal(trackId, classes, kc, reloadPage);
            }
        });
    });

    // --- Formats tab bindings ---
    document.getElementById('new-format-btn')?.addEventListener('click', () => {
        showFormatModal(trackId, layouts, classes, undefined, reloadPage);
    });

    document.querySelectorAll('.format-card').forEach(card => {
        card.addEventListener('click', () => {
            if (!(card instanceof HTMLElement)) {
                return;
            }
            const formatId = card.dataset.formatId;
            if (!formatId) {
                return;
            }
            const format = formats.find(f => f.format_id === formatId);
            if (format) {
                showFormatModal(trackId, layouts, classes, format, reloadPage);
            }
        });
    });

    // Preserve tab selection via URL hash
    const hash = window.location.hash.replace('#', '');
    if (hash) {
        const tabBtn = document.getElementById(`tab-${hash}`);
        if (tabBtn instanceof HTMLButtonElement) {
            tabBtn.click();
        }
    }
    document.querySelectorAll('#settings-tabs .nav-link').forEach(btn => {
        btn.addEventListener('shown.bs.tab', () => {
            const target = btn.getAttribute('data-bs-target');
            if (target) {
                const tabName = target.replace('#pane-', '');
                window.history.replaceState(null, '', `#${tabName}`);
            }
        });
    });
}
