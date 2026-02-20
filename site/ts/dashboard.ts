import { Chart, registerables } from 'chart.js';
import { Tooltip } from 'bootstrap';
import { getEntries } from './api';
import type { Entry } from './api';

Chart.register(...registerables);

function formatTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const numFmt = new Intl.NumberFormat();

function num(v: number): string {
    return v ? numFmt.format(Math.round(v)) : '-';
}

const weightFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function macro(label: string, val: number, unit = ''): string {
    return val ? `<span class="text-body-secondary">${label}</span> ${num(val)}${unit}` : '';
}

function renderTimeline(food: Entry[], exercise: Entry[], weight: Entry[]): string {
    const all = [
        ...food.map(e => ({ ...e, _type: 'food' as const })),
        ...exercise.map(e => ({ ...e, _type: 'exercise' as const })),
        ...weight.map(e => ({ ...e, _type: 'weight' as const })),
    ].sort((a, b) => b.created_at.localeCompare(a.created_at));

    if (all.length === 0) {
        return '';
    }

    const items = all.map(e => {
        let icon: string, color: string, body: string;

        if (e._type === 'food') {
            icon = 'fa-utensils';
            color = 'primary';
            const macros = [
                macro('Cal', e.calories),
                macro('P', e.protein, 'g'),
                macro('C', e.carbs, 'g'),
                macro('Net C', e.net_carbs, 'g'),
                macro('F', e.fat, 'g'),
            ].filter(Boolean).join(' <span class="text-body-tertiary">·</span> ');
            const extras = [
                macro('Fiber', e.fiber, 'g'),
                macro('Na', e.sodium, 'mg'),
                macro('Sugar', e.sugar, 'g'),
                macro('Caff', e.caffeine, 'mg'),
                macro('Chol', e.cholesterol, 'mg'),
            ].filter(Boolean).join(' <span class="text-body-tertiary">·</span> ');
            body = `
                <div class="fw-semibold">${e.description}</div>
                <div class="small mt-1">${macros}</div>
                ${extras ? `<div class="small text-body-secondary">${extras}</div>` : ''}`;
        } else if (e._type === 'exercise') {
            icon = 'fa-person-running';
            color = 'success';
            const details = [
                e.duration ? `${num(e.duration)} min` : '',
                e.calories ? `${num(e.calories)} cal burned` : '',
            ].filter(Boolean).join(' · ');
            body = `
                <div class="fw-semibold">${e.description}</div>
                ${details ? `<div class="small text-body-secondary mt-1">${details}</div>` : ''}`;
        } else {
            icon = 'fa-weight-scale';
            color = 'info';
            body = `<div class="fw-semibold">${weightFmt.format(e.value)} ${e.unit || 'lbs'}</div>
                ${e.notes ? `<div class="small text-body-secondary">${e.notes}</div>` : ''}`;
        }

        return `
            <div class="d-flex gap-3 mb-3">
                <div class="d-flex flex-column align-items-center" style="width:32px">
                    <div class="rounded-circle bg-${color}-subtle text-${color} d-flex align-items-center justify-content-center" style="width:32px;height:32px">
                        <i class="fa-solid ${icon} fa-sm"></i>
                    </div>
                    <div class="flex-grow-1 border-start mt-1 mb-0" style="width:0"></div>
                </div>
                <div class="flex-grow-1 pb-2">
                    <div class="text-body-secondary small mb-1">${formatTime(e.created_at)}</div>
                    ${body}
                </div>
            </div>`;
    }).join('');

    // Totals summary
    let totalCal = 0, totalP = 0, totalC = 0, totalNetC = 0, totalFat = 0, totalFiber = 0;
    let totalSodium = 0, totalSugar = 0, totalCaff = 0, totalChol = 0;
    for (const e of food) {
        totalCal += e.calories || 0;
        totalP += e.protein || 0;
        totalC += e.carbs || 0;
        totalNetC += e.net_carbs || 0;
        totalFat += e.fat || 0;
        totalFiber += e.fiber || 0;
        totalSodium += e.sodium || 0;
        totalSugar += e.sugar || 0;
        totalCaff += e.caffeine || 0;
        totalChol += e.cholesterol || 0;
    }

    const totals = [
        macro('Cal', totalCal),
        macro('Protein', totalP, 'g'),
        macro('Carbs', totalC, 'g'),
        macro('Net Carbs', totalNetC, 'g'),
        macro('Fat', totalFat, 'g'),
        macro('Fiber', totalFiber, 'g'),
        macro('Sodium', totalSodium, 'mg'),
        macro('Sugar', totalSugar, 'g'),
        macro('Caffeine', totalCaff, 'mg'),
        macro('Chol', totalChol, 'mg'),
    ].filter(Boolean).join(' <span class="text-body-tertiary">·</span> ');

    const totalsCard = food.length > 0 ? `
        <div class="card bg-body-secondary mt-2">
            <div class="card-body py-2 px-3">
                <div class="small fw-semibold mb-1">Daily Totals</div>
                <div class="small">${totals}</div>
            </div>
        </div>` : '';

    return items + totalsCard;
}

