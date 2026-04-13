from __future__ import annotations

import os
import sqlite3
import secrets
from contextlib import closing
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from typing import Any

from flask import Flask, g, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash


BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.environ.get("DATABASE_PATH", str(BASE_DIR / "sase_portal.db")))
OFFICER_INVITE_CODE = os.environ.get("OFFICER_INVITE_CODE", "SASE-OFFICER")
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-change-me")

YEAR_OPTIONS = {
    "First Year",
    "Second Year",
    "Third Year",
    "Fourth Year",
    "Graduate",
}

EVENT_TYPES = {"Social", "GBM", "Professional", "Workshop"}
EVENT_STATUSES = {"upcoming", "completed"}


app = Flask(__name__, static_folder=".")
app.config["SECRET_KEY"] = SECRET_KEY
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        connection = sqlite3.connect(DATABASE_PATH)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        g.db = connection
    return g.db


@app.teardown_appcontext
def close_db(_: object | None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
    schema = """
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      major TEXT NOT NULL,
      year TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('member', 'officer')),
      stars INTEGER NOT NULL DEFAULT 0,
      eligible_for_leaderboard INTEGER NOT NULL DEFAULT 1,
      bio TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('upcoming', 'completed')),
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      location TEXT NOT NULL,
      stars INTEGER NOT NULL,
      description TEXT NOT NULL,
      checkin_token TEXT,
      checkin_active INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS event_interest (
      user_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, event_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_rsvp (
      user_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, event_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS event_attendance (
      user_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, event_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
    """
    db = get_db()
    with closing(db.cursor()) as cursor:
        cursor.executescript(schema)
        ensure_event_columns(cursor)
    db.commit()
    seed_events_if_needed(db)


def ensure_event_columns(cursor: sqlite3.Cursor) -> None:
    columns = {
        row["name"]
        for row in cursor.execute("PRAGMA table_info(events)").fetchall()
    }
    if "checkin_token" not in columns:
        cursor.execute("ALTER TABLE events ADD COLUMN checkin_token TEXT")
    if "checkin_active" not in columns:
        cursor.execute("ALTER TABLE events ADD COLUMN checkin_active INTEGER NOT NULL DEFAULT 0")


def seed_events_if_needed(db: sqlite3.Connection) -> None:
    existing = db.execute("SELECT COUNT(*) AS count FROM events").fetchone()["count"]
    if existing:
      return

    events = [
        (
            "April GBM",
            "GBM",
            "completed",
            "Thu, Apr 10",
            "6:30 PM",
            "STEM Center 202",
            50,
            "General body meeting with chapter updates, member shoutouts, and committee planning.",
        ),
        (
            "SASE Social Night",
            "Social",
            "upcoming",
            "Tue, Apr 15",
            "7:00 PM",
            "Student Union Lounge",
            30,
            "Relax, meet new members, and build community with games and small group conversations.",
        ),
        (
            "Industry Networking Mixer",
            "Professional",
            "upcoming",
            "Fri, Apr 18",
            "5:30 PM",
            "Innovation Atrium",
            70,
            "Connect with recruiters, alumni, and professionals across engineering and STEM industries.",
        ),
        (
            "Technical Case Study Workshop",
            "Workshop",
            "upcoming",
            "Wed, Apr 23",
            "6:00 PM",
            "Engineering Hall 114",
            60,
            "Practice collaborative problem solving and communication with a guided technical challenge.",
        ),
    ]
    db.executemany(
        """
        INSERT INTO events (title, type, status, date, time, location, stars, description, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [(*event, utc_now()) for event in events],
    )
    db.commit()


def row_to_user(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "major": row["major"],
        "year": row["year"],
        "role": row["role"],
        "stars": row["stars"],
        "eligibleForLeaderboard": bool(row["eligible_for_leaderboard"]),
        "bio": row["bio"] or "",
    }


def get_current_user_row() -> sqlite3.Row | None:
    user_id = session.get("user_id")
    if not user_id:
        return None
    return get_db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = get_current_user_row()
        if user is None:
            return jsonify({"error": "Authentication required."}), 401
        return view(user, *args, **kwargs)

    return wrapped


def officer_required(view):
    @wraps(view)
    @login_required
    def wrapped(user: sqlite3.Row, *args, **kwargs):
        if user["role"] != "officer":
            return jsonify({"error": "Officer access required."}), 403
        return view(user, *args, **kwargs)

    return wrapped


def validate_signup(payload: dict[str, Any]) -> tuple[str | None, dict[str, Any] | None]:
    name = str(payload.get("name", "")).strip()
    email = str(payload.get("email", "")).strip().lower()
    major = str(payload.get("major", "")).strip()
    year = str(payload.get("year", "")).strip()
    password = str(payload.get("password", ""))
    requested_role = str(payload.get("role", "member")).strip()
    invite_code = str(payload.get("officerInviteCode", "")).strip()

    if not all([name, email, major, year, password]):
        return "All fields are required.", None
    if year not in YEAR_OPTIONS:
        return "Please choose a valid year.", None
    if len(password) < 6:
        return "Password must be at least 6 characters.", None

    role = "member"
    eligible = 1
    if requested_role == "officer":
        officer_count = get_db().execute(
            "SELECT COUNT(*) AS count FROM users WHERE role = 'officer'"
        ).fetchone()["count"]
        if officer_count == 0 or invite_code == OFFICER_INVITE_CODE:
            role = "officer"
            eligible = 0
        else:
            return "Officer invite code is required for officer accounts.", None

    return None, {
        "name": name,
        "email": email,
        "major": major,
        "year": year,
        "password_hash": generate_password_hash(password),
        "role": role,
        "eligible_for_leaderboard": eligible,
        "bio": "Officer profile ready for customization." if role == "officer" else "",
    }


def serialize_event(row: sqlite3.Row, current_user_id: int | None = None) -> dict[str, Any]:
    db = get_db()
    interested_count = db.execute(
        "SELECT COUNT(*) AS count FROM event_interest WHERE event_id = ?", (row["id"],)
    ).fetchone()["count"]
    rsvp_count = db.execute(
        "SELECT COUNT(*) AS count FROM event_rsvp WHERE event_id = ?", (row["id"],)
    ).fetchone()["count"]
    attendance_count = db.execute(
        "SELECT COUNT(*) AS count FROM event_attendance WHERE event_id = ?", (row["id"],)
    ).fetchone()["count"]

    is_interested = False
    is_rsvped = False
    is_attended = False
    if current_user_id is not None:
        is_interested = (
            db.execute(
                "SELECT 1 FROM event_interest WHERE user_id = ? AND event_id = ?",
                (current_user_id, row["id"]),
            ).fetchone()
            is not None
        )
        is_rsvped = (
            db.execute(
                "SELECT 1 FROM event_rsvp WHERE user_id = ? AND event_id = ?",
                (current_user_id, row["id"]),
            ).fetchone()
            is not None
        )
        is_attended = (
            db.execute(
                "SELECT 1 FROM event_attendance WHERE user_id = ? AND event_id = ?",
                (current_user_id, row["id"]),
            ).fetchone()
            is not None
        )

    return {
        "id": row["id"],
        "title": row["title"],
        "type": row["type"],
        "status": row["status"],
        "date": row["date"],
        "time": row["time"],
        "location": row["location"],
        "stars": row["stars"],
        "description": row["description"],
        "interestedCount": interested_count,
        "rsvpCount": rsvp_count,
        "attendanceCount": attendance_count,
        "isInterested": is_interested,
        "isRsvped": is_rsvped,
        "isAttended": is_attended,
        "checkinActive": bool(row["checkin_active"]),
        "checkinToken": row["checkin_token"] or "",
    }


def get_officers() -> list[dict[str, Any]]:
    rows = get_db().execute(
        """
        SELECT id, name, major, bio
        FROM users
        WHERE role = 'officer'
        ORDER BY name COLLATE NOCASE ASC
        """
    ).fetchall()
    officers = []
    for row in rows:
        initials = "".join(part[0].upper() for part in row["name"].split()[:2] if part)
        officers.append(
            {
                "id": row["id"],
                "name": row["name"],
                "role": "Officer",
                "major": row["major"],
                "bio": row["bio"] or "Officer profile ready for customization.",
                "initials": initials,
            }
        )
    return officers


def get_dashboard_payload(user: sqlite3.Row | None) -> dict[str, Any]:
    db = get_db()
    current_user_id = user["id"] if user else None
    event_rows = db.execute("SELECT * FROM events ORDER BY id ASC").fetchall()
    events = [serialize_event(row, current_user_id) for row in event_rows]

    leaderboard_rows = db.execute(
        """
        SELECT name, major, year, stars
        FROM users
        WHERE eligible_for_leaderboard = 1
        ORDER BY stars DESC, name COLLATE NOCASE ASC
        LIMIT 10
        """
    ).fetchall()

    return {
        "user": row_to_user(user) if user else None,
        "events": events,
        "officers": get_officers(),
        "leaderboard": [
            {
                "name": row["name"],
                "major": row["major"],
                "year": row["year"],
                "stars": row["stars"],
            }
            for row in leaderboard_rows
        ],
    }


@app.route("/")
def root():
    init_db()
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/<path:path>")
def static_files(path: str):
    init_db()
    return send_from_directory(BASE_DIR, path)


@app.get("/api/bootstrap")
def bootstrap():
    init_db()
    return jsonify(get_dashboard_payload(get_current_user_row()))


@app.post("/api/auth/signup")
def signup():
    init_db()
    payload = request.get_json(silent=True) or {}
    error, values = validate_signup(payload)
    if error:
        return jsonify({"error": error}), 400

    db = get_db()
    try:
        cursor = db.execute(
            """
            INSERT INTO users (
              name, email, password_hash, major, year, role,
              eligible_for_leaderboard, bio, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                values["name"],
                values["email"],
                values["password_hash"],
                values["major"],
                values["year"],
                values["role"],
                values["eligible_for_leaderboard"],
                values["bio"],
                utc_now(),
            ),
        )
    except sqlite3.IntegrityError:
        return jsonify({"error": "An account with that email already exists."}), 409

    db.commit()
    session["user_id"] = cursor.lastrowid
    user = db.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return jsonify(get_dashboard_payload(user)), 201


@app.post("/api/auth/login")
def login():
    init_db()
    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", ""))
    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400

    user = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if user is None or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "We could not match that email and password."}), 401

    session["user_id"] = user["id"]
    return jsonify(get_dashboard_payload(user))


