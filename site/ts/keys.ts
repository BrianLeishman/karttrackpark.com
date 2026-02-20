import * as bootstrap from 'bootstrap';
import { api } from './api';
import { logout, getApiKeyId } from './auth';

interface APIKeyInfo {
    key_id: string;
    label: string;
    created_at: string;
}

async function fetchAPIKeys(): Promise<APIKeyInfo[]> {
    try {
        const { data } = await api.get<APIKeyInfo[]>('/api/token');
        return data ?? [];
    } catch {
        return [];
    }
}

async function createAPIKey(label: string): Promise<{ api_key: string; key_id: string } | null> {
    try {
        const { data } = await api.post<{ api_key: string; key_id: string }>('/api/token', { label });
        return data;
    } catch {
        return null;
    }
}

async function deleteAPIKey(keyId: string): Promise<boolean> {
    try {
        await api.delete('/api/token', { params: { id: keyId } });
        return true;
    } catch {
        return false;
    }
}

function copyWithFeedback(btn: HTMLElement, text: string): void {
    void navigator.clipboard.writeText(text).then(() => {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => {
            btn.textContent = orig;
        }, 1500);
    });
}

function renderKeyRow(key: APIKeyInfo): string {
    const created = new Date(key.created_at).toLocaleDateString();
    const isCurrentSession = key.key_id === getApiKeyId();
    let badge = '';
    let actionBtn: string;
    if (isCurrentSession) {
        badge = ' <span class="badge text-bg-secondary">current session</span>';
        actionBtn = `<button class="btn btn-outline-warning btn-sm delete-key-btn" data-key-id="${key.key_id}" data-is-session="true" data-bs-toggle="tooltip" data-bs-title="This will log you out">Revoke session</button>`;
    } else {
        actionBtn = `<button class="btn btn-outline-danger btn-sm delete-key-btn" data-key-id="${key.key_id}">Revoke</button>`;
    }
    return `<tr data-key-id="${key.key_id}">
        <td>${key.label || 'Untitled'}${badge}</td>
        <td class="text-body-secondary">${created}</td>
        <td class="text-end">${actionBtn}</td>
    </tr>`;
}

export async function renderKeys(container: HTMLElement): Promise<void> {
    container.innerHTML = '<div class="text-center py-4"><div class="spinner-border" role="status"></div></div>';

    const keys = await fetchAPIKeys();
    const endpoint = 'https://k24xsd279c.execute-api.us-east-1.amazonaws.com/mcp';

    keys.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const keyRows = keys.length > 0
        ? keys.map(renderKeyRow).join('')
        : '<tr><td colspan="3" class="text-body-secondary">No API keys yet.</td></tr>';

    container.innerHTML = `
        <h4>MCP Setup</h4>
        <p class="text-body-secondary">Connect your AI assistant to JustLog using the MCP protocol.</p>
        <div class="mb-3">
            <label class="form-label fw-semibold">Endpoint</label>
            <div class="input-group">
                <input type="text" class="form-control form-control-sm font-monospace" value="${endpoint}" readonly>
                <button class="btn btn-outline-secondary btn-sm" type="button" id="copy-endpoint">Copy</button>
            </div>
        </div>
        <div class="mb-4">
            <label class="form-label fw-semibold">API Keys</label>
            <div class="table-responsive">
            <table class="table table-sm mb-2">
                <thead><tr><th>Label</th><th>Created</th><th></th></tr></thead>
                <tbody id="api-keys-tbody">${keyRows}</tbody>
            </table>
            </div>
            <div id="new-key-alert" class="d-none alert alert-success alert-dismissible mb-2">
                <strong>New key created:</strong> <code id="new-key-value"></code>
                <button class="btn btn-outline-success btn-sm ms-2" id="copy-new-key">Copy</button>
                <div class="form-text mt-1">Save this key now — it won't be shown again.</div>
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>
            <div class="input-group input-group-sm">
                <input type="text" class="form-control" placeholder="Key label (e.g. Claude Code)" id="new-key-label" required>
                <button class="btn btn-primary" type="button" id="create-key-btn">Create Key</button>
            </div>
        </div>`;

    bindButtons(() => renderKeys(container));
}

function bindButtons(refresh: () => Promise<void>): void {
    document.getElementById('copy-endpoint')?.addEventListener('click', e => {
        const btn = e.currentTarget as HTMLElement;
        const input = btn.parentElement?.querySelector('input');
        if (input) {
            copyWithFeedback(btn, input.value);
        }
    });

    document.getElementById('create-key-btn')?.addEventListener('click', async () => {
        const input = document.getElementById('new-key-label') as HTMLInputElement | null;
        const label = input?.value.trim() || '';
        if (!label) {
            input?.classList.add('is-invalid');
            input?.focus();
            return;
        }
        input?.classList.remove('is-invalid');
        const result = await createAPIKey(label);
        if (!result) {
            return;
        }

        if (!localStorage.getItem('api_key')) {
            localStorage.setItem('api_key', result.api_key);
        }

        await refresh();

        const alertEl = document.getElementById('new-key-alert');
        const value = document.getElementById('new-key-value');
        if (alertEl && value) {
            value.textContent = result.api_key;
            alertEl.classList.remove('d-none');
        }
    });

    document.getElementById('copy-new-key')?.addEventListener('click', e => {
        const value = document.getElementById('new-key-value');
        if (value?.textContent) {
            copyWithFeedback(e.currentTarget as HTMLElement, value.textContent);
        }
    });

    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
        new bootstrap.Tooltip(el);
    });

    document.querySelectorAll('.delete-key-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const el = btn as HTMLElement;
            const keyId = el.dataset.keyId;
            if (!keyId) {
                return;
            }
            const isSession = el.dataset.isSession === 'true';
            const msg = isSession
                ? 'Revoke your current session? You will be logged out.'
                : 'Revoke this API key? Any integrations using it will stop working.';
            if (!confirm(msg)) {
                return;
            }
            await deleteAPIKey(keyId);
            if (isSession) {
                logout();
                window.location.reload();
                return;
            }
            await refresh();
        });
    });
}