function renderWeightChart(history: Entry[]): void {
    const canvas = document.getElementById('weight-chart') as HTMLCanvasElement | null;
    if (!canvas) {
        return;
    }

    // Build a map of day -> latest entry
    const byDay = new Map<string, Entry>();
    for (const e of history) {
        const day = fmtDate(new Date(e.created_at));
        const existing = byDay.get(day);
        if (!existing || e.created_at > existing.created_at) {
            byDay.set(day, e);
        }
    }

    // Generate all 30 days as labels, with null for missing days
    const labels: string[] = [];
    const data: (number | null)[] = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        labels.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
        const entry = byDay.get(key);
        data.push(entry ? entry.value : null);
    }

    const style = getComputedStyle(document.documentElement);
    const primary = style.getPropertyValue('--bs-primary').trim() || '#0d6efd';
    const textColor = style.getPropertyValue('--bs-body-color').trim() || '#dee2e6';
    const gridColor = style.getPropertyValue('--bs-border-color').trim() || '#495057';

    new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Weight',
                data,
                borderColor: primary,
                backgroundColor: primary + '33',
                pointRadius: 5,
                pointBackgroundColor: primary,
                showLine: true,
                spanGaps: true,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
            },
            scales: {
                x: {
                    ticks: { color: textColor },
                    grid: { color: gridColor },
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: textColor,
                        callback: v => weightFmt.format(v as number),
                    },
                    grid: { color: gridColor },
                },
            },
        },
    });
}

function fmtDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let selectedDate: Date = new Date();

