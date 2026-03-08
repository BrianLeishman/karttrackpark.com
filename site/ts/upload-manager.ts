import axios from 'axios';
import { api, apiBase } from './api';
import { esc, formatLapTime } from './html';

interface UploadLap {
    lap_no: number;
    lap_time_ms: number;
    max_speed?: number;
}

interface UploadItem {
    upload_id: string;
    uid: string;
    track_id?: string;
    event_id?: string;
    session_id?: string;
    filename: string;
    s3_key: string;
    status: string;
    error?: string;
    lap_count?: number;
    best_lap_ms?: number;
    total_time_ms?: number;
    session_time?: string;
    laps?: UploadLap[];
    metadata?: Record<string, string>;
    created_at: string;
}

interface SessionOption {
    session_id: string;
    session_name?: string;
    session_type?: string;
    session_order?: number;
    start_type?: string;
    lap_limit?: number;
}

export interface UploadManagerOptions {
    trackId: string;
    eventId?: string;
    sessionId?: string;
    onComplete?: () => void;
}

interface FileUpload {
    file: File;
    upload?: UploadItem;
    uploadUrl?: string;
    state: 'queued' | 'creating' | 'uploading' | 'processing' | 'complete' | 'error' | 'assigned';
    progress: number;
    error?: string;
    excludedLaps: Set<number>;
    expanded: boolean;
    selectedSession: string;
}

let currentModal: { show: () => void; hide: () => void } | null = null;
let activeUploads: FileUpload[] = [];
let pollInterval: ReturnType<typeof setInterval> | null = null;
let sessions: SessionOption[] = [];
let modalEl: HTMLElement | null = null;
let opts: UploadManagerOptions = { trackId: '' };

export async function openUploadManager(options: UploadManagerOptions): Promise<void> {
    opts = options;
    const bs = await import('bootstrap');

    if (opts.eventId) {
        try {
            const resp = await axios.get<SessionOption[]>(`${apiBase}/api/events/${opts.eventId}/sessions`);
            sessions = resp.data;
        } catch {
            sessions = [];
        }
    }

    activeUploads = [];

    if (!modalEl) {
        modalEl = document.createElement('div');
        modalEl.className = 'modal fade';
        modalEl.setAttribute('tabindex', '-1');
        document.body.appendChild(modalEl);
    }

    renderModal();
    currentModal = new bs.Modal(modalEl);
    currentModal.show();

    modalEl.addEventListener('hidden.bs.modal', () => {
        stopPolling();
    }, { once: true });
}

function autoExcludeLaps(u: FileUpload): void {
    u.excludedLaps.clear();
    const laps = u.upload?.laps;
    if (!laps || laps.length === 0) {
        return;
    }

    const session = sessions.find(s => s.session_id === u.selectedSession);
    const startType = session?.start_type ?? '';

    // Positional exclusions: first lap (unless standing start) and last lap
    if (laps.length > 2) {
        if (startType !== 'standing') {
            u.excludedLaps.add(laps[0].lap_no);
        }
        u.excludedLaps.add(laps[laps.length - 1].lap_no);
    }

    // Lap limit: if set, keep only the N fastest included laps
    if (session?.lap_limit && session.lap_limit > 0) {
        const included = laps.
            filter(l => !u.excludedLaps.has(l.lap_no)).
            sort((a, b) => a.lap_time_ms - b.lap_time_ms);
        const keep = new Set(included.slice(0, session.lap_limit).map(l => l.lap_no));
        for (const lap of laps) {
            if (!u.excludedLaps.has(lap.lap_no) && !keep.has(lap.lap_no)) {
                u.excludedLaps.add(lap.lap_no);
            }
        }
    }
}

function getIncludedLaps(u: FileUpload): UploadLap[] {
    return (u.upload?.laps ?? []).filter(l => !u.excludedLaps.has(l.lap_no));
}

function getIncludedStats(u: FileUpload): { count: number; bestMs: number; totalMs: number } {
    const included = getIncludedLaps(u);
    let bestMs = 0;
    let totalMs = 0;
    for (const l of included) {
        totalMs += l.lap_time_ms;
        if (bestMs === 0 || l.lap_time_ms < bestMs) {
            bestMs = l.lap_time_ms;
        }
    }
    return { count: included.length, bestMs, totalMs };
}

