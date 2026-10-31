"""FastAPI application: REST API + the built React frontend.

Run:  python -m uvicorn app.main:create_app --factory --port 8000
"""
import asyncio
import time
from contextlib import asynccontextmanager
from typing import Callable, Literal

from fastapi import APIRouter, Depends, FastAPI, Query, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import config
from .auth import AuthService, Forbidden, Unauthorized
from .network import Network, build_default_network
from .services import (Conflict, DailyLimitReached, FeatureUnavailable, InvalidInput, NotFound, RateLimited,
                       TransitService)
from .simulator import Simulator
from .store import Store


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(min_length=5, max_length=120)
    password: str = Field(min_length=6, max_length=128)


class LoginIn(BaseModel):
    email: str = Field(max_length=120)
    password: str = Field(max_length=128)


class ReportIn(BaseModel):
    route_id: str
    level: Literal["low", "medium", "high"]
    bus_id: str | None = None
    stop_id: str | None = None
    # optional reporter location: proof of presence used to verify the report
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)


class TrackingIn(BaseModel):
    route_id: str
    bus_id: str
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    speed_kmh: float | None = Field(default=None, ge=0, le=120)
    accuracy_m: float | None = Field(default=None, ge=0)


class GpsIn(BaseModel):
    bus_id: str
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    speed_kmh: float | None = Field(default=None, ge=0, le=120)


def _svc(request: Request) -> TransitService:
    return request.app.state.service


def _auth(request: Request) -> AuthService:
    return request.app.state.auth


def _token(request: Request) -> str | None:
    header = request.headers.get("Authorization", "")
    return header[7:] if header.startswith("Bearer ") else None


def current_user(request: Request) -> dict:
    user = _auth(request).user_for_token(_token(request))
    if user is None:
        raise Unauthorized("Daxil olmaq tələb olunur")
    return user


def operator_user(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "operator":
        raise Forbidden("Bu bölmə yalnız operatorlar üçündür")
    return user


# --- auth -------------------------------------------------------------------------
auth_router = APIRouter(prefix="/api/auth", tags=["auth"])


@auth_router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request):
    return _auth(request).register(body.name, body.email, body.password)


@auth_router.post("/login")
def login(body: LoginIn, request: Request):
    return _auth(request).login(body.email, body.password)


@auth_router.get("/me")
def me(user: dict = Depends(current_user)):
    return user


@auth_router.post("/logout", status_code=204)
def logout(request: Request, user: dict = Depends(current_user)):
    _auth(request).logout(_token(request))


# --- passenger module (any signed-in user) ------------------------------------------
router = APIRouter(prefix="/api", tags=["passenger"])


@router.get("/health")
def health(request: Request):
    return {"status": "ok", "buses": _svc(request).store.count_buses()}


@router.get("/network", dependencies=[Depends(current_user)])
def network(request: Request):
    return _svc(request).network_view()


@router.get("/buses", dependencies=[Depends(current_user)])
def buses(request: Request, route_id: str | None = None):
    return _svc(request).buses(route_id)


@router.get("/routes/{route_id}/live", dependencies=[Depends(current_user)])
def route_live(route_id: str, request: Request):
    return _svc(request).route_live(route_id)


@router.get("/stops/{stop_id}/arrivals", dependencies=[Depends(current_user)])
def stop_arrivals(stop_id: str, request: Request):
    return _svc(request).arrivals(stop_id)


@router.get("/arrivals", dependencies=[Depends(current_user)])
def multi_arrivals(request: Request, stops: str = Query(..., max_length=500)):
    """Arrivals for several stops at once, e.g. ?stops=s1,s2 (same stop name on both sides of a street)."""
    return _svc(request).arrivals_multi(stops.split(","))


@router.post("/reports", status_code=201)
def create_report(body: ReportIn, request: Request, user: dict = Depends(current_user)):
    # The account id is the reporter identity: one report per line per cooldown.
    return _svc(request).submit_report(body.route_id, body.level, f"user-{user['id']}", body.bus_id, body.stop_id,
                                       lat=body.lat, lon=body.lon)


