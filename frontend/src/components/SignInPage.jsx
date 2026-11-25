import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Compass,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import {
  checkRedirectResult,
  createDemoSession,
  getAuthStatus,
  signInWithEmailPassword,
  signInWithOAuthProvider,
} from '../services/authService';

function GoogleLogo() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.4c-.2 1.2-1.4 3.6-5.4 3.6-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.1 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.6 0 9.4-3.9 9.4-9.5 0-.6-.1-1.1-.2-1.6H12z"
      />
      <path
        fill="#34A853"
        d="M3.4 7.3l3.2 2.3C7.5 7.4 9.6 5.9 12 5.9c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.1 14.6 2.2 12 2.2 8.2 2.2 4.9 4.4 3.4 7.3z"
      />
      <path
        fill="#FBBC05"
        d="M12 21.8c2.5 0 4.7-.8 6.3-2.3l-2.9-2.4c-.8.6-1.9 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1l-3.2 2.5c1.5 3.1 4.8 5.3 8.8 5.3z"
      />
      <path
        fill="#4285F4"
        d="M21.4 12.3c0-.7-.1-1.3-.2-1.9H12v3.9h5.4c-.3 1.3-1.1 2.4-2.1 3.1l2.9 2.4c1.7-1.6 3.2-4 3.2-7.5z"
      />
    </svg>
  );
}

function GitHubLogo() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.59 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.38-3.37-1.38-.46-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.85.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.31.1-2.72 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.84c.85 0 1.71.12 2.51.35 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.46.1 2.72.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.59.69.49A10.26 10.26 0 0 0 22 12.25C22 6.59 17.52 2 12 2z" />
    </svg>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

const OAUTH_PROVIDERS = [
  { id: 'google', label: 'Continue with Google', Icon: GoogleLogo },
  { id: 'github', label: 'Continue with GitHub', Icon: GitHubLogo },
  { id: 'microsoft', label: 'Continue with Microsoft', Icon: MicrosoftLogo },
];