function renderModal(): void {
    if (!modalEl) {
        return;
    }

    const hasFiles = activeUploads.length > 0;
    const allDone = hasFiles && activeUploads.every(u => u.state === 'complete' || u.state === 'assigned' || u.state === 'error');
    const hasComplete = activeUploads.some(u => u.state === 'complete');
    const allAssigned = hasFiles && activeUploads.every(u => u.state === 'assigned' || u.state === 'error');

    modalEl.innerHTML = `
        <style>
            .um-remove-btn:hover { color: var(--bs-danger) !important; }
            .um-lap-row { transition: opacity 0.15s; }
            .um-lap-row.excluded { opacity: 0.45; }
            .um-lap-row.excluded td { text-decoration: line-through; text-decoration-color: var(--bs-secondary); }
            .um-lap-row .um-fastest { color: var(--bs-success); font-weight: 600; }
            .um-expand-btn { cursor: pointer; }
            .um-expand-btn:hover { color: var(--bs-primary) !important; }
            .um-lap-table { font-variant-numeric: tabular-nums; }
        </style>
        <div class="modal-dialog modal-lg modal-dialog-scrollable">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title"><i class="fa-solid fa-upload me-2"></i>Upload Laps</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <fieldset id="um-fieldset">
                <div class="modal-body">
                    ${!hasFiles ? renderDropZone() : renderUploadList()}
                </div>
                ${allDone ? `
                <div class="modal-footer">
                    ${!allAssigned && hasComplete ? `
                    <button type="button" class="btn btn-primary ms-auto" id="um-submit-btn"><i class="fa-solid fa-check me-1"></i>Submit</button>
                    ` : `
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    `}
                </div>` : ''}
                </fieldset>
            </div>
        </div>
    `;

    void wireModalEvents();
}

function renderDropZone(): string {
    return `
        <div id="um-dropzone" class="border border-2 border-dashed rounded-3 p-5 text-center" style="cursor:pointer">
            <i class="fa-solid fa-cloud-arrow-up fa-3x text-body-secondary mb-3 d-block"></i>
            <p class="mb-1 fw-semibold">Drag & drop .xrk files here</p>
            <p class="text-body-secondary small mb-3">or click to browse</p>
            <span class="badge text-bg-secondary">.xrk files only</span>
            <input type="file" id="um-file-input" multiple accept=".xrk" class="d-none">
        </div>
    `;
}

function renderUploadList(): string {
    return `
        <div class="list-group list-group-flush">
            ${activeUploads.map((u, i) => renderUploadRow(u, i)).join('')}
        </div>
    `;
}

