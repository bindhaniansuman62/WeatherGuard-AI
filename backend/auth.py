"""Firebase ID token verification helper with strict fail-closed security.

Separates two explicit access modes:
1. Public Demonstration Access (`WEATHERGUARD_REQUIRE_AUTH=false`, default):
   Unauthenticated requests are allowed for local/hackathon evaluation and
   explicitly marked `authenticated=False`, `access_mode="public_demo"`.
   Bearer tokens supplied in public mode are ONLY accepted as authenticated
   when cryptographically verified via `firebase-admin`.
2. Strict Authenticated Access (`WEATHERGUARD_REQUIRE_AUTH=true`):
   NEVER accepts unsigned or cryptographically unverified tokens. Requires
   `firebase-admin` initialized with Firebase project/credentials; missing,
   expired, invalid, or unverified tokens fail closed with HTTP 401/503.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

from fastapi import Header, HTTPException

try:
    import firebase_admin  # type: ignore
    from firebase_admin import auth as firebase_auth_admin, credentials  # type: ignore

    _HAS_FIREBASE_ADMIN = True
except ImportError:
    firebase_admin = None
    firebase_auth_admin = None
    credentials = None
    _HAS_FIREBASE_ADMIN = False

_FIREBASE_APP_INITIALIZED = False


def _ensure_firebase_admin() -> bool:
    global _FIREBASE_APP_INITIALIZED
    if not _HAS_FIREBASE_ADMIN:
        return False
    if _FIREBASE_APP_INITIALIZED:
        return True
    if firebase_admin._apps:
        _FIREBASE_APP_INITIALIZED = True
        return True

    cred_path = os.getenv("FIREBASE_CREDENTIALS_PATH") or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    project_id = os.getenv("FIREBASE_PROJECT_ID") or os.getenv("VITE_FIREBASE_PROJECT_ID")
    try:
        if cred_path and os.path.exists(cred_path):
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred, {"projectId": project_id} if project_id else None)
            _FIREBASE_APP_INITIALIZED = True
            return True
        if project_id:
            firebase_admin.initialize_app(options={"projectId": project_id})
            _FIREBASE_APP_INITIALIZED = True
            return True
    except Exception:
        return False
    return False


def get_auth_config_status() -> Dict[str, Any]:
    project_id = os.getenv("FIREBASE_PROJECT_ID") or os.getenv("VITE_FIREBASE_PROJECT_ID")
    cred_path = os.getenv("FIREBASE_CREDENTIALS_PATH") or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    require_auth = os.getenv("WEATHERGUARD_REQUIRE_AUTH", "false").lower() == "true"
    admin_ready = _ensure_firebase_admin()

    if admin_ready:
        mode = "firebase_admin_verified"
        configured = True
    elif require_auth:
        mode = "strict_auth_unavailable_missing_admin_sdk"
        configured = False
    else:
        mode = "public_demo_unconfigured"
        configured = False

    return {
        "configured": configured,
        "mode": mode,
        "require_auth": require_auth,
        "access_mode": "strict_authenticated" if require_auth else "public_demo",
        "firebase_admin_installed": _HAS_FIREBASE_ADMIN,
        "credentials_configured": bool(cred_path and os.path.exists(cred_path)),
        "project_id_configured": bool(project_id),
    }


def verify_bearer_token(token: str) -> Dict[str, Any]:
    """Verify a Firebase ID token cryptographically via firebase-admin only."""
    if not _ensure_firebase_admin() or firebase_auth_admin is None:
        raise RuntimeError(
            "Cryptographic Firebase ID token verification requires firebase-admin "
            "with FIREBASE_PROJECT_ID or service account credentials configured."
        )

    decoded = firebase_auth_admin.verify_id_token(token)
    return {
        "uid": decoded.get("uid") or decoded.get("sub"),
        "email": decoded.get("email"),
        "name": decoded.get("name"),
        "provider": decoded.get("firebase", {}).get("sign_in_provider", "firebase"),
        "verified_signature": True,
        "verification_mode": "firebase_admin_verified",
    }


def get_optional_operator(
    authorization: Optional[str] = Header(default=None),
) -> Optional[Dict[str, Any]]:
    status = get_auth_config_status()
    require_auth = status["require_auth"]

    if require_auth and not status["configured"]:
        raise HTTPException(
            status_code=503,
            detail=(
                "Strict authentication mode is enabled, but cryptographic Firebase "
                "verification (firebase-admin + credentials/project ID) is not available."
            ),
        )

    if not authorization:
        if require_auth:
            raise HTTPException(
                status_code=401,
                detail="Authentication required: missing Authorization Bearer Firebase ID token.",
            )
        return None

    if not authorization.lower().startswith("bearer "):
        if require_auth:
            raise HTTPException(
                status_code=401,
                detail="Invalid Authorization header format. Expected 'Bearer <token>'.",
            )
        return None

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        if require_auth:
            raise HTTPException(status_code=401, detail="Empty Bearer token.")
        return None

    try:
        return verify_bearer_token(token)
    except Exception as exc:
        if require_auth:
            raise HTTPException(
                status_code=401,
                detail=f"Cryptographic Firebase ID token verification failed: {exc}",
            ) from exc
        # In public demo mode without backend firebase-admin, fall back to unauthenticated demo context
        return None