@router.get("/rewards/me")
def my_rewards(request: Request, user: dict = Depends(current_user)):
    return _svc(request).rewards(f"user-{user['id']}")


@router.post("/rewards/redeem")
def redeem(request: Request, user: dict = Depends(current_user)):
    return _svc(request).redeem_trip(f"user-{user['id']}")


@router.post("/tracking", status_code=202)
def phone_tracking(body: TrackingIn, request: Request, user: dict = Depends(current_user)):
    """'I'm on this bus': the passenger's phone location becomes the bus GPS."""
    return _svc(request).track_from_phone(body.route_id, body.bus_id, body.lat, body.lon,
                                          body.speed_kmh, body.accuracy_m)


@router.post("/gps", status_code=202)
def ingest_gps(body: GpsIn, request: Request):
    return _svc(request).ingest_gps(body.bus_id, body.lat, body.lon, body.speed_kmh)


# --- operator module ------------------------------------------------------------------
ops_router = APIRouter(prefix="/api", tags=["operator"], dependencies=[Depends(operator_user)])


@ops_router.get("/operator/overview")
def overview(request: Request):
    return _svc(request).overview()


@ops_router.get("/operator/alerts")
def alerts(request: Request, status: Literal["open", "dispatched", "dismissed"] | None = None,
           limit: int = Query(20, ge=1, le=200)):
    return _svc(request).alerts(status, limit)


@ops_router.post("/operator/alerts/{alert_id}/dispatch")
def dispatch(alert_id: int, request: Request):
    return _svc(request).dispatch_alert(alert_id)


@ops_router.post("/operator/alerts/{alert_id}/dismiss")
def dismiss(alert_id: int, request: Request):
    return _svc(request).dismiss_alert(alert_id)


@ops_router.get("/operator/reports")
def reports(request: Request, limit: int = Query(20, ge=1, le=200)):
    return _svc(request).recent_reports(limit)


@ops_router.post("/demo/rush/{route_id}")
def demo_rush(route_id: str, request: Request):
    return _svc(request).demo_rush(route_id)


class SPAStaticFiles(StaticFiles):
    """Serves the React build; unknown non-API paths fall back to index.html
    so client-side routes like /operator and /login work on reload."""

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or path.startswith("api"):
                raise
            return await super().get_response("index.html", scope)


def create_app(db_path: str | None = None, simulate: bool | None = None,
               clock: Callable[[], float] = time.time, network: Network | None = None) -> FastAPI:
    store = Store(db_path or config.DB_PATH)
    service = TransitService(store, network or build_default_network(), clock)
    service.seed_fleet()
    auth = AuthService(store, clock)
    auth.ensure_operator(config.OPERATOR_EMAIL, config.OPERATOR_PASSWORD)
    simulate = config.SIMULATE if simulate is None else simulate

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        task = None
        if simulate:
            sim = Simulator(service)
            sim.backfill_reports()
            task = asyncio.create_task(sim.run())
        yield
        if task:
            task.cancel()

    app = FastAPI(title="Smart Transit & Crowdsourcing Engine", version="1.0.0", lifespan=lifespan)
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    app.state.service = service
    app.state.auth = auth

    def error(status: int):
        return lambda request, exc: JSONResponse({"detail": str(exc)}, status_code=status)

    app.add_exception_handler(NotFound, error(404))
    app.add_exception_handler(InvalidInput, error(422))
    app.add_exception_handler(Conflict, error(409))
    app.add_exception_handler(Unauthorized, error(401))
    app.add_exception_handler(Forbidden, error(403))
    app.add_exception_handler(FeatureUnavailable, error(403))
    app.add_exception_handler(DailyLimitReached, error(429))

    @app.exception_handler(RateLimited)
    def rate_limited(request: Request, exc: RateLimited):
        return JSONResponse({"detail": str(exc), "retry_after": exc.retry_after}, status_code=429,
                            headers={"Retry-After": str(exc.retry_after)})

    app.include_router(auth_router)
    app.include_router(router)
    app.include_router(ops_router)
    if config.STATIC_DIR.exists():
        app.mount("/", SPAStaticFiles(directory=config.STATIC_DIR, html=True), name="static")
    return app
