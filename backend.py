from __future__ import annotations

import json
import os
import secrets
import smtplib
import threading
import time
from base64 import urlsafe_b64encode
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from functools import wraps
from pathlib import Path
from zoneinfo import ZoneInfo

from cryptography.hazmat.primitives.serialization import load_pem_private_key
from flask import Flask, g, jsonify, request, send_from_directory, session as flask_session
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, create_engine, event, func, inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, scoped_session, sessionmaker
from werkzeug.security import check_password_hash, generate_password_hash

try:
    from pywebpush import WebPushException, webpush
except ImportError:
    WebPushException = Exception
    webpush = None

try:
    import resend
except ImportError:
    resend = None

BASE_DIR = Path(__file__).resolve().parent
raw_db_url = os.environ.get("DATABASE_URL", "").strip()
if raw_db_url.startswith("postgres://"):
    raw_db_url = raw_db_url.replace("postgres://", "postgresql+psycopg://", 1)
elif raw_db_url.startswith("postgresql://") and "+psycopg" not in raw_db_url:
    raw_db_url = raw_db_url.replace("postgresql://", "postgresql+psycopg://", 1)
DATABASE_URL = raw_db_url or f"sqlite:///{(BASE_DIR / 'sase_portal.db').as_posix()}"
OFFICER_INVITE_CODE = os.environ.get("OFFICER_INVITE_CODE", "SASE-OFFICER")
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-change-me")
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "").replace("\\n", "\n")
VAPID_CLAIMS_SUBJECT = os.environ.get("VAPID_CLAIMS_SUBJECT", "mailto:ryankreger364@gmail.com")
APP_TIMEZONE = os.environ.get("APP_TIMEZONE", "America/New_York")
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USERNAME = os.environ.get("SMTP_USERNAME", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM_EMAIL = os.environ.get("SMTP_FROM_EMAIL", "")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
RESEND_FROM_EMAIL = os.environ.get("RESEND_FROM_EMAIL", "")
RESEND_REPLY_TO = os.environ.get("RESEND_REPLY_TO", "")
APP_BASE_URL = os.environ.get("APP_BASE_URL", "").rstrip("/")
RENDER_SERVICE_NAME = os.environ.get("RENDER_SERVICE_NAME", "")
PUSH_DEBUG_FLAG = os.environ.get("PUSH_DEBUG_FLAG", "")
YEAR_OPTIONS = {"First Year", "Second Year", "Third Year", "Fourth Year", "Graduate"}
EVENT_TYPES = {"Social", "GBM", "Professional", "Workshop"}
EVENT_STATUSES = {"upcoming", "completed"}


def normalize_vapid_private_key(private_key: str) -> str:
    candidate = (private_key or "").strip()
    if not candidate:
        return ""
    if "BEGIN PRIVATE KEY" not in candidate:
        return candidate

    private_obj = load_pem_private_key(candidate.encode("utf-8"), password=None)
    raw_private = private_obj.private_numbers().private_value.to_bytes(32, "big")
    return urlsafe_b64encode(raw_private).decode("utf-8").rstrip("=")


VAPID_PRIVATE_KEY = normalize_vapid_private_key(VAPID_PRIVATE_KEY)

app = Flask(__name__, static_folder=".")
app.config["SECRET_KEY"] = SECRET_KEY
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
notification_worker_started = False


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    major: Mapped[str] = mapped_column(String(255), nullable=False)
    year: Mapped[str] = mapped_column(String(50), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    position: Mapped[str | None] = mapped_column(String(255))
    stars: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    eligible_for_leaderboard: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    bio: Mapped[str | None] = mapped_column(Text)
    profile_image: Mapped[str | None] = mapped_column(Text)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    verification_token: Mapped[str | None] = mapped_column(String(255))
    verification_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reset_token: Mapped[str | None] = mapped_column(String(255))
    reset_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_events: Mapped[list["Event"]] = relationship(back_populates="creator")
    interests: Mapped[list["EventInterest"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    rsvps: Mapped[list["EventRsvp"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    attendance_records: Mapped[list["EventAttendance"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    push_subscriptions: Mapped[list["PushSubscription"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Event(Base):
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    date: Mapped[str] = mapped_column(String(80), nullable=False)
    time: Mapped[str] = mapped_column(String(80), nullable=False)
    location: Mapped[str] = mapped_column(String(255), nullable=False)
    stars: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    checkin_token: Mapped[str | None] = mapped_column(String(255))
    checkin_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    attendance_code: Mapped[str | None] = mapped_column(String(20))
    reminder_notification_sent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    start_notification_sent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    creator: Mapped[User | None] = relationship(back_populates="created_events")
    interests: Mapped[list["EventInterest"]] = relationship(back_populates="event", cascade="all, delete-orphan")
    rsvps: Mapped[list["EventRsvp"]] = relationship(back_populates="event", cascade="all, delete-orphan")
    attendance_records: Mapped[list["EventAttendance"]] = relationship(back_populates="event", cascade="all, delete-orphan")


class EventInterest(Base):
    __tablename__ = "event_interest"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    user: Mapped[User] = relationship(back_populates="interests")
    event: Mapped[Event] = relationship(back_populates="interests")


class EventRsvp(Base):
    __tablename__ = "event_rsvp"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    user: Mapped[User] = relationship(back_populates="rsvps")
    event: Mapped[Event] = relationship(back_populates="rsvps")


class EventAttendance(Base):
    __tablename__ = "event_attendance"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    user: Mapped[User] = relationship(back_populates="attendance_records")
    event: Mapped[Event] = relationship(back_populates="attendance_records")


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    endpoint: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    p256dh: Mapped[str] = mapped_column(Text, nullable=False)
    auth: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    user: Mapped[User] = relationship(back_populates="push_subscriptions")


engine = create_engine(DATABASE_URL, future=True)
SessionLocal = scoped_session(sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False))


@event.listens_for(Engine, "connect")
def enable_sqlite_foreign_keys(dbapi_connection, connection_record):
    if "sqlite3" in dbapi_connection.__class__.__module__:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


@app.before_request
def open_db_session():
    g.db = SessionLocal()


@app.teardown_request
def close_db_session(exc):
    db = g.pop("db", None)
    if db is None:
        return
    if exc is not None:
        db.rollback()
    db.close()
    SessionLocal.remove()


def get_db():
    return g.db


def utc_now():
    return datetime.now(timezone.utc)


def ensure_column(table_name, column_name, column_sql):
    inspector = inspect(engine)
    existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
    if column_name in existing_columns:
        return
    with engine.begin() as connection:
        connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}"))


def init_db():
    Base.metadata.create_all(engine)
    ensure_column("users", "profile_image", "TEXT")
    ensure_column("users", "email_verified", "BOOLEAN DEFAULT TRUE NOT NULL")
    ensure_column("users", "verification_token", "VARCHAR(255)")
    ensure_column("users", "verification_token_expires_at", "TIMESTAMP")
    ensure_column("users", "reset_token", "VARCHAR(255)")
    ensure_column("users", "reset_token_expires_at", "TIMESTAMP")
    ensure_column("events", "reminder_notification_sent", "BOOLEAN DEFAULT FALSE NOT NULL")
    ensure_column("events", "start_notification_sent", "BOOLEAN DEFAULT FALSE NOT NULL")
    with Session(engine) as db:
        if (db.scalar(select(func.count()).select_from(Event)) or 0) == 0:
            db.add_all([
                Event(title="April GBM", type="GBM", status="completed", date="Thu, Apr 10", time="6:30 PM", location="STEM Center 202", stars=50, description="General body meeting with chapter updates, member shoutouts, and committee planning.", created_at=utc_now()),
                Event(title="SASE Social Night", type="Social", status="upcoming", date="Tue, Apr 15", time="7:00 PM", location="Student Union Lounge", stars=30, description="Relax, meet new members, and build community with games and small group conversations.", created_at=utc_now()),
                Event(title="Industry Networking Mixer", type="Professional", status="upcoming", date="Fri, Apr 18", time="5:30 PM", location="Innovation Atrium", stars=70, description="Connect with recruiters, alumni, and professionals across engineering and STEM industries.", created_at=utc_now()),
                Event(title="Technical Case Study Workshop", type="Workshop", status="upcoming", date="Wed, Apr 23", time="6:00 PM", location="Engineering Hall 114", stars=60, description="Practice collaborative problem solving and communication with a guided technical challenge.", created_at=utc_now()),
            ])
            db.commit()


def push_notifications_configured():
    return webpush is not None and bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)


def push_notifications_status():
    return {
        "supported": push_notifications_configured(),
        "publicKey": VAPID_PUBLIC_KEY,
        "debug": {
            "webpushLoaded": webpush is not None,
            "hasPublicKey": bool(VAPID_PUBLIC_KEY),
            "hasPrivateKey": bool(VAPID_PRIVATE_KEY),
            "renderService": RENDER_SERVICE_NAME,
            "debugFlag": PUSH_DEBUG_FLAG,
        },
    }


def resend_configured():
    return resend is not None and bool(RESEND_API_KEY and RESEND_FROM_EMAIL)


def email_configured():
    return bool(SMTP_HOST and SMTP_FROM_EMAIL)


def build_app_base_url(base_url=""):
    return (base_url.rstrip("/") or APP_BASE_URL).rstrip("/")


def send_transactional_email(recipient_email, subject, html, text_content=""):
    if resend_configured():
        resend.api_key = RESEND_API_KEY
        params = {
            "from": RESEND_FROM_EMAIL,
            "to": [recipient_email],
            "subject": subject,
            "html": html,
            "text": text_content or "",
        }
        if RESEND_REPLY_TO:
            params["reply_to"] = RESEND_REPLY_TO
        resend.Emails.send(params)
        return True

    if email_configured():
        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = SMTP_FROM_EMAIL
        message["To"] = recipient_email
        if text_content:
            message.set_content(text_content)
            message.add_alternative(html, subtype="html")
        else:
            message.set_content(html)
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as smtp:
            smtp.starttls()
            if SMTP_USERNAME and SMTP_PASSWORD:
                smtp.login(SMTP_USERNAME, SMTP_PASSWORD)
            smtp.send_message(message)
        return True

    return False


def get_app_timezone():
    try:
        return ZoneInfo(APP_TIMEZONE)
    except Exception:
        return ZoneInfo("America/New_York")


def parse_event_datetime(event_obj):
    event_stamp = f"{event_obj.date} {event_obj.time}".strip()
    formats = [
        "%a, %b %d %I:%M %p",
        "%A, %b %d %I:%M %p",
        "%b %d %I:%M %p",
        "%a %b %d %I:%M %p",
        "%A %b %d %I:%M %p"
    ]
    for fmt in formats:
        try:
            naive = datetime.strptime(event_stamp, fmt)
            return naive.replace(year=datetime.now(get_app_timezone()).year, tzinfo=get_app_timezone())
        except ValueError:
            continue
    return None


def build_push_payload(title, body, event_obj=None):
    payload = {"title": title, "body": body, "url": "/"}
    if event_obj is not None:
        payload["url"] = f"/?event={event_obj.id}"
        payload["tag"] = f"event-{event_obj.id}"
    return json.dumps(payload)


def send_push_to_rows(rows, payload, db=None):
    if not push_notifications_configured() or webpush is None:
        return 0, 0, []
    active_db = db or get_db()
    delivered = 0
    failed = 0
    errors = []
    for row in rows:
        try:
            webpush(subscription_info={"endpoint": row.endpoint, "keys": {"p256dh": row.p256dh, "auth": row.auth}}, data=payload, vapid_private_key=VAPID_PRIVATE_KEY, vapid_claims={"sub": VAPID_CLAIMS_SUBJECT})
            delivered += 1
        except WebPushException as exc:
            failed += 1
            error_text = str(exc)
            print(f"Web push error for {row.endpoint}: {error_text}")
            if len(errors) < 3:
                errors.append(error_text)
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            if status_code in {404, 410} or "VapidPkHashMismatch" in error_text or "do not correspond to the credentials used to create the subscriptions" in error_text:
                active_db.delete(row)
        except Exception as exc:
            failed += 1
            print(f"Unexpected web push error for {row.endpoint}: {exc!r}")
            if len(errors) < 3:
                errors.append(repr(exc))
    active_db.commit()
    return delivered, failed, errors


def send_event_push_to_all(db, event_obj, title, body):
    rows = db.scalars(select(PushSubscription).order_by(PushSubscription.created_at.desc())).all()
    if not rows:
        return 0, 0, []
    return send_push_to_rows(rows, build_push_payload(title, body, event_obj), db=db)


def send_password_reset_email(recipient_email, reset_token, base_url=""):
    reset_base = build_app_base_url(base_url)
    if not reset_base:
        return False
    reset_link = f"{reset_base}/?reset={reset_token}"
    html = (
        "<p>We received a request to reset your UCF SASE password.</p>"
        f"<p><a href=\"{reset_link}\">Reset your password</a></p>"
        "<p>This link expires in 1 hour.</p>"
    )
    text = (
        "We received a request to reset your UCF SASE password.\n\n"
        f"Open this link to choose a new password:\n{reset_link}\n\n"
        "If you did not request this reset, you can ignore this email."
    )
    if not send_transactional_email(recipient_email, "Reset your UCF SASE password", html, text):
        print(f"Password reset link for {recipient_email}: {reset_link}")
    return True


def send_verification_email(recipient_email, verification_token, base_url=""):
    verify_base = build_app_base_url(base_url)
    if not verify_base:
        return False
    verify_link = f"{verify_base}/api/auth/verify-email?token={verification_token}"
    html = (
        "<p>Welcome to UCF SASE.</p>"
        "<p>Please verify your email to activate your account.</p>"
        f"<p><a href=\"{verify_link}\">Verify your email</a></p>"
        "<p>This link expires in 48 hours.</p>"
    )
    text = (
        "Welcome to UCF SASE.\n\n"
        "Please verify your email to activate your account.\n\n"
        f"Verify your email: {verify_link}\n\n"
        "This link expires in 48 hours."
    )
    if not send_transactional_email(recipient_email, "Verify your UCF SASE account", html, text):
        print(f"Verification link for {recipient_email}: {verify_link}")
    return True


def process_scheduled_notifications():
    if not push_notifications_configured():
        return

    now = datetime.now(get_app_timezone())
    with Session(engine) as db:
        upcoming_events = db.scalars(select(Event).where(Event.status == "upcoming")).all()
        changed = False
        for event_obj in upcoming_events:
            event_time = parse_event_datetime(event_obj)
            if event_time is None:
                continue

            if not event_obj.reminder_notification_sent and now >= event_time.replace(minute=event_time.minute, second=0, microsecond=0) - timedelta(hours=1) and now < event_time:
                send_event_push_to_all(
                    db,
                    event_obj,
                    f"Reminder: {event_obj.title}",
                    f"{event_obj.title} starts in about 1 hour at {event_obj.time} in {event_obj.location}."
                )
                event_obj.reminder_notification_sent = True
                changed = True

            if not event_obj.start_notification_sent and now >= event_time and now <= event_time + timedelta(minutes=30):
                send_event_push_to_all(
                    db,
                    event_obj,
                    f"Now Starting: {event_obj.title}",
                    f"{event_obj.title} is starting now at {event_obj.location}. Open the app for attendance and updates."
                )
                event_obj.start_notification_sent = True
                changed = True

        if changed:
            db.commit()


def start_notification_worker():
    global notification_worker_started
    if not push_notifications_configured():
        return
    if notification_worker_started:
        return

    def worker():
        while True:
            try:
                process_scheduled_notifications()
            except Exception as exc:
                print(f"Notification worker error: {exc}")
            time.sleep(60)

    thread = threading.Thread(target=worker, daemon=True, name="sase-notification-worker")
    thread.start()
    notification_worker_started = True


def row_to_user(user):
    return {"id": user.id, "name": user.name, "email": user.email, "major": user.major, "year": user.year, "role": user.role, "position": user.position or "", "stars": user.stars, "eligibleForLeaderboard": bool(user.eligible_for_leaderboard), "bio": user.bio or "", "profileImage": user.profile_image or "", "emailVerified": bool(user.email_verified)}


def serialize_event(event_obj, current_user_id=None):
    interested_ids = {interest.user_id for interest in event_obj.interests}
    rsvp_ids = {rsvp.user_id for rsvp in event_obj.rsvps}
    attendance_ids = {attendance.user_id for attendance in event_obj.attendance_records}
    return {"id": event_obj.id, "title": event_obj.title, "type": event_obj.type, "status": event_obj.status, "date": event_obj.date, "time": event_obj.time, "location": event_obj.location, "stars": event_obj.stars, "description": event_obj.description, "interestedCount": len(interested_ids), "rsvpCount": len(rsvp_ids), "attendanceCount": len(attendance_ids), "isInterested": current_user_id in interested_ids if current_user_id is not None else False, "isRsvped": current_user_id in rsvp_ids if current_user_id is not None else False, "isAttended": current_user_id in attendance_ids if current_user_id is not None else False, "checkinActive": bool(event_obj.checkin_active), "checkinToken": event_obj.checkin_token or ""}


def build_live_checkin_event(event_obj, include_code=False):
    if event_obj is None:
        return None
    payload = {"id": event_obj.id, "title": event_obj.title, "type": event_obj.type, "date": event_obj.date, "time": event_obj.time, "location": event_obj.location, "stars": event_obj.stars, "status": event_obj.status}
    if include_code:
        payload["attendanceCode"] = event_obj.attendance_code or ""
    return payload


def get_live_checkin_event(db):
    return db.scalar(select(Event).where(Event.checkin_active.is_(True)).order_by(Event.id.desc()))


def get_current_user(db):
    user_id = flask_session.get("user_id")
    return db.get(User, user_id) if user_id else None


def get_officers(db):
    officers = db.scalars(select(User).where(User.role == "officer").order_by(User.name.asc())).all()
    result = []
    for user in officers:
        result.append({"id": user.id, "name": user.name, "role": user.position or "Officer", "major": user.major, "bio": user.bio or "Officer profile ready for customization.", "initials": "".join(part[0].upper() for part in user.name.split()[:2] if part), "profileImage": user.profile_image or ""})
    return result


def build_admin_data():
    db = get_db()
    users = db.scalars(select(User).order_by(User.created_at.desc(), User.id.desc())).all()
    events = db.scalars(select(Event).order_by(Event.created_at.desc(), Event.id.desc())).all()
    subscriptions = db.scalars(select(PushSubscription).order_by(PushSubscription.created_at.desc())).all()
    return {
        "stats": {"users": len(users), "members": sum(1 for user in users if user.role == "member"), "officers": sum(1 for user in users if user.role == "officer"), "events": len(events), "liveCheckins": sum(1 for event_obj in events if event_obj.checkin_active), "subscriptions": len(subscriptions), "rsvps": sum(len(event_obj.rsvps) for event_obj in events), "interests": sum(len(event_obj.interests) for event_obj in events), "attendance": sum(len(event_obj.attendance_records) for event_obj in events)},
        "users": [{"id": user.id, "name": user.name, "email": user.email, "major": user.major, "year": user.year, "role": user.role, "position": user.position or "", "stars": user.stars, "eligibleForLeaderboard": bool(user.eligible_for_leaderboard), "createdAt": user.created_at.isoformat(), "profileImage": user.profile_image or "", "emailVerified": bool(user.email_verified)} for user in users],
        "events": [{"id": event_obj.id, "title": event_obj.title, "type": event_obj.type, "status": event_obj.status, "date": event_obj.date, "time": event_obj.time, "location": event_obj.location, "stars": event_obj.stars, "checkinActive": bool(event_obj.checkin_active), "attendanceCode": event_obj.attendance_code or "", "interestedCount": len(event_obj.interests), "rsvpCount": len(event_obj.rsvps), "attendanceCount": len(event_obj.attendance_records), "attendees": [{"id": attendance.user.id, "name": attendance.user.name, "email": attendance.user.email, "major": attendance.user.major, "year": attendance.user.year, "checkedInAt": attendance.created_at.isoformat()} for attendance in sorted(event_obj.attendance_records, key=lambda record: record.created_at)]} for event_obj in events],
        "subscriptions": [{"id": subscription.id, "userId": subscription.user_id, "endpoint": subscription.endpoint, "createdAt": subscription.created_at.isoformat()} for subscription in subscriptions],
    }


def get_dashboard_payload(user):
    db = get_db()
    events = db.scalars(select(Event).order_by(Event.id.asc())).all()
    current_user_id = user.id if user else None
    leaderboard_users = db.scalars(select(User).where(User.eligible_for_leaderboard.is_(True)).order_by(User.stars.desc(), User.name.asc()).limit(10)).all()
    live_event = get_live_checkin_event(db)
    payload = {
        "user": row_to_user(user) if user else None,
        "events": [serialize_event(event_obj, current_user_id) for event_obj in events],
        "officers": get_officers(db),
        "liveCheckinEvent": build_live_checkin_event(live_event),
        "adminLiveCheckinEvent": build_live_checkin_event(live_event, include_code=True) if user and user.role == "officer" else None,
        "notifications": push_notifications_status(),
        "leaderboard": [{"name": entry.name, "major": entry.major, "year": entry.year, "stars": entry.stars} for entry in leaderboard_users],
        "adminData": build_admin_data() if user and user.role == "officer" else None,
    }
    return payload


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = get_current_user(get_db())
        if user is None:
            return jsonify({"error": "Authentication required."}), 401
        return view(user, *args, **kwargs)
    return wrapped


def officer_required(view):
    @wraps(view)
    @login_required
    def wrapped(user, *args, **kwargs):
        if user.role != "officer":
            return jsonify({"error": "Officer access required."}), 403
        return view(user, *args, **kwargs)
    return wrapped


def validate_signup(payload):
    db = get_db()
    name = str(payload.get("name", "")).strip()
    email = str(payload.get("email", "")).strip().lower()
    major = str(payload.get("major", "")).strip()
    year = str(payload.get("year", "")).strip()
    password = str(payload.get("password", ""))
    requested_role = str(payload.get("role", "member")).strip()
    invite_code = str(payload.get("officerInviteCode", "")).strip()
    position = str(payload.get("position", "")).strip()
    bio = str(payload.get("bio", "")).strip()
    if not all([name, email, major, year, password]):
        return "All fields are required.", None
    if year not in YEAR_OPTIONS:
        return "Please choose a valid year.", None
    if len(password) < 6:
        return "Password must be at least 6 characters.", None
    role = "member"
    eligible = True
    if requested_role == "officer":
        officer_count = db.scalar(select(func.count()).select_from(User).where(User.role == "officer")) or 0
        if officer_count == 0 or invite_code == OFFICER_INVITE_CODE:
            role = "officer"
            eligible = False
        else:
            return "Officer invite code is required for officer accounts.", None
    return None, {"name": name, "email": email, "major": major, "year": year, "password_hash": generate_password_hash(password), "role": role, "position": position if role == "officer" else "", "eligible_for_leaderboard": eligible, "bio": bio if role == "officer" and bio else "Officer profile ready for customization." if role == "officer" else ""}

@app.route("/")
def root():
    init_db()
    start_notification_worker()
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/<path:path>")
def static_files(path):
    init_db()
    start_notification_worker()
    return send_from_directory(BASE_DIR, path)


@app.get("/api/bootstrap")
def bootstrap():
    init_db()
    start_notification_worker()
    return jsonify(get_dashboard_payload(get_current_user(get_db())))


@app.post("/api/auth/signup")
def signup():
    init_db()
    payload = request.get_json(silent=True) or {}
    error, values = validate_signup(payload)
    if error:
        return jsonify({"error": error}), 400
    db = get_db()
    user = User(
        name=values["name"],
        email=values["email"],
        password_hash=values["password_hash"],
        major=values["major"],
        year=values["year"],
        role=values["role"],
        position=values["position"],
        eligible_for_leaderboard=values["eligible_for_leaderboard"],
        bio=values["bio"],
        email_verified=True,
        created_at=utc_now()
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return jsonify({"error": "An account with that email already exists."}), 409
    flask_session["user_id"] = user.id
    return jsonify(get_dashboard_payload(user)), 201


@app.post("/api/auth/login")
def login():
    init_db()
    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", ""))
    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400
    db = get_db()
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not check_password_hash(user.password_hash, password):
        return jsonify({"error": "We could not match that email and password."}), 401
    flask_session["user_id"] = user.id
    return jsonify(get_dashboard_payload(user))


@app.post("/api/auth/forgot-password")
def forgot_password():
    init_db()
    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email", "")).strip().lower()
    response = {"message": "If an account exists for that email, a reset link has been sent."}
    if not email:
        return jsonify(response)

    db = get_db()
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        return jsonify(response)

    user.reset_token = secrets.token_urlsafe(32)
    user.reset_token_expires_at = utc_now() + timedelta(hours=1)
    db.commit()

    try:
        send_password_reset_email(user.email, user.reset_token, request.url_root.rstrip("/"))
    except Exception as exc:
        print(f"Password reset email error: {exc}")

    return jsonify(response)


@app.post("/api/auth/reset-password")
def reset_password():
    init_db()
    payload = request.get_json(silent=True) or {}
    token = str(payload.get("token", "")).strip()
    new_password = str(payload.get("password", ""))
    if not token or len(new_password) < 6:
        return jsonify({"error": "A valid reset token and password are required."}), 400

    db = get_db()
    user = db.scalar(select(User).where(User.reset_token == token))
    if user is None or user.reset_token_expires_at is None or user.reset_token_expires_at < utc_now():
        return jsonify({"error": "That reset link is invalid or has expired."}), 400

    user.password_hash = generate_password_hash(new_password)
    user.reset_token = None
    user.reset_token_expires_at = None
    db.commit()
    return jsonify({"message": "Your password has been reset. You can log in now."})


@app.post("/api/auth/logout")
def logout():
    flask_session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
@login_required
def me(user):
    return jsonify(get_dashboard_payload(user))


@app.patch("/api/me")
@login_required
def update_profile(user):
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name", "")).strip()
    major = str(payload.get("major", "")).strip()
    year = str(payload.get("year", "")).strip()
    position = str(payload.get("position", "")).strip()
    bio = str(payload.get("bio", "")).strip()
    profile_image = str(payload.get("profileImage", "")).strip()
    if not all([name, major, year]) or year not in YEAR_OPTIONS:
        return jsonify({"error": "Please provide a valid name, major, and year."}), 400
    if profile_image and (not profile_image.startswith("data:image/") or len(profile_image) > 5_500_000):
        return jsonify({"error": "Please upload a valid image under 5 MB."}), 400
    db = get_db()
    user.name = name
    user.major = major
    user.year = year
    user.position = position if user.role == "officer" else ""
    user.bio = bio if user.role == "officer" else ""
    user.profile_image = profile_image if user.role == "officer" else ""
    db.commit()
    return jsonify(get_dashboard_payload(user))


@app.post("/api/events/<int:event_id>/interest")
@login_required
def toggle_interest(user, event_id):
    db = get_db()
    event_obj = db.get(Event, event_id)
    if event_obj is None or event_obj.status == "completed":
        return jsonify({"error": "This event is not available for interest tracking."}), 400
    existing = db.get(EventInterest, {"user_id": user.id, "event_id": event_id})
    if existing:
        db.delete(existing)
    else:
        db.add(EventInterest(user_id=user.id, event_id=event_id, created_at=utc_now()))
    db.commit()
    return jsonify(get_dashboard_payload(user))


@app.post("/api/events/<int:event_id>/rsvp")
@login_required
def toggle_rsvp(user, event_id):
    db = get_db()
    event_obj = db.get(Event, event_id)
    if event_obj is None or event_obj.status == "completed":
        return jsonify({"error": "This event is not open for RSVP."}), 400
    existing = db.get(EventRsvp, {"user_id": user.id, "event_id": event_id})
    if existing:
        db.delete(existing)
    else:
        db.add(EventRsvp(user_id=user.id, event_id=event_id, created_at=utc_now()))
        interest = db.get(EventInterest, {"user_id": user.id, "event_id": event_id})
        if interest:
            db.delete(interest)
    db.commit()
    return jsonify(get_dashboard_payload(user))


@app.get("/api/checkin/<token>")
def checkin_preview(token):
    init_db()
    db = get_db()
    event_obj = db.scalar(select(Event).where(Event.checkin_token == token))
    if event_obj is None:
        return jsonify({"error": "That check-in link is not valid."}), 404
    return jsonify({"event": {"id": event_obj.id, "title": event_obj.title, "date": event_obj.date, "time": event_obj.time, "location": event_obj.location, "stars": event_obj.stars, "checkinActive": bool(event_obj.checkin_active)}})


@app.post("/api/checkin/<token>")
@login_required
def claim_checkin(user, token):
    db = get_db()
    event_obj = db.scalar(select(Event).where(Event.checkin_token == token))
    if event_obj is None:
        return jsonify({"error": "That check-in link is not valid."}), 404
    if not event_obj.checkin_active:
        return jsonify({"error": "Check-in is not active for this event right now."}), 400
    already_attended = db.get(EventAttendance, {"user_id": user.id, "event_id": event_obj.id})
    if already_attended:
        payload = get_dashboard_payload(user)
        payload["checkinMessage"] = f"You were already checked in for {event_obj.title}."
        return jsonify(payload)
    db.add(EventAttendance(user_id=user.id, event_id=event_obj.id, created_at=utc_now()))
    user.stars += event_obj.stars
    db.commit()
    payload = get_dashboard_payload(user)
    payload["checkinMessage"] = f"Attendance confirmed for {event_obj.title}. You earned {event_obj.stars} stars."
    return jsonify(payload)


@app.post("/api/live-checkin")
@login_required
def claim_live_checkin(user):
    payload = request.get_json(silent=True) or {}
    submitted_code = str(payload.get("attendanceCode", "")).strip().upper()
    if not submitted_code:
        return jsonify({"error": "Enter the live attendance code for the event."}), 400
    db = get_db()
    event_obj = get_live_checkin_event(db)
    if event_obj is None:
        return jsonify({"error": "There is no live event check-in right now."}), 400
    if (event_obj.attendance_code or "") != submitted_code:
        return jsonify({"error": "That attendance code is not correct."}), 400
    already_attended = db.get(EventAttendance, {"user_id": user.id, "event_id": event_obj.id})
    if already_attended:
        data = get_dashboard_payload(user)
        data["checkinMessage"] = f"You were already checked in for {event_obj.title}."
        return jsonify(data)
    db.add(EventAttendance(user_id=user.id, event_id=event_obj.id, created_at=utc_now()))
    user.stars += event_obj.stars
    db.commit()
    data = get_dashboard_payload(user)
    data["checkinMessage"] = f"Attendance confirmed for {event_obj.title}. You earned {event_obj.stars} stars."
    return jsonify(data)

@app.post("/api/notifications/subscribe")
@login_required
def save_push_subscription(user):
    if not push_notifications_configured():
        return jsonify({"error": "Push notifications are not configured yet."}), 400
    payload = request.get_json(silent=True) or {}
    endpoint = str(payload.get("endpoint", "")).strip()
    keys = payload.get("keys") or {}
    p256dh = str(keys.get("p256dh", "")).strip()
    auth = str(keys.get("auth", "")).strip()
    if not endpoint or not p256dh or not auth:
        return jsonify({"error": "A valid push subscription is required."}), 400
    db = get_db()
    existing = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
    if existing:
        existing.user_id = user.id
        existing.p256dh = p256dh
        existing.auth = auth
    else:
        db.add(PushSubscription(user_id=user.id, endpoint=endpoint, p256dh=p256dh, auth=auth, created_at=utc_now()))
    db.commit()
    return jsonify({"ok": True})


@app.post("/api/notifications/unsubscribe")
@login_required
def delete_push_subscription(user):
    payload = request.get_json(silent=True) or {}
    endpoint = str(payload.get("endpoint", "")).strip()
    if not endpoint:
        return jsonify({"error": "Subscription endpoint is required."}), 400
    db = get_db()
    subscription = db.scalar(select(PushSubscription).where(PushSubscription.user_id == user.id, PushSubscription.endpoint == endpoint))
    if subscription:
        db.delete(subscription)
        db.commit()
    return jsonify({"ok": True})


@app.post("/api/admin/events")
@officer_required
def create_event(user):
    payload = request.get_json(silent=True) or {}
    title = str(payload.get("title", "")).strip()
    event_type = str(payload.get("type", "")).strip()
    status = str(payload.get("status", "")).strip()
    date = str(payload.get("date", "")).strip()
    time_value = str(payload.get("time", "")).strip()
    location = str(payload.get("location", "")).strip()
    description = str(payload.get("description", "")).strip()
    try:
        stars = int(payload.get("stars", 0))
    except (TypeError, ValueError):
        stars = -1
    if not all([title, event_type, status, date, time_value, location, description]):
        return jsonify({"error": "All event fields are required."}), 400
    if event_type not in EVENT_TYPES or status not in EVENT_STATUSES or stars < 0:
        return jsonify({"error": "Please provide a valid event type, status, and stars value."}), 400
    db = get_db()
    event_obj = Event(title=title, type=event_type, status=status, date=date, time=time_value, location=location, stars=stars, description=description, created_by=user.id, created_at=utc_now())
    db.add(event_obj)
    db.commit()
    if push_notifications_configured():
        send_event_push_to_all(
            db,
            event_obj,
            f"New Event: {event_obj.title}",
            f"{event_obj.title} was just added for {event_obj.date} at {event_obj.time} in {event_obj.location}."
        )
    return jsonify(get_dashboard_payload(user)), 201


@app.post("/api/admin/events/<int:event_id>/checkin/start")
@officer_required
def start_checkin(_, event_id):
    db = get_db()
    event_obj = db.get(Event, event_id)
    if event_obj is None:
        return jsonify({"error": "Event not found."}), 404
    if event_obj.status == "completed":
        return jsonify({"error": "Completed events cannot start attendance again."}), 400
    token = event_obj.checkin_token or secrets.token_urlsafe(16)
    attendance_code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
    for live_event in db.scalars(select(Event).where(Event.id != event_id, Event.checkin_active.is_(True))).all():
        live_event.checkin_active = False
        live_event.attendance_code = None
    event_obj.checkin_token = token
    event_obj.checkin_active = True
    event_obj.attendance_code = attendance_code
    db.commit()
    if push_notifications_configured():
        send_event_push_to_all(
            db,
            event_obj,
            f"Attendance Live: {event_obj.title}",
            f"Attendance is now open for {event_obj.title}. Open the app and enter today's code."
        )
    payload = get_dashboard_payload(get_current_user(db))
    payload["checkinLink"] = f"/?checkin={token}"
    return jsonify(payload)


@app.post("/api/admin/events/<int:event_id>/checkin/stop")
@officer_required
def stop_checkin(_, event_id):
    db = get_db()
    event_obj = db.get(Event, event_id)
    if event_obj is None:
        return jsonify({"error": "Event not found."}), 404
    event_obj.checkin_active = False
    event_obj.attendance_code = None
    db.commit()
    return jsonify(get_dashboard_payload(get_current_user(db)))


@app.post("/api/admin/events/<int:event_id>/complete")
@officer_required
def complete_event(_, event_id):
    db = get_db()
    event_obj = db.get(Event, event_id)
    if event_obj is None:
        return jsonify({"error": "Event not found."}), 404
    event_obj.status = "completed"
    event_obj.checkin_active = False
    event_obj.attendance_code = None
    db.commit()
    return jsonify(get_dashboard_payload(get_current_user(db)))


@app.post("/api/admin/promote")
@officer_required
def promote_member(_):
    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email", "")).strip().lower()
    if not email:
        return jsonify({"error": "Email is required."}), 400
    db = get_db()
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        return jsonify({"error": "No member account matches that email."}), 404
    user.role = "officer"
    user.eligible_for_leaderboard = False
    user.position = user.position or "Officer"
    user.bio = user.bio or "Officer profile ready for customization."
    db.commit()
    return jsonify(get_dashboard_payload(get_current_user(db)))


@app.get("/api/admin/data")
@officer_required
def admin_data(_):
    return jsonify(build_admin_data())

@app.post("/api/admin/events/<int:event_id>/notify")
@officer_required
def notify_event_members(_, event_id):
    if not push_notifications_configured():
        return jsonify({"error": "Push notifications are not configured on the server yet."}), 400
    payload = request.get_json(silent=True) or {}
    notification_type = str(payload.get("type", "")).strip().lower()
    audience = str(payload.get("audience", "rsvp")).strip().lower()
    custom_message = str(payload.get("message", "")).strip()
    if notification_type not in {"reminder", "location", "update", "checkin"}:
        return jsonify({"error": "Choose a valid notification type."}), 400
    if audience not in {"interested", "rsvp", "both"}:
        return jsonify({"error": "Choose a valid audience."}), 400
    db = get_db()
    event_obj = db.get(Event, event_id)
    if event_obj is None:
        return jsonify({"error": "Event not found."}), 404
    recipients = {}
    if audience in {"interested", "both"}:
        for record in event_obj.interests:
            for subscription in record.user.push_subscriptions:
                recipients[subscription.endpoint] = subscription
    if audience in {"rsvp", "both"}:
        for record in event_obj.rsvps:
            for subscription in record.user.push_subscriptions:
                recipients[subscription.endpoint] = subscription
    title_map = {"reminder": f"Reminder: {event_obj.title}", "location": f"Location update: {event_obj.title}", "update": f"Update: {event_obj.title}", "checkin": f"Attendance live: {event_obj.title}"}
    default_message_map = {"reminder": f"{event_obj.title} starts on {event_obj.date} at {event_obj.time} in {event_obj.location}.", "location": f"The location for {event_obj.title} is now {event_obj.location}.", "update": f"There is a new update for {event_obj.title}. Open the SASE app for details.", "checkin": f"Attendance is now live for {event_obj.title}. Open the app and enter today's attendance code."}
    delivered, failed, errors = send_push_to_rows(list(recipients.values()), build_push_payload(title_map[notification_type], custom_message or default_message_map[notification_type], event_obj))
    response = get_dashboard_payload(get_current_user(db))
    response["notificationSummary"] = {"sent": delivered, "failed": failed, "audience": audience, "type": notification_type, "errors": errors}
    return jsonify(response)


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=8000, debug=True)
