import { esc, formatLapTime } from './html';
import { lapAnalysisUrl } from './url-utils';

// ─── Types ───

export interface AnalyzeLap {
    sessionId: string;
    sessionName: string;
    uid: string;
    driverName: string;
    lapNo: number;
    lapTimeMs: number;
    championshipName?: string;
    seriesName?: string;
    eventName?: string;
}

const STORAGE_KEY = 'ktp-analyze-laps';
const COLLAPSED_KEY = 'ktp-analyze-collapsed';

function isAnalyzeLap(v: unknown): v is AnalyzeLap {
    if (typeof v !== 'object' || v === null) {
        return false;
    }
    return 'sessionId' in v && typeof v.sessionId === 'string' &&
        'uid' in v && typeof v.uid === 'string' &&
        'lapNo' in v && typeof v.lapNo === 'number';
}

// ─── LocalStorage helpers ───

export function getAnalyzeLaps(): AnalyzeLap[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return [];
        }
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter((v): v is AnalyzeLap =>
            isAnalyzeLap(v),
        );
    } catch {
        return [];
    }
}

function saveAnalyzeLaps(laps: AnalyzeLap[]): void {
    if (laps.length === 0) {
        localStorage.removeItem(STORAGE_KEY);
    } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(laps));
    }
}

function lapKey(lap: AnalyzeLap): string {
    return `${lap.sessionId}:${lap.uid}:${String(lap.lapNo)}`;
}

export function isLapInAnalyze(sessionId: string, uid: string, lapNo: number): boolean {
    const laps = getAnalyzeLaps();
    const key = `${sessionId}:${uid}:${String(lapNo)}`;
    return laps.some(l => lapKey(l) === key);
}

export function addLapToAnalyze(lap: AnalyzeLap): void {
    const laps = getAnalyzeLaps();
    const key = lapKey(lap);
    if (laps.some(l => lapKey(l) === key)) {
        return;
    }
    laps.push(lap);
    saveAnalyzeLaps(laps);
    renderTray();
}

export function removeLapFromAnalyze(sessionId: string, uid: string, lapNo: number): void {
    const laps = getAnalyzeLaps();
    const key = `${sessionId}:${uid}:${String(lapNo)}`;
    saveAnalyzeLaps(laps.filter(l => lapKey(l) !== key));
    renderTray();
}

export function clearAnalyzeLaps(): void {
    saveAnalyzeLaps([]);
    renderTray();
}

// ─── URL builder ───

