import { api } from './api';

const cognitoDomain = document.querySelector<HTMLMetaElement>('meta[name="cognito-domain"]')?.content ?? '';
const cognitoClientId = document.querySelector<HTMLMetaElement>('meta[name="cognito-client-id"]')?.content ?? '';

interface UserInfo {
    uid: string;
    email: string;
    name: string;
    picture: string;
}

export function login(): void {
    const redirectUri = window.location.origin + '/auth/callback/';
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: cognitoClientId,
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        identity_provider: 'Google',
    });
    window.location.href = `https://${cognitoDomain}/oauth2/authorize?${params.toString()}`;
}

export async function handleCallback(): Promise<boolean> {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) {
        return false;
    }

    try {
        const redirectUri = window.location.origin + '/auth/callback/';
        const { data } = await api.post<{ api_key: string; key_id: string; user: UserInfo }>('/api/auth/session', {
            code,
            redirect_uri: redirectUri,
        });

        localStorage.setItem('api_key', data.api_key);
        localStorage.setItem('api_key_id', data.key_id);
        localStorage.setItem('user', JSON.stringify(data.user));
        return true;
    } catch {
        return false;
    }
}

export function getUser(): { email: string; name: string; picture: string } | null {
    const raw = localStorage.getItem('user');
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw) as { email: string; name: string; picture: string };
    } catch {
        return null;
    }
}

export function getAccessToken(): string | null {
    return localStorage.getItem('api_key');
}

export function isLoggedIn(): boolean {
    return Boolean(localStorage.getItem('api_key'));
}

export function getApiKeyId(): string | null {
    return localStorage.getItem('api_key_id');
}

export function clearTokens(): void {
    localStorage.removeItem('api_key');
    localStorage.removeItem('api_key_id');
    localStorage.removeItem('user');
}

export function logout(): void {
    clearTokens();
    const redirectUri = window.location.origin + '/';
    const params = new URLSearchParams({
        client_id: cognitoClientId,
        logout_uri: redirectUri,
    });
    window.location.href = `https://${cognitoDomain}/logout?${params.toString()}`;
}
