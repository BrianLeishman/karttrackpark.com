import 'bootstrap';
import { handleCallback, getUser, login, logout } from './auth';
import { renderEvents } from './events';
import { renderKeys } from './keys';
import { renderTrackDetail } from './track-detail';
import { renderTrackEdit } from './track-edit';
import { renderMyTracks } from './tracks';

const pages: Record<string, (el: HTMLElement) => Promise<void>> = {
    'keys': renderKeys,
    'my-tracks': renderMyTracks,
    'track-edit': renderTrackEdit,
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

    // Render public pages (no auth required)
    const eventsPage = document.getElementById('events-page');
    if (eventsPage) {
        void renderEvents(eventsPage);
    }

    const trackDetail = document.getElementById('track-detail');
    if (trackDetail) {
        void renderTrackDetail(trackDetail);
    }

    // Render auth state in navbar
    const authContainer = document.getElementById('auth');
    if (!authContainer) {
        return;
    }

    const user = getUser();
    if (user) {
        // Build nav links with user dropdown
        const path = window.location.pathname;
        const pic = user.picture
            ? `<img src="${user.picture}" alt="" class="rounded-circle me-1" width="22" height="22" referrerpolicy="no-referrer"> `
            : '';
        const navLinks = document.getElementById('nav-links');
        if (navLinks) {
            navLinks.innerHTML = `
                <li class="nav-item"><a class="nav-link${path === '/' ? ' active' : ''}" href="/">Events</a></li>
            `;
        }

        authContainer.innerHTML = `
            <div class="dropdown">
                <a class="nav-link dropdown-toggle d-flex align-items-center" href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">
                    ${pic}${user.name}
                </a>
                <ul class="dropdown-menu dropdown-menu-end">
                    <li><a class="dropdown-item${path === '/my/tracks/' ? ' active' : ''}" href="/my/tracks/">My Tracks</a></li>
                    <li><a class="dropdown-item${path === '/my/keys/' ? ' active' : ''}" href="/my/keys/">API Keys</a></li>
                    <li><hr class="dropdown-divider"></li>
                    <li><button class="dropdown-item" id="logout-btn">Sign out</button></li>
                </ul>
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
        document.getElementById('login-btn')?.addEventListener('click', () => login());

        // Show sign-in prompt on authenticated pages
        for (const id of Object.keys(pages)) {
            const el = document.getElementById(id);
            if (el) {
                const labels: Record<string, string> = { 'keys': 'API keys', 'my-tracks': 'tracks', 'track-edit': 'track settings' };
                const label = labels[id] ?? id;
                el.innerHTML = `
                    <div class="text-center py-5">
                        <p class="text-body-secondary mb-3">Sign in to view your ${label}.</p>
                        <button class="btn btn-primary" id="login-btn-${id}">Sign in</button>
                    </div>
                `;
                document.getElementById(`login-btn-${id}`)?.addEventListener('click', () => login());
            }
        }
    }
}

void init();
