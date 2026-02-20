import 'bootstrap';
import { handleCallback, getUser, login, logout } from './auth';
import { renderDashboard } from './dashboard';
import { renderProfile } from './profile';
import { renderKeys } from './keys';

const pages: Record<string, (el: HTMLElement) => Promise<void>> = {
    dashboard: renderDashboard,
    profile: renderProfile,
    keys: renderKeys,
};

async function init(): Promise<void> {
    // Handle OAuth callback
    if (window.location.pathname === '/auth/callback/') {
        const ok = await handleCallback();
        if (ok) {
            window.location.href = '/';
            return;
        }
    }

    // Render auth state in navbar
    const authContainer = document.getElementById('auth');
    if (!authContainer) {
        return;
    }

    const user = getUser();
    if (user) {
        // Build nav links
        const navLinks = document.getElementById('nav-links');
        if (navLinks) {
            const path = window.location.pathname;
            navLinks.innerHTML = `
                <li class="nav-item"><a class="nav-link${path === '/' ? ' active' : ''}" href="/">Dashboard</a></li>
                <li class="nav-item"><a class="nav-link${path === '/keys/' ? ' active' : ''}" href="/keys/">API Keys</a></li>
                <li class="nav-item d-lg-none"><a class="nav-link${path === '/profile/' ? ' active' : ''}" href="/profile/">Profile</a></li>
            `;
        }

        authContainer.innerHTML = `
            <div class="d-flex align-items-center gap-2">
                ${user.picture ? `<img src="${user.picture}" alt="" class="rounded-circle" width="28" height="28" referrerpolicy="no-referrer">` : ''}
                <a href="/profile/" class="text-decoration-none d-none d-sm-inline">${user.name}</a>
                <button class="btn btn-sm btn-outline-secondary" id="logout-btn">Sign out</button>
            </div>
        `;
        document.getElementById('logout-btn')?.addEventListener('click', () => {
            logout();
        });

        // Mount the appropriate page renderer
        for (const [id, render] of Object.entries(pages)) {
            const el = document.getElementById(id);
            if (el) {
                void render(el);
            }
        }
    } else {
        authContainer.innerHTML = `
            <button class="btn btn-sm btn-primary" id="login-btn">Sign in</button>
        `;
        document.getElementById('login-btn')?.addEventListener('click', () => void login());

        // Show sign-in prompt on authenticated pages
        for (const id of Object.keys(pages)) {
            const el = document.getElementById(id);
            if (el) {
                const label = id === 'keys' ? 'API keys' : id;
                el.innerHTML = `
                    <div class="text-center py-5">
                        <p class="text-body-secondary mb-3">Sign in to view your ${label}.</p>
                        <button class="btn btn-primary" id="login-btn-${id}">Sign in</button>
                    </div>
                `;
                document.getElementById(`login-btn-${id}`)?.addEventListener('click', () => void login());
            }
        }
    }
}

void init();
