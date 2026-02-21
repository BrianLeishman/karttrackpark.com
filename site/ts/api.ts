import axios from 'axios';
import { getAccessToken, clearTokens } from './auth';

const apiBase = document.querySelector<HTMLMetaElement>('meta[name="api-base"]')?.content
    ?? 'https://62lt3y3apd.execute-api.us-east-1.amazonaws.com';

export const api = axios.create({
    baseURL: apiBase,
});

api.interceptors.request.use(config => {
    const token = getAccessToken();
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

api.interceptors.response.use(
    resp => resp,
    error => {
        if (!axios.isAxiosError(error) || !error.response) {
            showError('Network error. Check your connection.');
            return Promise.reject(error as Error);
        }

        const status = error.response.status;
        const data: unknown = error.response.data;
        if (status === 401) {
            showError('Session expired. Please sign in again.');
            clearTokens();
            setTimeout(() => window.location.reload(), 1500);
        } else {
            const message = typeof data === 'string' ? data : error.message;
            showError(`Request failed: ${message}`);
        }

        return Promise.reject(error as Error);
    },
);

function showError(message: string): void {
    document.getElementById('api-error-toast')?.remove();

    const toast = document.createElement('div');
    toast.id = 'api-error-toast';
    toast.className = 'alert alert-danger alert-dismissible position-fixed bottom-0 end-0 m-3';
    toast.style.zIndex = '9999';
    toast.innerHTML = `${message}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 8000);
}
