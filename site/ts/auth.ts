const cognitoDomain = 'https://justlog.auth.us-east-1.amazoncognito.com';
const clientId = '11h4ggbj2m9hehirq0n7hcq5m8';
const scopes = 'openid email profile';

function redirectUri(): string {
    return `${window.location.origin}/auth/callback/`;
}

// PKCE helpers
function generateRandomString(length: number): string {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(plain: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    return crypto.subtle.digest('SHA-256', encoder.encode(plain));
}

function base64UrlEncode(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const b of bytes) {
        binary += String.fromCharCode(b);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function login(): Promise<void> {
    const codeVerifier = generateRandomString(64);
    sessionStorage.setItem('pkce_code_verifier', codeVerifier);

    const challengeBuffer = await sha256(codeVerifier);
    const codeChallenge = base64UrlEncode(challengeBuffer);

    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        scope: scopes,
        redirect_uri: redirectUri(),
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
    });

    window.location.href = `${cognitoDomain}/oauth2/authorize?${params.toString()}`;
}

export async function handleCallback(): Promise<boolean> {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) {
        return false;
    }

    const codeVerifier = sessionStorage.getItem('pkce_code_verifier');
    if (!codeVerifier) {
        return false;
    }
    sessionStorage.removeItem('pkce_code_verifier');

    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: redirectUri(),
        code_verifier: codeVerifier,
    });

    const resp = await fetch(`${cognitoDomain}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    if (!resp.ok) {
        return false;
    }

    interface TokenResponse {
        id_token: string;
        access_token: string;
        refresh_token?: string;
    }

    const tokens: TokenResponse = await resp.json() as TokenResponse;
    localStorage.setItem('id_token', tokens.id_token);
    localStorage.setItem('access_token', tokens.access_token);
    if (tokens.refresh_token) {
        localStorage.setItem('refresh_token', tokens.refresh_token);
    }

    // Persist user info from id_token so it survives token expiry
    try {
        const payload = JSON.parse(atob(tokens.id_token.split('.')[1])) as { email?: string; name?: string; picture?: string };
        localStorage.setItem('user_info', JSON.stringify({
            email: payload.email ?? '',
            name: payload.name || payload.email || '',
            picture: payload.picture ?? '',
        }));
    } catch { /* best effort */ }

    // Exchange Cognito token for long-lived API key
    await exchangeForAPIKey(tokens.access_token);

    // Save browser timezone to profile
    await saveTimezone();

    return true;
}

export function getUser(): { email: string; name: string; picture: string } | null {
    // If we have persisted user info and a valid API key, use that
    // (survives Cognito token expiry)
    const stored = localStorage.getItem('user_info');
    if (stored && localStorage.getItem('api_key')) {
        try {
            return JSON.parse(stored) as { email: string; name: string; picture: string };
        } catch { /* fall through */ }
    }

    // Fallback: decode from id_token
    const idToken = localStorage.getItem('id_token');
    if (!idToken) {
        return null;
    }

    try {
        const payload = JSON.parse(atob(idToken.split('.')[1])) as { exp: number; email?: string; name?: string; picture?: string };

        if (payload.exp * 1000 < Date.now()) {
            // Token expired and no API key — fully logged out
            if (!localStorage.getItem('api_key')) {
                clearTokens();
                return null;
            }
        }

        return {
            email: payload.email ?? '',
            name: payload.name || payload.email || '',
            picture: payload.picture ?? '',
        };
    } catch {
        return null;
    }
}

async function exchangeForAPIKey(cognitoToken: string): Promise<void> {
    if (localStorage.getItem('api_key')) {
        return;
    }
    try {
        const base = 'https://k24xsd279c.execute-api.us-east-1.amazonaws.com';
        const headers = { 'Authorization': `Bearer ${cognitoToken}`, 'Content-Type': 'application/json' };

        const resp = await fetch(`${base}/api/token`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ label: 'Web UI' }),
        });
        if (resp.ok) {
            const data = await resp.json() as { api_key: string; key_id: string };
            localStorage.setItem('api_key', data.api_key);
            localStorage.setItem('api_key_id', data.key_id);
        }
    } catch {
        // If exchange fails, we still have the Cognito token as fallback
    }
}

async function saveTimezone(): Promise<void> {
    const apiKey = localStorage.getItem('api_key');
    if (!apiKey) {
        return;
    }
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        await fetch('https://k24xsd279c.execute-api.us-east-1.amazonaws.com/api/profile', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ timezone: tz }),
        });
    } catch { /* best effort */ }
}

export function getApiKeyId(): string | null {
    return localStorage.getItem('api_key_id');
}

export function getAccessToken(): string | null {
    return localStorage.getItem('api_key') ?? localStorage.getItem('access_token');
}

export function isLoggedIn(): boolean {
    return getUser() !== null;
}

export function clearTokens(): void {
    localStorage.removeItem('id_token');
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('api_key');
    localStorage.removeItem('api_key_id');
    localStorage.removeItem('user_info');
}

export function logout(): void {
    clearTokens();

    // Clear Cognito hosted UI session so next login shows account chooser
    const params = new URLSearchParams({
        client_id: clientId,
        logout_uri: window.location.origin + '/',
    });
    window.location.href = `${cognitoDomain}/logout?${params.toString()}`;
}