@app.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
@login_required
def me(user: sqlite3.Row):
    return jsonify(get_dashboard_payload(user))


@app.patch("/api/me")
@login_required
def update_profile(user: sqlite3.Row):
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name", "")).strip()
    major = str(payload.get("major", "")).strip()
    year = str(payload.get("year", "")).strip()

    if not all([name, major, year]) or year not in YEAR_OPTIONS:
        return jsonify({"error": "Please provide a valid name, major, and year."}), 400

    db = get_db()
    db.execute(
        "UPDATE users SET name = ?, major = ?, year = ? WHERE id = ?",
        (name, major, year, user["id"]),
    )
    db.commit()
    updated_user = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    return jsonify(get_dashboard_payload(updated_user))


@app.post("/api/events/<int:event_id>/interest")
@login_required
def toggle_interest(user: sqlite3.Row, event_id: int):
    db = get_db()
    event_row = db.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    if event_row is None or event_row["status"] == "completed":
        return jsonify({"error": "This event is not available for interest tracking."}), 400

    existing = db.execute(
        "SELECT 1 FROM event_interest WHERE user_id = ? AND event_id = ?",
        (user["id"], event_id),
    ).fetchone()
    if existing:
        db.execute(
            "DELETE FROM event_interest WHERE user_id = ? AND event_id = ?",
            (user["id"], event_id),
        )
    else:
        db.execute(
            "INSERT INTO event_interest (user_id, event_id, created_at) VALUES (?, ?, ?)",
            (user["id"], event_id, utc_now()),
        )
    db.commit()
    refreshed_user = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    return jsonify(get_dashboard_payload(refreshed_user))