function renderUploadRow(u: FileUpload, index: number): string {
    const statusIcon: Record<string, string> = {
        queued: '<i class="fa-solid fa-clock text-body-secondary"></i>',
        creating: '<span class="spinner-border spinner-border-sm text-primary"></span>',
        uploading: '<span class="spinner-border spinner-border-sm text-primary"></span>',
        processing: '<span class="spinner-border spinner-border-sm text-warning"></span>',
        complete: '<i class="fa-solid fa-check-circle text-success"></i>',
        assigned: '<i class="fa-solid fa-link text-primary"></i>',
        error: '<i class="fa-solid fa-circle-exclamation text-danger"></i>',
    };

    const canRemove = u.state === 'complete' || u.state === 'error' || u.state === 'assigned';
    const stats = getIncludedStats(u);
    const hasExcluded = u.excludedLaps.size > 0;

    let statusLabel = '';
    if (u.state === 'queued') {
        statusLabel = 'Queued';
    } else if (u.state === 'creating') {
        statusLabel = 'Preparing\u2026';
    } else if (u.state === 'uploading') {
        statusLabel = `Uploading ${String(u.progress)}%`;
    } else if (u.state === 'processing') {
        statusLabel = 'Processing\u2026';
    } else if (u.state === 'complete') {
        statusLabel = 'Ready';
    } else if (u.state === 'assigned') {
        statusLabel = 'Assigned';
    } else if (u.state === 'error') {
        statusLabel = u.error ?? 'Error';
    }

    let detailsHtml = '';
    if (u.state === 'complete' && u.upload) {
        const laps = u.upload.laps ?? [];
        const lapCountLabel = hasExcluded ?
            `${String(stats.count)}/${String(laps.length)} laps` :
            `${String(stats.count)} laps`;

        detailsHtml = `
            <div class="d-flex gap-3 mt-2 small text-body-secondary flex-wrap">
                ${u.upload.session_time ? `<span data-bs-toggle="tooltip" title="Session date"><i class="fa-solid fa-calendar me-1"></i>${formatSessionTime(u.upload.session_time)}</span>` : ''}
                ${laps.length > 0 ? `<span class="um-expand-btn text-body-secondary" data-index="${String(index)}" role="button"><i class="fa-solid fa-${u.expanded ? 'chevron-down' : 'chevron-right'} me-1"></i>${lapCountLabel}</span>` : ''}
                ${stats.bestMs ? `<span data-bs-toggle="tooltip" title="Best lap"><i class="fa-solid fa-stopwatch me-1"></i>${formatLapTime(stats.bestMs)}</span>` : ''}
                ${stats.totalMs ? `<span data-bs-toggle="tooltip" title="Total time"><i class="fa-solid fa-clock me-1"></i>${formatTotalTime(stats.totalMs)}</span>` : ''}
            </div>
            ${u.expanded ? renderLapTable(u, index) : ''}
            ${sessions.length > 0 ? `
            <div class="mt-2">
                <select class="form-select form-select-sm um-session-select" data-index="${String(index)}" style="max-width:250px">
                    <option value="">Assign to session\u2026</option>
                    ${sessions.map(s => `<option value="${s.session_id}" ${u.selectedSession === s.session_id ? 'selected' : ''}>${esc(s.session_name ?? s.session_type ?? 'Session')}</option>`).join('')}
                    <option disabled>\u2500\u2500\u2500</option>
                    <option value="__practice__" ${u.selectedSession === '__practice__' ? 'selected' : ''}>Practice (no session)</option>
                </select>
            </div>` : ''}
        `;
    }
    if (u.state === 'assigned' && u.upload?.session_id) {
        const sessionMatch = sessions.find(s => s.session_id === u.upload?.session_id);
        detailsHtml = `
            <div class="small text-body-secondary mt-1">
                <i class="fa-solid fa-check me-1"></i>Assigned to ${esc(sessionMatch?.session_name ?? sessionMatch?.session_type ?? 'session')}
            </div>
        `;
    }

    return `
        <div class="list-group-item">
            <div class="d-flex align-items-center gap-2">
                ${statusIcon[u.state] ?? ''}
                <div class="flex-grow-1">
                    <div class="d-flex justify-content-between align-items-center">
                        <span class="fw-semibold small">${esc(u.file.name)}</span>
                        <div class="d-flex align-items-center gap-2">
                            <span class="small text-body-secondary">${statusLabel}</span>
                            ${canRemove ? `<button class="btn btn-sm btn-link text-body-secondary p-0 um-remove-btn" data-index="${String(index)}" data-bs-toggle="tooltip" title="Remove"><i class="fa-solid fa-trash-can"></i></button>` : ''}
                        </div>
                    </div>
                    ${u.state === 'uploading' ? `
                    <div class="progress mt-1" style="height:4px">
                        <div class="progress-bar" style="width:${String(u.progress)}%"></div>
                    </div>` : ''}
                    ${u.state === 'error' ? `<div class="text-danger small mt-1">${esc(u.error ?? 'Unknown error')}</div>` : ''}
                </div>
            </div>
            ${detailsHtml}
        </div>
    `;
}

