import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GithubAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  setPersistence,
} from 'firebase/auth';

function normalizeEnvValue(val) {
  if (!val || typeof val !== 'string') return '';
  return val.trim().replace(/^['"]|['"]$/g, '').trim();
}

const firebaseConfig = {
  apiKey: normalizeEnvValue(import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: normalizeEnvValue(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: normalizeEnvValue(import.meta.env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: normalizeEnvValue(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: normalizeEnvValue(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: normalizeEnvValue(import.meta.env.VITE_FIREBASE_APP_ID),
};

function isRealValue(val) {
  if (!val) return false;
  if (val.startsWith('your-') || val.includes('your-project-id')) return false;
  return true;
}

export const hasRequiredEnvVars =
  isRealValue(firebaseConfig.apiKey) &&
  isRealValue(firebaseConfig.authDomain) &&
  isRealValue(firebaseConfig.projectId) &&
  isRealValue(firebaseConfig.appId);

export const isSameOriginAuthDomain =
  typeof window !== 'undefined' &&
  Boolean(firebaseConfig.authDomain) &&
  firebaseConfig.authDomain === window.location.host;

let firebaseAuth = null;
let firebaseInitError = '';
let persistenceReadyPromise = Promise.resolve();

if (hasRequiredEnvVars) {
  try {
    const firebaseApp =
      getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

    try {
      firebaseAuth = initializeAuth(firebaseApp, {
        persistence: [
          indexedDBLocalPersistence,
          browserLocalPersistence,
          browserSessionPersistence,
        ],
        popupRedirectResolver: browserPopupRedirectResolver,
      });
    } catch {
      // Fallback when Auth was already initialized (e.g. Vite HMR)
      firebaseAuth = getAuth(firebaseApp);
      persistenceReadyPromise = setPersistence(
        firebaseAuth,
        browserLocalPersistence
      ).catch(() => setPersistence(firebaseAuth, browserSessionPersistence).catch(() => {}));
    }

    // Proactively pre-load __/auth/iframe on desktop Chrome so signInWithPopup
    // keeps Chrome's synchronous click user-activation context intact.
    if (typeof window !== 'undefined' && firebaseAuth?._popupRedirectResolver?._initialize) {
      Promise.resolve()
        .then(() => firebaseAuth._popupRedirectResolver._initialize(firebaseAuth))
        .catch(() => {});
    }
  } catch (err) {
    firebaseInitError = err?.message || 'Failed to initialize Firebase app.';
    console.error('[WeatherGuard Auth] Firebase initialization error:', err);
  }
}

export const isFirebaseConfigured = hasRequiredEnvVars && Boolean(firebaseAuth);
export {
  browserPopupRedirectResolver,
  firebaseAuth,
  firebaseInitError,
  persistenceReadyPromise,
};

export function getConfiguredProviders() {
  if (!isFirebaseConfigured) {
    return {
      google: false,
      github: false,
      microsoft: false,
      password: false,
    };
  }

  const rawList = import.meta.env.VITE_FIREBASE_AUTH_PROVIDERS;
  if (!rawList || typeof rawList !== 'string') {
    return {
      google: true,
      github: true,
      microsoft: true,
      password: true,
    };
  }

  const allowed = new Set(
    rawList
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );

  return {
    google: allowed.has('google'),
    github: allowed.has('github'),
    microsoft: allowed.has('microsoft'),
    password: allowed.has('password') || allowed.has('email'),
  };
}

export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const githubProvider = new GithubAuthProvider();

export const microsoftProvider = new OAuthProvider('microsoft.com');
microsoftProvider.setCustomParameters({ prompt: 'select_account' });