@app.post("/api/events/<int:event_id>/rsvp")
@login_required
def toggle_rsvp(user: sqlite3.Row, event_id: int):
    db = get_db()
    event_row = db.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    if event_row is None or event_row["status"] == "completed":
        return jsonify({"error": "This event is not open for RSVP."}), 400

    existing = db.execute(
        "SELECT 1 FROM event_rsvp WHERE user_id = ? AND event_id = ?",
        (user["id"], event_id),
    ).fetchone()
    if existing:
        db.execute(
            "DELETE FROM event_rsvp WHERE user_id = ? AND event_id = ?",
            (user["id"], event_id),
        )
    else:
        db.execute(
            "INSERT INTO event_rsvp (user_id, event_id, created_at) VALUES (?, ?, ?)",
            (user["id"], event_id, utc_now()),
        )
        db.execute(
            "DELETE FROM event_interest WHERE user_id = ? AND event_id = ?",
            (user["id"], event_id),
        )
    db.commit()
    refreshed_user = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    return jsonify(get_dashboard_payload(refreshed_user))


@app.get("/api/checkin/<token>")
def checkin_preview(token: str):
    init_db()
    event_row = get_db().execute(
        "SELECT * FROM events WHERE checkin_token = ?",
        (token,),
    ).fetchone()
    if event_row is None:
        return jsonify({"error": "That check-in link is not valid."}), 404

    return jsonify(
        {
            "event": {
                "id": event_row["id"],
                "title": event_row["title"],
                "date": event_row["date"],
                "time": event_row["time"],
                "location": event_row["location"],
                "stars": event_row["stars"],
                "checkinActive": bool(event_row["checkin_active"]),
            }
        }
    )


