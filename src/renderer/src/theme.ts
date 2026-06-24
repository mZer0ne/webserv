export type ThemePref = 'light' | 'dark' | 'system';

const KEY = 'webserv-theme';

export function getThemePref(): ThemePref {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

function systemDark(): boolean {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(pref: ThemePref): 'light' | 'dark' {
    return pref === 'system' ? (systemDark() ? 'dark' : 'light') : pref;
}

let mql: MediaQueryList | null = null;
let handler: (() => void) | null = null;

/** Apply a theme preference and, for 'system', keep following OS changes. */
export function applyTheme(pref: ThemePref): void {
    document.documentElement.dataset.theme = resolve(pref);

    if (mql && handler) mql.removeEventListener('change', handler);
    mql = null;
    handler = null;

    if (pref === 'system') {
        mql = window.matchMedia('(prefers-color-scheme: dark)');
        handler = () => {
            document.documentElement.dataset.theme = mql!.matches ? 'dark' : 'light';
        };
        mql.addEventListener('change', handler);
    }
}

export function setThemePref(pref: ThemePref): void {
    localStorage.setItem(KEY, pref);
    applyTheme(pref);
}
