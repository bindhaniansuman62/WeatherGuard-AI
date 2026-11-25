import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import {
  browserPopupRedirectResolver,
  effectiveAuthDomain,
  firebaseAuth,
  firebaseInitError,
  getConfiguredProviders,
  githubProvider,
  googleProvider,
  hasRequiredEnvVars,
  isFirebaseConfigured,
  isSameOriginAuthDomain,
  microsoftProvider,
  persistenceReadyPromise,
  resolverReadyPromise,
} from './firebase';

const GUEST_SESSION_FLAG = 'wg_guest_session';
const PENDING_REDIRECT_FLAG = 'wg_pending_oauth_redirect';

const PROVIDER_MAP = {
  google: { provider: googleProvider, label: 'Google' },
  github: { provider: githubProvider, label: 'GitHub' },
  microsoft: { provider: microsoftProvider, label: 'Microsoft' },
};

function formatProviderLabel(providerData = []) {
  const id = providerData[0]?.providerId || '';
  if (id.includes('google')) return 'Google';
  if (id.includes('github')) return 'GitHub';
  if (id.includes('microsoft')) return 'Microsoft';
  if (id.includes('password')) return 'Email & Password';
  return 'Firebase Auth';
}

export function mapFirebaseUser(user) {
  if (!user) return null;
  const providerLabel = formatProviderLabel(user.providerData);
  return {
    mode: 'firebase',
    uid: user.uid,
    email: user.email || 'No email provided by provider',
    displayName:
      user.displayName || (user.email ? user.email.split('@')[0] : 'Operator'),
    photoURL: user.photoURL || null,
    providerLabel,
    statusNote: `Signed in via ${providerLabel}. Firebase session persisted across refreshes.`,
    signedInAt: new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

export function createDemoSession() {
  return {
    mode: 'demo',
    uid: null,
    email: 'guest-judge@weatherguard.local',
    displayName: 'Guest Judge',
    photoURL: null,
    providerLabel: 'Guest Mode',
    statusNote:
      'Guest demonstration mode active over simulated telemetry (no Firebase or backend auth session).',
    signedInAt: new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

export function persistGuestSessionFlag() {
  try {
    sessionStorage.setItem(GUEST_SESSION_FLAG, '1');
  } catch {
    // ignore storage errors
  }
}

export function clearGuestSessionFlag() {
  try {
    sessionStorage.removeItem(GUEST_SESSION_FLAG);
  } catch {
    // ignore storage errors
  }
}

export function readRestoredGuestSession() {
  try {
    if (sessionStorage.getItem(GUEST_SESSION_FLAG) === '1') {
      return createDemoSession();
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

export function getAuthStatus() {
  const enabledProviders = getConfiguredProviders();
  let unconfiguredReason = '';

  if (!hasRequiredEnvVars) {
    unconfiguredReason =
      'Firebase configuration missing (VITE_FIREBASE_API_KEY, AUTH_DOMAIN, PROJECT_ID, APP_ID). Add them to frontend/.env and restart the Vite dev server, or use Continue as Guest.';
  } else if (!isFirebaseConfigured) {
    unconfiguredReason = `Firebase initialization failed: ${firebaseInitError || 'Verify your Firebase Web App credentials in frontend/.env.'}`;
  }

  return {
    isFirebaseConfigured,
    enabledProviders,
    unconfiguredReason,
    authDomain: effectiveAuthDomain,
    isSameOriginAuthDomain,
  };
}

function mapFirebaseError(err) {
  const code = err?.code || '';
  const suffix = code ? ` [${code}]` : '';
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return `Sign-in popup was closed before completing authentication.${suffix}`;
    case 'auth/popup-blocked':
      return `Sign-in popup was blocked by the browser.${suffix} Ensure pop-ups are allowed or that ${effectiveAuthDomain}/__/auth/handler is authorized in Google Cloud Console.`;
    case 'auth/account-exists-with-different-credential':
      return `An account already exists with this email under another sign-in provider.${suffix}`;
    case 'auth/network-request-failed':
      return `Network error communicating with Firebase Authentication.${suffix}`;
    case 'auth/operation-not-allowed':
      return `This sign-in provider is not enabled in the Firebase Console yet.${suffix}`;
    case 'auth/unauthorized-domain':
      return `Domain '${typeof window !== 'undefined' ? window.location.hostname : ''}' is not authorized in Firebase Console -> Authentication -> Settings -> Authorized domains.${suffix}`;
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return `Invalid email or password.${suffix}`;
    case 'auth/too-many-requests':
      return `Too many failed attempts. Wait a moment before trying again.${suffix}`;
    case 'auth/user-disabled':
      return `This operator account has been disabled in Firebase Authentication.${suffix}`;
    default:
      return `${err?.message || 'Authentication failed. Please try again.'}${suffix}`;
  }
}

let pendingRedirectPromise = null;

export function checkRedirectResult() {
  if (!isFirebaseConfigured || !firebaseAuth) {
    return Promise.resolve({ session: null, error: null, fromRedirect: false });
  }
  if (!pendingRedirectPromise) {
    pendingRedirectPromise = persistenceReadyPromise
      .then(() => getRedirectResult(firebaseAuth, browserPopupRedirectResolver))
      .then((credential) => {
        let hadPendingRedirect = false;
        try {
          hadPendingRedirect = sessionStorage.getItem(PENDING_REDIRECT_FLAG) === '1';
          sessionStorage.removeItem(PENDING_REDIRECT_FLAG);
        } catch {
          // ignore
        }

        if (credential?.user) {
          clearGuestSessionFlag();
          return {
            session: mapFirebaseUser(credential.user),
            error: null,
            fromRedirect: true,
          };
        }
        if (hadPendingRedirect && !firebaseAuth.currentUser) {
          return {
            session: null,
            error:
              `Redirect sign-in did not yield a session. Verify that https://${effectiveAuthDomain}/__/auth/handler is listed in Google Cloud OAuth Authorized Redirect URIs and third-party storage is not blocking auth state.`,
            fromRedirect: true,
          };
        }
        return { session: null, error: null, fromRedirect: false };
      })
      .catch((err) => {
        try {
          sessionStorage.removeItem(PENDING_REDIRECT_FLAG);
        } catch {
          // ignore
        }
        return {
          session: null,
          error: mapFirebaseError(err),
          fromRedirect: true,
        };
      });
  }
  return pendingRedirectPromise;
}

/**
 * Authoritative Firebase authentication lifecycle observer.
 * Awaits persistence, popup resolver warm-up, redirect result, and authStateReady
 * before settling authLoading so refreshes and OAuth redirects route cleanly.
 */
export function subscribeToAuthLifecycle({ onAuthState, onRedirectError }) {
  if (!isFirebaseConfigured || !firebaseAuth) {
    onAuthState({
      authLoading: false,
      session: readRestoredGuestSession(),
      fromRedirect: false,
    });
    return () => {};
  }

  let disposed = false;
  let initialized = false;
  let unsubscribeFirebase = () => {};

  async function start() {
    onAuthState({ authLoading: true, session: null, fromRedirect: false });

    const [redirectOutcome] = await Promise.all([
      checkRedirectResult(),
      resolverReadyPromise,
    ]);
    if (disposed) return;

    if (redirectOutcome.error && onRedirectError) {
      onRedirectError(redirectOutcome.error);
    }

    if (typeof firebaseAuth.authStateReady === 'function') {
      await firebaseAuth.authStateReady();
    }
    if (disposed) return;

    unsubscribeFirebase = onAuthStateChanged(firebaseAuth, (user) => {
      if (disposed) return;
      const isInitialCallback = !initialized;
      initialized = true;
      if (user) {
        clearGuestSessionFlag();
        onAuthState({
          authLoading: false,
          session: mapFirebaseUser(user),
          fromRedirect: isInitialCallback && redirectOutcome.fromRedirect,
        });
      } else {
        onAuthState({
          authLoading: false,
          session: readRestoredGuestSession(),
          fromRedirect: false,
        });
      }
    });

    if (!initialized && (redirectOutcome.session || firebaseAuth.currentUser)) {
      clearGuestSessionFlag();
      onAuthState({
        authLoading: false,
        session:
          redirectOutcome.session || mapFirebaseUser(firebaseAuth.currentUser),
        fromRedirect: redirectOutcome.fromRedirect,
      });
    }
  }

  start();

  return () => {
    disposed = true;
    unsubscribeFirebase();
  };
}

export async function signInWithOAuthProvider(providerKey) {
  const { enabledProviders } = getAuthStatus();
  if (!isFirebaseConfigured || !firebaseAuth) {
    throw new Error(
      'Firebase Authentication is not configured in .env yet. Use Continue as Guest for demo access.'
    );
  }
  if (!enabledProviders[providerKey]) {
    throw new Error(
      `${providerKey} sign-in is currently disabled in VITE_FIREBASE_AUTH_PROVIDERS.`
    );
  }

  const entry = PROVIDER_MAP[providerKey];
  if (!entry) {
    throw new Error(`Unsupported authentication provider: ${providerKey}`);
  }

  try {
    const credential = await signInWithPopup(
      firebaseAuth,
      entry.provider,
      browserPopupRedirectResolver
    );
    clearGuestSessionFlag();
    return mapFirebaseUser(credential.user);
  } catch (err) {
    console.error('[WeatherGuard Auth] OAuth sign-in error:', err?.code, err?.message);
    if (err?.code === 'auth/popup-blocked' && isSameOriginAuthDomain) {
      try {
        try {
          sessionStorage.setItem(PENDING_REDIRECT_FLAG, '1');
        } catch {
          // ignore
        }
        await signInWithRedirect(
          firebaseAuth,
          entry.provider,
          browserPopupRedirectResolver
        );
        return null;
      } catch (redirectErr) {
        try {
          sessionStorage.removeItem(PENDING_REDIRECT_FLAG);
        } catch {
          // ignore
        }
        throw new Error(mapFirebaseError(redirectErr), { cause: redirectErr });
      }
    }
    throw new Error(mapFirebaseError(err), { cause: err });
  }
}

export async function signInWithEmailPassword({ email, password }) {
  const { enabledProviders } = getAuthStatus();
  if (!isFirebaseConfigured || !firebaseAuth) {
    throw new Error(
      'Firebase Authentication is not configured in .env yet. Use Continue as Guest for demo access.'
    );
  }
  if (!enabledProviders.password) {
    throw new Error(
      'Email/password authentication is disabled in VITE_FIREBASE_AUTH_PROVIDERS.'
    );
  }

  try {
    const credential = await signInWithEmailAndPassword(
      firebaseAuth,
      email.trim(),
      password
    );
    clearGuestSessionFlag();
    return mapFirebaseUser(credential.user);
  } catch (err) {
    throw new Error(mapFirebaseError(err), { cause: err });
  }
}

export async function getCurrentIdToken() {
  if (!isFirebaseConfigured || !firebaseAuth?.currentUser) {
    return null;
  }
  return firebaseAuth.currentUser.getIdToken();
}

export async function signOutAccount(session) {
  clearGuestSessionFlag();
  if (isFirebaseConfigured && firebaseAuth && session?.mode === 'firebase') {
    await signOut(firebaseAuth);
  }
}