@app.post("/api/checkin/<token>")
@login_required
def claim_checkin(user: sqlite3.Row, token: str):
    db = get_db()
    event_row = db.execute(
        "SELECT * FROM events WHERE checkin_token = ?",
        (token,),
    ).fetchone()
    if event_row is None:
        return jsonify({"error": "That check-in link is not valid."}), 404
    if not event_row["checkin_active"]:
        return jsonify({"error": "Check-in is not active for this event right now."}), 400

    already_attended = db.execute(
        "SELECT 1 FROM event_attendance WHERE user_id = ? AND event_id = ?",
        (user["id"], event_row["id"]),
    ).fetchone()
    if already_attended:
        refreshed_user = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        payload = get_dashboard_payload(refreshed_user)
        payload["checkinMessage"] = f"You were already checked in for {event_row['title']}."
        return jsonify(payload)

    db.execute(
        "INSERT INTO event_attendance (user_id, event_id, created_at) VALUES (?, ?, ?)",
        (user["id"], event_row["id"], utc_now()),
    )
    db.execute(
        "UPDATE users SET stars = stars + ? WHERE id = ?",
        (event_row["stars"], user["id"]),
    )
    db.commit()
    refreshed_user = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    payload = get_dashboard_payload(refreshed_user)
    payload["checkinMessage"] = f"Attendance confirmed for {event_row['title']}. You earned {event_row['stars']} stars."
    return jsonify(payload)


@app.post("/api/admin/events")
@officer_required
def create_event(_: sqlite3.Row):
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
    db.execute(
        """
        INSERT INTO events (title, type, status, date, time, location, stars, description, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (title, event_type, status, date, time_value, location, stars, description, utc_now()),
    )
    db.commit()
    return jsonify(get_dashboard_payload(get_current_user_row())), 201


@app.post("/api/admin/events/<int:event_id>/checkin/start")
@officer_required
def start_checkin(_: sqlite3.Row, event_id: int):
    db = get_db()
    event_row = db.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    if event_row is None:
        return jsonify({"error": "Event not found."}), 404

    token = event_row["checkin_token"] or secrets.token_urlsafe(16)
    db.execute(
        "UPDATE events SET checkin_token = ?, checkin_active = 1 WHERE id = ?",
        (token, event_id),
    )
    db.commit()
    payload = get_dashboard_payload(get_current_user_row())
    payload["checkinLink"] = f"/?checkin={token}"
    return jsonify(payload)


@app.post("/api/admin/events/<int:event_id>/checkin/stop")
@officer_required
def stop_checkin(_: sqlite3.Row, event_id: int):
    db = get_db()
    event_row = db.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    if event_row is None:
        return jsonify({"error": "Event not found."}), 404

    db.execute(
        "UPDATE events SET checkin_active = 0 WHERE id = ?",
        (event_id,),
    )
    db.commit()
    return jsonify(get_dashboard_payload(get_current_user_row()))


@app.delete("/api/admin/events/<int:event_id>")
@officer_required
def delete_event(_: sqlite3.Row, event_id: int):
    db = get_db()
    event_row = db.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    if event_row is None:
        return jsonify({"error": "Event not found."}), 404

    attendee_ids = db.execute(
        "SELECT user_id FROM event_attendance WHERE event_id = ?",
        (event_id,),
    ).fetchall()
    for attendee in attendee_ids:
        db.execute(
            "UPDATE users SET stars = MAX(0, stars - ?) WHERE id = ?",
            (event_row["stars"], attendee["user_id"]),
        )

    db.execute("DELETE FROM events WHERE id = ?", (event_id,))
    db.commit()
    return jsonify(get_dashboard_payload(get_current_user_row()))


@app.post("/api/admin/promote")
@officer_required
def promote_member(_: sqlite3.Row):
    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email", "")).strip().lower()
    if not email:
        return jsonify({"error": "Email is required."}), 400
    db = get_db()
    db.execute(
        """
        UPDATE users
        SET role = 'officer', eligible_for_leaderboard = 0, bio = COALESCE(NULLIF(bio, ''), 'Officer profile ready for customization.')
        WHERE email = ?
        """,
        (email,),
    )
    db.commit()
    return jsonify(get_dashboard_payload(get_current_user_row()))


if __name__ == "__main__":
    with app.app_context():
        init_db()
    app.run(host="0.0.0.0", port=8000, debug=True)