function buildAnalyzeUrl(laps: AnalyzeLap[]): string {
    if (laps.length === 0) {
        return '#';
    }
    const primary = laps[0];
    if (!primary) {
        return '#';
    }

    const base = lapAnalysisUrl(primary.sessionId, primary.sessionName, primary.uid, primary.driverName, primary.lapNo);

    if (laps.length <= 1) {
        return base;
    }

    const compareParams = laps.slice(1).map(
        l => `compare=${encodeURIComponent(`${l.sessionId},${l.uid},${String(l.lapNo)}`)}`,
    );
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}${compareParams.join('&')}`;
}

// ─── Tray UI (right-side collapsible panel) ───

let trayEl: HTMLElement | null = null;
let dragSrcIdx: number | null = null;

function isCollapsed(): boolean {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
}

function setCollapsed(val: boolean): void {
    if (val) {
        localStorage.setItem(COLLAPSED_KEY, '1');
    } else {
        localStorage.removeItem(COLLAPSED_KEY);
    }
}

export function renderTray(): void {
    // Hide tray on the analysis page itself
    if (document.querySelector('main.analysis-fullscreen')) {
        if (trayEl) {
            trayEl.remove();
            trayEl = null;
        }
        return;
    }

    const laps = getAnalyzeLaps();

    if (laps.length === 0) {
        if (trayEl) {
            trayEl.remove();
            trayEl = null;
        }
        return;
    }

    const collapsed = isCollapsed();

    if (!trayEl) {
        trayEl = document.createElement('div');
        trayEl.className = 'analyze-tray';
        document.body.appendChild(trayEl);

        // Attach delegated click handler once (persists across re-renders)
        trayEl.addEventListener('click', e => {
            if (!(e.target instanceof HTMLElement)) {
                return;
            }
            const removeBtn = e.target.closest<HTMLElement>('[data-remove-idx]');
            if (removeBtn) {
                const idx = parseInt(removeBtn.dataset.removeIdx ?? '', 10);
                const current = getAnalyzeLaps();
                const lap = current[idx];
                if (lap) {
                    removeLapFromAnalyze(lap.sessionId, lap.uid, lap.lapNo);
                }
                return;
            }
            if (e.target.closest('#analyze-tray-clear')) {
                clearAnalyzeLaps();
            }
        });
    }

    trayEl.classList.toggle('collapsed', collapsed);

    const lapItems = laps.map((l, i) => {
        const contextParts: string[] = [];
        if (l.championshipName) {
            contextParts.push(esc(l.championshipName));
        }
        if (l.seriesName) {
            contextParts.push(esc(l.seriesName));
        }
        if (l.eventName) {
            contextParts.push(esc(l.eventName));
        }
        contextParts.push(esc(l.sessionName));
        const contextLine = contextParts.join(' › ');
        return `
        <div class="analyze-tray-lap" draggable="true" data-idx="${String(i)}">
            <i class="fa-solid fa-grip-vertical analyze-tray-grip"></i>
            <div class="analyze-tray-lap-info">
                <div class="fw-semibold font-monospace">${formatLapTime(l.lapTimeMs)}</div>
                <div class="text-body-secondary">Lap ${String(l.lapNo)} &middot; ${esc(l.driverName)}</div>
                <div class="text-body-secondary" style="font-size:.65rem" title="${contextLine}">${contextLine}</div>
            </div>
            <button class="btn-close" style="font-size:.5rem" data-remove-idx="${String(i)}" aria-label="Remove"></button>
        </div>`;
    }).join('');

    const analyzeUrl = buildAnalyzeUrl(laps);

    trayEl.innerHTML = `
        <button class="analyze-tray-tab" title="Analyze (${String(laps.length)} laps)">
            <span class="analyze-tray-tab-content">
                <i class="fa-solid fa-chart-line"></i>
                <span>Analyze</span>
                <span class="analyze-tray-badge">${String(laps.length)}</span>
            </span>
        </button>
        <div class="analyze-tray-body">
            <div class="analyze-tray-list">${lapItems}</div>
            <div class="analyze-tray-footer">
                <a href="${analyzeUrl}" class="btn btn-sm btn-primary w-100">
                    <i class="fa-solid fa-chart-line me-1"></i>Analyze${laps.length > 1 ? ` (${String(laps.length)})` : ''}
                </a>
                <button class="btn btn-sm btn-outline-secondary w-100" id="analyze-tray-clear">
                    <i class="fa-solid fa-xmark me-1"></i>Clear all
                </button>
            </div>
        </div>`;

    // Tab toggles open/closed
    trayEl.querySelector('.analyze-tray-tab')?.addEventListener('click', () => {
        setCollapsed(!isCollapsed());
        renderTray();
    });

    // Drag-and-drop reorder
    const listEl = trayEl.querySelector('.analyze-tray-list');
    if (listEl) {
        listEl.addEventListener('dragstart', e => {
            const target = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.analyze-tray-lap') : null;
            if (!target) {
                return;
            }
            dragSrcIdx = parseInt(target.dataset.idx ?? '', 10);
            target.classList.add('dragging');
            if ('dataTransfer' in e) {
                const dt = e.dataTransfer;
                if (dt instanceof DataTransfer) {
                    dt.effectAllowed = 'move';
                }
            }
        });

        listEl.addEventListener('dragend', e => {
            const target = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.analyze-tray-lap') : null;
            if (target) {
                target.classList.remove('dragging');
            }
            dragSrcIdx = null;
            for (const el of Array.from(listEl.querySelectorAll('.drag-over'))) {
                el.classList.remove('drag-over');
            }
        });

        listEl.addEventListener('dragover', e => {
            e.preventDefault();
            const target = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.analyze-tray-lap') : null;
            if (!target) {
                return;
            }
            if ('dataTransfer' in e) {
                const dt = e.dataTransfer;
                if (dt instanceof DataTransfer) {
                    dt.dropEffect = 'move';
                }
            }
            for (const el of Array.from(listEl.querySelectorAll('.drag-over'))) {
                el.classList.remove('drag-over');
            }
            target.classList.add('drag-over');
        });

        listEl.addEventListener('drop', e => {
            e.preventDefault();
            const target = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.analyze-tray-lap') : null;
            if (!target || dragSrcIdx === null) {
                return;
            }
            const dstIdx = parseInt(target.dataset.idx ?? '', 10);
            if (isNaN(dstIdx) || dragSrcIdx === dstIdx) {
                return;
            }
            // Reorder
            const current = getAnalyzeLaps();
            const item = current[dragSrcIdx];
            if (!item) {
                return;
            }
            current.splice(dragSrcIdx, 1);
            current.splice(dstIdx, 0, item);
            saveAnalyzeLaps(current);
            dragSrcIdx = null;
            renderTray();
        });
    }
}

/** Initialize the tray on page load if there are saved laps. */
export function initAnalyzeTray(): void {
    renderTray();
}
