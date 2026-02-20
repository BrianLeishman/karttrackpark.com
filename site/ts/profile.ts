import { getProfile, updateProfileField } from './api';

type FieldDef = {
    key: string;
    label: string;
    description?: string;
} & (
    | { type: 'text'; placeholder: string }
    | { type: 'date' }
    | { type: 'select'; options: { value: string; label: string }[] }
);

const timezones = Intl.supportedValuesOf('timeZone');

const fields: FieldDef[] = [
    { key: 'height', label: 'Height', type: 'text', placeholder: "e.g. 5'10\", 178cm", description: 'Used for BMI and calorie calculations.' },
    { key: 'ideal_weight', label: 'Ideal weight', type: 'text', placeholder: 'e.g. 180 lbs, 82 kg', description: 'Your target weight so we can track your progress.' },
    { key: 'diet', label: 'Diet', type: 'text', placeholder: 'e.g. keto, Mediterranean, calorie counting, none', description: 'Any diet you follow or want to follow.' },
    { key: 'goal', label: 'Goal', type: 'text', placeholder: 'e.g. weight loss, muscle gain, general health tracking', description: 'What you want to get out of tracking.' },
    { key: 'lifestyle', label: 'Lifestyle', type: 'text', placeholder: 'e.g. sedentary office job, active construction work', description: 'Helps estimate your daily calorie needs.' },
    { key: 'birthdate', label: 'Birthdate', type: 'date', description: 'Used for age-based metabolic calculations.' },
    {
        key: 'sex',
        label: 'Biological sex',
        type: 'select',
        description: 'Used for metabolic calculations.',
        options: [
            { value: '', label: 'Select...' },
            { value: 'male', label: 'Male' },
            { value: 'female', label: 'Female' },
        ],
    },
    {
        key: 'timezone',
        label: 'Timezone',
        type: 'select',
        description: 'So your daily totals line up with your actual day.',
        options: [
            { value: '', label: 'Select...' },
            ...timezones.map(tz => ({ value: tz, label: tz.replaceAll('_', ' ') })),
        ],
    },
];

function createInput(field: FieldDef): HTMLInputElement | HTMLSelectElement {
    if (field.type === 'select') {
        const select = document.createElement('select');
        select.className = 'form-select';
        for (const opt of field.options) {
            const o = document.createElement('option');
            o.value = opt.value;
            o.textContent = opt.label;
            select.appendChild(o);
        }
        return select;
    }

    const input = document.createElement('input');
    input.className = 'form-control';
    if (field.type === 'date') {
        input.type = 'date';
    } else {
        input.type = 'text';
        input.placeholder = field.placeholder;
    }
    return input;
}

export async function renderProfile(container: HTMLElement): Promise<void> {
    container.innerHTML = '<div class="text-center py-4"><div class="spinner-border" role="status"></div></div>';

    let profile: Record<string, string>;
    try {
        profile = await getProfile();
    } catch {
        container.innerHTML = '<div class="alert alert-danger">Failed to load profile.</div>';
        return;
    }

    container.innerHTML = '';
    const form = document.createElement('div');
    form.className = 'row g-3';

    for (const field of fields) {
        const col = document.createElement('div');
        col.className = 'col-12 col-md-6';

        const label = document.createElement('label');
        label.className = 'form-label fw-semibold mb-0';
        label.textContent = field.label;
        col.appendChild(label);

        if (field.description) {
            const desc = document.createElement('div');
            desc.className = 'form-text mt-0 mb-1';
            desc.textContent = field.description;
            col.appendChild(desc);
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'position-relative';

        const input = createInput(field);
        input.value = profile[field.key] ?? '';
        wrapper.appendChild(input);

        const icon = document.createElement('span');
        icon.className = 'position-absolute top-50 translate-middle-y d-none status-icon';
        icon.style.right = '12px';
        if (field.type === 'select') {
            icon.style.right = '40px';
        }
        wrapper.appendChild(icon);

        col.appendChild(wrapper);

        let timer: ReturnType<typeof setTimeout>;
        const event = field.type === 'select' ? 'change' : 'input';

        input.addEventListener(event, () => {
            clearTimeout(timer);
            icon.className = 'position-absolute top-50 translate-middle-y status-icon';
            icon.innerHTML = '<span class="spinner-border spinner-border-sm text-secondary"></span>';

            timer = setTimeout(async () => {
                try {
                    await updateProfileField(field.key, input.value);
                    icon.innerHTML = '<i class="fa-solid fa-check text-success"></i>';
                    setTimeout(() => {
                        icon.classList.add('d-none');
                        icon.innerHTML = '';
                    }, 2000);
                } catch {
                    icon.innerHTML = '<i class="fa-solid fa-xmark text-danger"></i>';
                }
            }, field.type === 'select' ? 0 : 800);
        });

        form.appendChild(col);
    }

    container.appendChild(form);
}
