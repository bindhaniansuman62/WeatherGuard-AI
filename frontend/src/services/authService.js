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
  microsoftProvider,
} from './firebase';

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
    statusNote: `Signed in via ${providerLabel}. Coordinate backend ID-token verification for protected API routes.`,
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
      return 'Sign-in popup was blocked or lost browser context. Ensure third-party cookies/storage are enabled or try again.';
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
    pendingRedirectPromise = getRedirectResult(
      firebaseAuth,
      browserPopupRedirectResolver
    )
      .then((credential) => ({
        session: credential?.user ? mapFirebaseUser(credential.user) : null,
        error: null,
      }))
      .catch((err) => ({
        session: null,
        error: mapFirebaseError(err),
      }));
  }
  return pendingRedirectPromise;
}

export function subscribeToAuthChanges(onSessionChange) {
  if (!isFirebaseConfigured || !firebaseAuth) {
    onSessionChange(null);
    return () => {};
  }

  checkRedirectResult().then(({ session }) => {
    if (session) {
      onSessionChange(session);
    }
  });

  return onAuthStateChanged(firebaseAuth, (user) => {
    onSessionChange(mapFirebaseUser(user));
  });
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
    return mapFirebaseUser(credential.user);
  } catch (err) {
    if (err?.code === 'auth/popup-blocked') {
      try {
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
  if (isFirebaseConfigured && firebaseAuth && session?.mode === 'firebase') {
    await signOut(firebaseAuth);
  }
}