export async function renderDashboard(container: HTMLElement): Promise<void> {
    container.innerHTML = '<p class="text-body-secondary">Loading...</p>';

    const now = new Date();
    const today = fmtDate(selectedDate);
    const isToday = fmtDate(now) === today;
    const realToday = fmtDate(now);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = fmtDate(yesterday);
    const ago = new Date(now);
    ago.setDate(ago.getDate() - 30);
    const thirtyDaysAgo = fmtDate(ago);
    const ago7 = new Date(now);
    ago7.setDate(ago7.getDate() - 7);
    const sevenDaysAgo = fmtDate(ago7);
    const [food, exercise, weight, weightHistory, food7, food30, exercise7, exercise30] = await Promise.all([
        getEntries('food', today, today),
        getEntries('exercise', today, today),
        getEntries('weight', today, today),
        getEntries('weight', thirtyDaysAgo, realToday),
        getEntries('food', sevenDaysAgo, yesterdayStr),
        getEntries('food', thirtyDaysAgo, yesterdayStr),
        getEntries('exercise', sevenDaysAgo, yesterdayStr),
        getEntries('exercise', thirtyDaysAgo, yesterdayStr),
    ]);

    const localDate = (iso: string) => fmtDate(new Date(iso));
    const todayCal = food.reduce((s, e) => s + Number(e.calories || 0), 0);
    const todayBurned = exercise.reduce((s, e) => s + Number(e.calories || 0), 0);
    const days7WithCal = new Set(food7.filter(e => Number(e.calories || 0) > 0).map(e => localDate(e.created_at))).size;
    const avg7Cal = days7WithCal > 0 ? food7.reduce((s, e) => s + Number(e.calories || 0), 0) / days7WithCal : 0;
    const avg7Burned = days7WithCal > 0 ? exercise7.reduce((s, e) => s + Number(e.calories || 0), 0) / days7WithCal : 0;
    const days30WithCal = new Set(food30.filter(e => Number(e.calories || 0) > 0).map(e => localDate(e.created_at))).size;
    const avg30Cal = days30WithCal > 0 ? food30.reduce((s, e) => s + Number(e.calories || 0), 0) / days30WithCal : 0;
    const avg30Burned = days30WithCal > 0 ? exercise30.reduce((s, e) => s + Number(e.calories || 0), 0) / days30WithCal : 0;

    const displayDate = selectedDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

    container.innerHTML = `
        <div class="d-flex align-items-center justify-content-center gap-3 mb-4">
            <button class="btn btn-outline-secondary btn-sm" id="date-prev" aria-label="Previous day"><i class="fa-solid fa-chevron-left"></i></button>
            <input type="date" class="form-control form-control-sm" id="date-picker" value="${today}" max="${fmtDate(now)}" style="width:auto;">
            <button class="btn btn-outline-secondary btn-sm" id="date-next" aria-label="Next day" ${isToday ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>
            ${isToday ? '' : '<button class=\'btn btn-outline-primary btn-sm\' id=\'date-today\'>Today</button>'}
        </div>
        <div class="row g-4">
            <div class="col-md-4">
                <div class="card text-center">
                    <div class="card-body">
                        <div class="text-body-secondary small">Calories ${isToday ? 'Today' : displayDate}</div>
                        <div class="fs-2 fw-bold">${todayCal > 0 ? numFmt.format(Math.round(todayCal)) : '-'}</div>
                        ${todayBurned > 0 ? `<div class="text-body-secondary small">Net ${numFmt.format(Math.round(todayCal - todayBurned))}</div>` : ''}
                    </div>
                </div>
            </div>
            <div class="col-md-4">
                <div class="card text-center">
                    <div class="card-body">
                        <div class="text-body-secondary small">Avg Cal / Day (7d) <span class="badge rounded-pill text-bg-secondary" data-bs-toggle="tooltip" data-bs-title="Average of the previous 7 days, excluding today" style="cursor:help; font-size:.6em; vertical-align:middle;">i</span></div>
                        <div class="fs-2 fw-bold">${avg7Cal > 0 ? numFmt.format(Math.round(avg7Cal)) : '-'}</div>
                        ${avg7Burned > 0 ? `<div class="text-body-secondary small">Net ${numFmt.format(Math.round(avg7Cal - avg7Burned))}</div>` : ''}
                    </div>
                </div>
            </div>
            <div class="col-md-4">
                <div class="card text-center">
                    <div class="card-body">
                        <div class="text-body-secondary small">Avg Cal / Day (30d) <span class="badge rounded-pill text-bg-secondary" data-bs-toggle="tooltip" data-bs-title="Average of the previous 30 days, excluding today" style="cursor:help; font-size:.6em; vertical-align:middle;">i</span></div>
                        <div class="fs-2 fw-bold">${avg30Cal > 0 ? numFmt.format(Math.round(avg30Cal)) : '-'}</div>
                        ${avg30Burned > 0 ? `<div class="text-body-secondary small">Net ${numFmt.format(Math.round(avg30Cal - avg30Burned))}</div>` : ''}
                    </div>
                </div>
            </div>
            <div class="col-12">
                ${(food.length + exercise.length + weight.length) > 0
                    ? renderTimeline(food, exercise, weight)
                    : `<p class="text-body-secondary text-center">Nothing logged ${isToday ? 'today' : 'this day'}.</p>`}
            </div>
            <div class="col-12">
                <h4>Weight Trend</h4>
                <div style="position:relative; height:300px"><canvas id="weight-chart"></canvas></div>
            </div>
        </div>`;

    renderWeightChart(weightHistory);

    // Init tooltips
    container.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => new Tooltip(el));

    // Date navigation
    const refresh = async () => renderDashboard(container);
    document.getElementById('date-prev')?.addEventListener('click', () => {
        selectedDate.setDate(selectedDate.getDate() - 1);
        void refresh();
    });
    document.getElementById('date-next')?.addEventListener('click', () => {
        selectedDate.setDate(selectedDate.getDate() + 1);
        void refresh();
    });
    document.getElementById('date-today')?.addEventListener('click', () => {
        selectedDate = new Date();
        void refresh();
    });
    document.getElementById('date-picker')?.addEventListener('change', e => {
        const val = (e.target as HTMLInputElement).value;
        if (val) {
            const [y, m, d] = val.split('-').map(Number);
            selectedDate = new Date(y, m - 1, d);
            void refresh();
        }
    });
}
