"""Password hashing and bearer-token session auth. Stdlib only - no external
auth service or heavy dependency required."""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from backend.database import AuthToken, User, get_db

PBKDF2_ITERATIONS = 200_000
TOKEN_TTL_DAYS = 30
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


# Hashes a password with a random salt (PBKDF2-SHA256). Stored as "salt$hash".
def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS)
    return f"{salt}${digest.hex()}"


# Recomputes the hash with the stored salt and compares in constant time.
def verify_password(password: str, password_hash: str) -> bool:
    try:
        salt, hex_digest = password_hash.split("$", 1)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS)
    return hmac.compare_digest(digest.hex(), hex_digest)


def lockout_remaining_seconds(user: User) -> int:
    """0 if not locked, otherwise seconds until the lock clears."""
    if not user.locked_until:
        return 0
    remaining = (user.locked_until - datetime.utcnow()).total_seconds()
    return max(0, int(remaining))


# Bumps the failure counter; locks the account once it hits the limit.
def register_failed_login(db: Session, user: User) -> None:
    user.failed_login_attempts += 1
    if user.failed_login_attempts >= MAX_FAILED_ATTEMPTS:
        user.locked_until = datetime.utcnow() + timedelta(minutes=LOCKOUT_MINUTES)
        user.failed_login_attempts = 0
    db.add(user)
    db.commit()


# Resets the failure counter/lock after a successful login.
def register_successful_login(db: Session, user: User) -> None:
    user.failed_login_attempts = 0
    user.locked_until = None
    db.add(user)
    db.commit()


# Issues a new random bearer token for a session, valid for TOKEN_TTL_DAYS.
def create_token(db: Session, user: User) -> AuthToken:
    token = AuthToken(
        token=secrets.token_urlsafe(32),
        user_id=user.id,
        created_at=datetime.utcnow(),
        expires_at=datetime.utcnow() + timedelta(days=TOKEN_TTL_DAYS),
    )
    db.add(token)
    db.flush()
    return token


# FastAPI dependency: resolves the "Authorization: Bearer <token>" header into
# a User, or raises 401. Expired tokens are deleted on sight.
def get_current_user(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    raw_token = authorization.split(" ", 1)[1].strip()
    row = db.query(AuthToken).filter(AuthToken.token == raw_token).first()
    if not row:
        raise HTTPException(status_code=401, detail="Invalid session. Please log in again.")
    if row.expires_at < datetime.utcnow():
        db.delete(row)
        db.commit()
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    user = db.get(User, row.user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found.")
    return user