export default function SignInPage({ onSignedIn, onBackToLanding }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [activeAuth, setActiveAuth] = useState(null); // 'google' | 'github' | 'microsoft' | 'password' | null

  const authStatus = getAuthStatus();
  const isBusy = activeAuth !== null;

  useEffect(() => {
    let cancelled = false;
    checkRedirectResult().then(({ session, error }) => {
      if (cancelled) return;
      if (session) {
        onSignedIn(session);
      } else if (error) {
        setSubmitError(error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [onSignedIn]);

  const validate = () => {
    const errors = {};
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      errors.email = 'Email address is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errors.email = 'Enter a valid email address.';
    }

    if (!password) {
      errors.password = 'Password is required.';
    } else if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleOAuthClick = (providerId) => {
    if (isBusy) return;
    // Call signInWithOAuthProvider synchronously in the click event stack before
    // scheduling any React state updates so browser transient user activation stays intact.
    const authPromise = signInWithOAuthProvider(providerId);
    setSubmitError('');
    setFieldErrors({});
    setActiveAuth(providerId);

    authPromise
      .then((session) => {
        if (session) {
          setPassword('');
          onSignedIn(session);
        }
      })
      .catch((err) => {
        setSubmitError(err.message || 'Provider authentication failed.');
        setActiveAuth(null);
      })
      .finally(() => {
        setActiveAuth((prev) => (prev === providerId ? null : prev));
      });
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');
    if (!validate() || isBusy) return;

    setActiveAuth('password');
    try {
      const session = await signInWithEmailPassword({ email, password });
      setPassword('');
      onSignedIn(session);
    } catch (err) {
      setSubmitError(err.message || 'Unable to sign in with email and password.');
    } finally {
      setActiveAuth(null);
    }
  };

  const handleContinueAsGuest = () => {
    if (isBusy) return;
    setPassword('');
    setFieldErrors({});
    setSubmitError('');
    onSignedIn(createDemoSession());
  };

  return (
    <div className="auth-split-page">
      {/* Left Section: Cinematic Earth & Thunderstorm Background + Branding */}
      <section className="auth-visual-pane" aria-label="WeatherGuard AI Overview">
        <div className="auth-earth-backdrop" aria-hidden="true">
          <div className="auth-earth-camera">
            <div className="auth-earth-img" />
            <div className="auth-storm-pulse" />
          </div>
          <div className="auth-horizon-tint" />
          <div className="auth-scrim" />
        </div>

        <motion.div
          className="auth-visual-content"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="auth-brand-row">
            <div className="auth-brand-mark">
              <ShieldCheck size={22} />
            </div>
            <div>
              <div className="auth-brand-name">WeatherGuard AI</div>
              <div className="auth-brand-team">Team Quest · HackKalp 2K26</div>
            </div>
          </div>

          <div className="auth-visual-copy">
            <h1 className="auth-tagline">
              Reliable Data.
              <br />
              Intelligent Decisions.
            </h1>
            <p className="auth-visual-desc">
              Real-time meteorological sensor assurance, automated anomaly
              classification, spatial validation, and black-box telemetry recovery
              for Automatic Weather Station networks.
            </p>
          </div>

          <div className="auth-visual-footer">
            <span>Meteorological Operations Console</span>
            <span>·</span>
            <span>AWS Telemetry Quality Assurance</span>
          </div>
        </motion.div>
      </section>

      {/* Right Section: Matte Dark Navy Multi-Provider Authentication */}
      <section className="auth-form-pane" aria-label="Sign in options">
        <motion.div
          className="auth-form-card"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="auth-top-row">
            <button
              type="button"
              className="auth-back-link"
              onClick={onBackToLanding}
            >
              <ArrowLeft size={14} />
              <span>Back to Home</span>
            </button>

            <span className="auth-mode-badge">
              {authStatus.isFirebaseConfigured
                ? 'Firebase Auth Active'
                : 'Guest Demo Ready'}
            </span>
          </div>

          <motion.div
            className="auth-form-header"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, delay: 0.05 }}
          >
            <h2>Sign in to Command Centre</h2>
            <p>
              Authenticate via a configured provider or use Continue as Guest
              for immediate hackathon evaluation.
            </p>
          </motion.div>

          {!authStatus.isFirebaseConfigured && (
            <motion.div
              className="auth-demo-notice"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, delay: 0.09 }}
            >
              {authStatus.unconfiguredReason}
            </motion.div>
          )}

          {/* OAuth Provider Stack */}
          <div className="auth-oauth-stack">
            {OAUTH_PROVIDERS.map(({ id, label, Icon }, idx) => {
              const isEnabled = Boolean(authStatus.enabledProviders[id]);
              const isLoadingThis = activeAuth === id;
              return (
                <motion.button
                  key={id}
                  type="button"
                  whileTap={isEnabled ? { scale: 0.98 } : undefined}
                  disabled={!isEnabled || isBusy}
                  title={
                    !isEnabled
                      ? `${label} is disabled until Firebase configuration is set in .env`
                      : label
                  }
                  className="auth-oauth-btn"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.1 + idx * 0.05 }}
                  onClick={() => handleOAuthClick(id)}
                >
                  <span className="auth-oauth-icon">
                    {isLoadingThis ? (
                      <Loader2 size={16} className="rc-spin" />
                    ) : (
                      <Icon />
                    )}
                  </span>
                  <span>{isLoadingThis ? 'Connecting...' : label}</span>
                </motion.button>
              );
            })}
          </div>

          <div className="auth-divider">
            <span>or sign in with email</span>
          </div>

          <form className="auth-form" onSubmit={handleEmailSubmit} noValidate>
            <motion.div
              className="auth-field"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.25 }}
            >
              <label htmlFor="signin-email">Email Address</label>
              <div
                className={`auth-input-wrap ${
                  fieldErrors.email ? 'auth-input-invalid' : ''
                }`}
              >
                <Mail size={15} className="auth-input-icon" />
                <input
                  id="signin-email"
                  type="email"
                  autoComplete="email"
                  disabled={!authStatus.enabledProviders.password || isBusy}
                  placeholder="operator@weatherguard.ai"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (fieldErrors.email) {
                      setFieldErrors((prev) => ({ ...prev, email: '' }));
                    }
                  }}
                />
              </div>
              {fieldErrors.email && (
                <span className="auth-field-error" role="alert">
                  {fieldErrors.email}
                </span>
              )}
            </motion.div>

            <motion.div
              className="auth-field"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.3 }}
            >
              <label htmlFor="signin-password">Password</label>
              <div
                className={`auth-input-wrap ${
                  fieldErrors.password ? 'auth-input-invalid' : ''
                }`}
              >
                <Lock size={15} className="auth-input-icon" />
                <input
                  id="signin-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  disabled={!authStatus.enabledProviders.password || isBusy}
                  placeholder="Minimum 6 characters"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (fieldErrors.password) {
                      setFieldErrors((prev) => ({ ...prev, password: '' }));
                    }
                  }}
                />
                <button
                  type="button"
                  className="auth-pw-toggle"
                  disabled={!authStatus.enabledProviders.password || isBusy}
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {fieldErrors.password && (
                <span className="auth-field-error" role="alert">
                  {fieldErrors.password}
                </span>
              )}
            </motion.div>

            {submitError && (
              <div className="auth-submit-error" role="alert">
                <AlertCircle size={15} />
                <span>{submitError}</span>
              </div>
            )}

            <motion.div
              className="auth-actions"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.35 }}
            >
              <motion.button
                type="submit"
                whileTap={
                  authStatus.enabledProviders.password ? { scale: 0.98 } : undefined
                }
                disabled={!authStatus.enabledProviders.password || isBusy}
                title={
                  !authStatus.enabledProviders.password
                    ? 'Email sign-in requires Firebase configuration in .env'
                    : 'Sign in with Email and Password'
                }
                className="auth-btn auth-btn-primary"
              >
                {activeAuth === 'password' ? (
                  <>
                    <Loader2 size={16} className="rc-spin" />
                    <span>Signing In...</span>
                  </>
                ) : (
                  <>
                    <span>Sign In with Email</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </motion.button>

              <motion.button
                type="button"
                whileTap={{ scale: 0.98 }}
                disabled={isBusy}
                className="auth-btn auth-btn-demo"
                onClick={handleContinueAsGuest}
              >
                <Compass size={16} />
                <span>Continue as Guest</span>
              </motion.button>
            </motion.div>
          </form>
        </motion.div>
      </section>
    </div>
  );
}
