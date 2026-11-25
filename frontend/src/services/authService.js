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
  };
}

function mapFirebaseError(err) {
  const code = err?.code || '';
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in popup was closed before completing authentication.';
    case 'auth/popup-blocked':
      return 'Sign-in popup was blocked by your browser. Please allow pop-ups for this site and click Continue with Google again.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email under another sign-in provider. Sign in with your original provider.';
    case 'auth/network-request-failed':
      return 'Network error communicating with Firebase Authentication. Check your connection and retry.';
    case 'auth/operation-not-allowed':
      return 'This sign-in provider is not enabled in the Firebase Console yet.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized in Firebase Console -> Authentication -> Settings -> Authorized domains.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid email or password.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Wait a moment before trying again.';
    case 'auth/user-disabled':
      return 'This operator account has been disabled in Firebase Authentication.';
    default:
      return err?.message || 'Authentication failed. Please try again.';
  }
}

let pendingRedirectPromise = null;

export function checkRedirectResult() {
  if (!isFirebaseConfigured || !firebaseAuth) {
    return Promise.resolve({ session: null, error: null });
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
          return { session: mapFirebaseUser(credential.user), error: null };
        }
        if (hadPendingRedirect && !firebaseAuth.currentUser) {
          return {
            session: null,
            error:
              'Redirect sign-in could not complete because browser third-party storage was partitioned. Allow pop-ups for this site to sign in with Google.',
          };
        }
        return { session: null, error: null };
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
        };
      });
  }
  return pendingRedirectPromise;
}

/**
 * Authoritative Firebase authentication lifecycle observer.
 * Waits for persistence + redirect resolution + initial onAuthStateChanged
 * before clearing authLoading so refreshes on #/dashboard do not bounce to #/signin.
 */
export function subscribeToAuthLifecycle({ onAuthState, onRedirectError }) {
  if (!isFirebaseConfigured || !firebaseAuth) {
    onAuthState({ authLoading: false, session: readRestoredGuestSession() });
    return () => {};
  }

  let disposed = false;
  let initialized = false;
  let unsubscribeFirebase = () => {};

  async function start() {
    onAuthState({ authLoading: true, session: null });

    const redirectOutcome = await checkRedirectResult();
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
      initialized = true;
      if (user) {
        clearGuestSessionFlag();
        onAuthState({ authLoading: false, session: mapFirebaseUser(user) });
      } else {
        onAuthState({ authLoading: false, session: readRestoredGuestSession() });
      }
    });

    // Guarantee initial loading resolves cleanly even if listener fires async
    if (!initialized && firebaseAuth.currentUser) {
      clearGuestSessionFlag();
      onAuthState({
        authLoading: false,
        session: mapFirebaseUser(firebaseAuth.currentUser),
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
    // Only auto-fallback to full-page redirect when authDomain shares the app origin;
    // cross-origin redirect on Chrome breaks due to third-party storage partitioning.
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
