"""Accounts and sessions. Passwords are stored as salted PBKDF2-SHA256 hashes;
sessions are random bearer tokens with an expiry."""
import hashlib
import hmac
import re
import secrets
from typing import Callable

from . import config
from .services import Conflict, InvalidInput
from .store import Store

ITERATIONS = 200_000
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class Unauthorized(Exception):
    pass


class Forbidden(Exception):
    pass


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS)
    return f"pbkdf2${ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt_hex, digest_hex = stored.split("$")
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations))
    except ValueError:
        return False
    return hmac.compare_digest(digest.hex(), digest_hex)


class AuthService:
    def __init__(self, store: Store, clock: Callable[[], float]):
        self.store = store
        self.clock = clock

    @staticmethod
    def _public(user: dict) -> dict:
        return {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"]}

    def ensure_operator(self, email: str, password: str) -> None:
        """Operators are not self-registered; a default account is created on start."""
        if self.store.get_user_by_email(email) is None:
            self.store.create_user("Operator", email, hash_password(password), "operator", self.clock())

    def register(self, name: str, email: str, password: str) -> dict:
        email = email.strip().lower()
        name = name.strip()
        if len(name) < 2:
            raise InvalidInput("Ad ən azı 2 simvol olmalıdır")
        if not EMAIL_RE.match(email):
            raise InvalidInput("E-poçt ünvanı düzgün deyil")
        if len(password) < 6:
            raise InvalidInput("Şifrə ən azı 6 simvol olmalıdır")
        if self.store.get_user_by_email(email):
            raise Conflict("Bu e-poçt ilə artıq hesab var")
        self.store.create_user(name, email, hash_password(password), "passenger", self.clock())
        return self.login(email, password)

    def login(self, email: str, password: str) -> dict:
        user = self.store.get_user_by_email(email.strip().lower())
        if user is None or not verify_password(password, user["password_hash"]):
            raise Unauthorized("E-poçt və ya şifrə yanlışdır")
        token = secrets.token_urlsafe(32)
        self.store.create_session(token, user["id"], self.clock() + config.SESSION_TTL_SEC)
        return {"token": token, "user": self._public(user)}

    def user_for_token(self, token: str | None) -> dict | None:
        if not token:
            return None
        return self.store.user_for_token(token, self.clock())

    def logout(self, token: str) -> None:
        self.store.delete_session(token)