function renderLapTable(u: FileUpload, uploadIndex: number): string {
    const laps = u.upload?.laps ?? [];
    if (laps.length === 0) {
        return '';
    }

    const included = getIncludedLaps(u);
    const bestMs = included.length > 0 ? Math.min(...included.map(l => l.lap_time_ms)) : 0;
    const firstNo = laps[0].lap_no;
    const lastNo = laps[laps.length - 1].lap_no;
    const hasEdges = laps.length > 2;

    const rows = laps.map(lap => {
        const excluded = u.excludedLaps.has(lap.lap_no);
        const isFastest = !excluded && lap.lap_time_ms === bestMs;
        const isPartial = hasEdges && (lap.lap_no === firstNo || lap.lap_no === lastNo);

        return `
            <tr class="um-lap-row ${excluded ? 'excluded' : ''}">
                <td class="ps-0" style="width:28px">
                    <input type="checkbox" class="form-check-input um-lap-check"
                        data-upload="${String(uploadIndex)}" data-lap="${String(lap.lap_no)}"
                        ${excluded ? '' : 'checked'}>
                </td>
                <td class="text-body-secondary" style="width:40px">
                    ${String(lap.lap_no)}
                </td>
                <td class="${isFastest ? 'um-fastest' : ''}">
                    ${formatLapTime(lap.lap_time_ms)}
                    ${isPartial ? '<span class="badge text-bg-warning bg-opacity-25 text-warning-emphasis ms-1" style="font-size:.65em">partial</span>' : ''}
                    ${isFastest ? '<i class="fa-solid fa-trophy text-success ms-1" style="font-size:.7em"></i>' : ''}
                </td>
                <td class="text-end text-body-secondary text-nowrap" style="width:80px">
                    ${lap.max_speed ? `${String(lap.max_speed)} mph` : ''}
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="mt-2 ms-1">
            <table class="table table-sm table-borderless mb-0 small um-lap-table">
                <thead>
                    <tr class="text-body-secondary">
                        <th class="ps-0 fw-normal" style="width:28px">
                            <input type="checkbox" class="form-check-input um-lap-check-all" data-upload="${String(uploadIndex)}"
                                ${u.excludedLaps.size === 0 ? 'checked' : ''}>
                        </th>
                        <th class="fw-normal" style="width:40px">#</th>
                        <th class="fw-normal">Time</th>
                        <th class="fw-normal text-end text-nowrap" style="width:80px">Speed</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

async function wireModalEvents(): Promise<void> {
    if (!modalEl) {
        return;
    }

    const bs = await import('bootstrap');
    modalEl.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
        new bs.Tooltip(el);
    });

    // Drop zone
    const dropzone = modalEl.querySelector<HTMLElement>('#um-dropzone');
    const fileInput = modalEl.querySelector<HTMLInputElement>('#um-file-input');

    if (dropzone && fileInput) {
        dropzone.addEventListener('click', () => fileInput.click());

        dropzone.addEventListener('dragover', e => {
            e.preventDefault();
            dropzone.classList.add('border-primary', 'bg-primary-subtle');
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('border-primary', 'bg-primary-subtle');
        });

        dropzone.addEventListener('drop', e => {
            e.preventDefault();
            dropzone.classList.remove('border-primary', 'bg-primary-subtle');
            if (e.dataTransfer?.files) {
                handleFiles(e.dataTransfer.files);
            }
        });

        fileInput.addEventListener('change', () => {
            if (fileInput.files) {
                handleFiles(fileInput.files);
            }
        });
    }

    // Expand/collapse lap list
    modalEl.querySelectorAll('.um-expand-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!(btn instanceof HTMLElement)) {
                return;
            }
            const idx = parseInt(btn.dataset.index ?? '', 10);
            if (isNaN(idx)) {
                return;
            }
            activeUploads[idx].expanded = !activeUploads[idx].expanded;
            renderModal();
        });
    });

    // Individual lap checkboxes
    modalEl.querySelectorAll('.um-lap-check').forEach(cb => {
        cb.addEventListener('change', () => {
            if (!(cb instanceof HTMLInputElement) || !(cb instanceof HTMLElement)) {
                return;
            }
            const uploadIdx = parseInt(cb.dataset.upload ?? '', 10);
            const lapNo = parseInt(cb.dataset.lap ?? '', 10);
            if (isNaN(uploadIdx) || isNaN(lapNo)) {
                return;
            }
            const u = activeUploads[uploadIdx];
            if (cb.checked) {
                u.excludedLaps.delete(lapNo);
            } else {
                u.excludedLaps.add(lapNo);
            }
            renderModal();
        });
    });

    // Select-all checkbox
    modalEl.querySelectorAll('.um-lap-check-all').forEach(cb => {
        cb.addEventListener('change', () => {
            if (!(cb instanceof HTMLInputElement) || !(cb instanceof HTMLElement)) {
                return;
            }
            const uploadIdx = parseInt(cb.dataset.upload ?? '', 10);
            if (isNaN(uploadIdx)) {
                return;
            }
            const u = activeUploads[uploadIdx];
            if (cb.checked) {
                u.excludedLaps.clear();
            } else {
                for (const lap of u.upload?.laps ?? []) {
                    u.excludedLaps.add(lap.lap_no);
                }
            }
            renderModal();
        });
    });

    // Session select persistence + re-run auto-exclude based on session hints
    modalEl.querySelectorAll('.um-session-select').forEach(sel => {
        sel.addEventListener('change', () => {
            if (!(sel instanceof HTMLSelectElement) || !(sel instanceof HTMLElement)) {
                return;
            }
            const idx = parseInt(sel.dataset.index ?? '', 10);
            if (!isNaN(idx) && activeUploads[idx]) {
                activeUploads[idx].selectedSession = sel.value;
                autoExcludeLaps(activeUploads[idx]);
                renderModal();
            }
        });
    });

    // Remove buttons
    modalEl.querySelectorAll('.um-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!(btn instanceof HTMLElement)) {
                return;
            }
            const index = parseInt(btn.dataset.index ?? '', 10);
            if (isNaN(index)) {
                return;
            }
            removeUpload(index);
        });
    });

    // Submit button
    modalEl.querySelector('#um-submit-btn')?.addEventListener('click', () => {
        void submitAll();
    });
}

function handleFiles(fileList: FileList): void {
    const xrkFiles = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.xrk'));
    if (xrkFiles.length === 0) {
        return;
    }

    for (const file of xrkFiles) {
        activeUploads.push({
            file,
            state: 'queued',
            progress: 0,
            excludedLaps: new Set(),
            expanded: false,
            selectedSession: opts.sessionId ?? '',
        });
    }

    renderModal();
    void processQueue();
}

async function processQueue(): Promise<void> {
    const queued = activeUploads.filter(u => u.state === 'queued');

    for (const upload of queued) {
        upload.state = 'creating';
        renderModal();

        try {
            const { data } = await api.post<{ upload: UploadItem; upload_url: string }>('/api/uploads', {
                track_id: opts.trackId,
                event_id: opts.eventId ?? '',
                filename: upload.file.name,
            });

            upload.upload = data.upload;
            upload.uploadUrl = data.upload_url;
            upload.state = 'uploading';
            renderModal();

            await axios.put(data.upload_url, upload.file, {
                headers: { 'Content-Type': 'application/octet-stream' },
                onUploadProgress: e => {
                    if (e.total) {
                        upload.progress = Math.round((e.loaded / e.total) * 100);
                        const idx = activeUploads.indexOf(upload);
                        const bar = modalEl?.querySelector<HTMLElement>(`.list-group-item:nth-child(${String(idx + 1)}) .progress-bar`);
                        const statusSpan = modalEl?.querySelector<HTMLElement>(`.list-group-item:nth-child(${String(idx + 1)}) .text-body-secondary`);
                        if (bar) {
                            bar.style.width = `${String(upload.progress)}%`;
                        }
                        if (statusSpan) {
                            statusSpan.textContent = `Uploading ${String(upload.progress)}%`;
                        }
                    }
                },
            });

            await api.post(`/api/uploads/${data.upload.upload_id}/ingest`);

            upload.state = 'processing';
            upload.progress = 100;
            renderModal();
        } catch (err: unknown) {
            upload.state = 'error';
            if (axios.isAxiosError<{ error?: string }>(err) && typeof err.response?.data?.error === 'string') {
                upload.error = err.response.data.error;
            } else {
                upload.error = 'Upload failed';
            }
            renderModal();
        }
    }

    startPolling();
}

function startPolling(): void {
    if (pollInterval) {
        return;
    }
    pollInterval = setInterval(async () => {
        const processing = activeUploads.filter(u => u.state === 'processing' && u.upload);
        if (processing.length === 0) {
            stopPolling();
            return;
        }

        for (const u of processing) {
            if (!u.upload) {
                continue;
            }
            try {
                const { data } = await api.get<UploadItem>(`/api/uploads/${u.upload.upload_id}`);
                u.upload = data;

                if (data.status === 'complete') {
                    u.state = 'complete';
                    autoExcludeLaps(u);
                } else if (data.status === 'error') {
                    u.state = 'error';
                    u.error = data.error ?? 'Processing failed';
                }
            } catch {
                // Keep polling on network errors
            }
        }

        renderModal();
    }, 2000);
}

function stopPolling(): void {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

function removeUpload(index: number): void {
    const u = activeUploads[index];
    if (!u) {
        return;
    }

    activeUploads.splice(index, 1);
    renderModal();

    const toastId = `um-undo-toast-${String(Date.now())}`;
    const toast = document.createElement('div');
    toast.id = toastId;
    toast.className = 'alert alert-success alert-dismissible position-fixed bottom-0 end-0 m-3 d-flex align-items-center gap-2';
    toast.style.zIndex = '9999';
    toast.innerHTML = `
        <span>Removed <strong>${esc(u.file.name)}</strong></span>
        <a href="#" class="alert-link ms-2" id="${toastId}-undo">Undo</a>
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    document.body.appendChild(toast);

    let undone = false;
    const timeout = setTimeout(() => {
        if (!undone && u.upload) {
            api.delete(`/api/uploads/${u.upload.upload_id}`).catch(() => { /* best effort */ });
        }
        toast.remove();
    }, 5000);

    toast.querySelector(`#${toastId}-undo`)?.addEventListener('click', e => {
        e.preventDefault();
        undone = true;
        clearTimeout(timeout);
        toast.remove();
        activeUploads.push(u);
        renderModal();
    });
}

async function getOrCreatePracticeSession(): Promise<string | null> {
    if (!opts.eventId) {
        return null;
    }
    // Check if a practice session already exists
    const existing = sessions.find(s => s.session_type === 'practice' && s.session_name === 'Practice');
    if (existing) {
        return existing.session_id;
    }
    // Create one
    const resp = await api.post<{ session_id: string }>(`/api/events/${opts.eventId}/sessions`, {
        session_name: 'Practice',
        session_type: 'practice',
        session_order: 0,
    });
    const newId = resp.data.session_id;
    sessions.push({ session_id: newId, session_name: 'Practice', session_type: 'practice', session_order: 0 });
    return newId;
}

async function submitAll(): Promise<void> {
    if (!modalEl) {
        return;
    }
    const fieldset = modalEl.querySelector<HTMLFieldSetElement>('#um-fieldset');
    const submitBtn = modalEl.querySelector<HTMLButtonElement>('#um-submit-btn');
    if (fieldset) {
        fieldset.disabled = true;
    }
    if (submitBtn) {
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Submitting\u2026';
    }

    const toAssign = activeUploads.filter(u => u.state === 'complete' && u.upload);
    for (const u of toAssign) {
        if (!u.upload) {
            continue;
        }
        if (!u.selectedSession) {
            continue;
        }
        let sessionId = u.selectedSession;
        if (sessionId === '__practice__') {
            try {
                const practiceId = await getOrCreatePracticeSession();
                if (!practiceId) {
                    u.error = 'Could not create practice session';
                    continue;
                }
                sessionId = practiceId;
            } catch {
                u.error = 'Could not create practice session';
                continue;
            }
        }
        const includedLaps = getIncludedLaps(u).map(l => l.lap_no);
        try {
            await api.post(`/api/uploads/${u.upload.upload_id}/assign`, {
                session_id: sessionId,
                included_laps: includedLaps,
            });
            u.state = 'assigned';
            u.upload.session_id = sessionId;
        } catch (err: unknown) {
            let msg = 'Failed to assign';
            if (axios.isAxiosError<{ error?: string }>(err) && typeof err.response?.data?.error === 'string') {
                msg = err.response.data.error;
            }
            u.error = msg;
        }
    }
    // If anything was assigned, close the modal and notify the caller
    const anyAssigned = activeUploads.some(u => u.state === 'assigned');
    if (anyAssigned) {
        currentModal?.hide();
        if (opts.onComplete) {
            opts.onComplete();
        }
    } else {
        renderModal();
    }
}

function formatTotalTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

function formatSessionTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) +
        ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}
