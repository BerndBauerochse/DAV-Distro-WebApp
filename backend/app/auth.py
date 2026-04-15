"""
Authentication: two hardcoded users (Bernd, Doro).
Passwords are read from environment variables and hashed at startup.
"""
import os
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext

JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production-use-a-long-random-string")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 12

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer()

# Users: username -> bcrypt hash of password
# Passwords come from env vars; hashed once at module load time.
_RAW_USERS = {
    "bernd": os.getenv("USER_BERND_PASSWORD", "Bx7@kP3mLw"),
    "doro": os.getenv("USER_DORO_PASSWORD", "Qn5!sJ7vYe"),
}

USERS: dict[str, str] = {
    username: pwd_context.hash(password)
    for username, password in _RAW_USERS.items()
}


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def authenticate_user(username: str, password: str) -> str | None:
    """Returns username if credentials are valid, else None."""
    hashed = USERS.get(username.lower())
    if not hashed:
        return None
    if not verify_password(password, hashed):
        return None
    return username.lower()


def create_access_token(username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    return jwt.encode(
        {"sub": username, "exp": expire},
        JWT_SECRET,
        algorithm=ALGORITHM,
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> str:
    """FastAPI dependency — returns the username from a valid JWT."""
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        username: str | None = payload.get("sub")
        if not username:
            raise ValueError("no sub")
    except (JWTError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return username
