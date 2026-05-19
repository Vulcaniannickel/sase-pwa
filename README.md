# SASE Student Portal

This project is now a real shared full-stack club app.

## Stack

- Frontend: installable PWA served from the same app
- Backend: Flask
- Database: Postgres in production, SQLite fallback locally
- Auth: secure password hashing with Flask sessions

## What is shared now

- member accounts
- officer accounts
- events
- RSVP and interest counts
- attendance check-in
- push notification subscriptions
- stars
- leaderboard
- officer-only event management

## Run locally

1. Open PowerShell in `C:\Users\ryank\OneDrive\Documents\New project`
2. Install dependencies if needed:

```powershell
python -m pip install -r requirements.txt
```

3. Start the app:

```powershell
python backend.py
```

You can also double-click `start-backend.cmd`.

4. Open:

[http://127.0.0.1:8000](http://127.0.0.1:8000)

## Deploying publicly

Best easy/free path right now:

- Supabase for Postgres
- Render Free Web Service for the Flask app

The app supports any Postgres connection through `DATABASE_URL`, so the database host can be swapped without code changes.

Basic Render + Supabase flow:

1. Push this project to a GitHub repository
2. Create a new Supabase project
3. Copy the Supabase **Session pooler** connection string into `DATABASE_URL`
4. Create a Render web service from this repo
5. Set `DATABASE_URL`, `SECRET_KEY`, and `OFFICER_INVITE_CODE` in Render
6. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_CLAIMS_SUBJECT` in Render if you want push notifications
7. Let Render build and deploy the app
8. Use the public Render URL for your QR codes

Important Render Free note:

- the app will spin down after idle time and take a little while to wake up again
- scheduled background-style notification timing is less reliable on sleeping/free hosts

## Can you still edit it after it is public?

Yes.

- You can keep changing the files locally
- Push the updated code to GitHub
- Render redeploys the public app
- Your live URL stays the same in most cases

So publishing it does not lock the project. It just gives you a live version that updates when you redeploy.

## First real account

- If there are no officers yet, the first officer signup is allowed without an invite code.
- After that, new officer signups require the officer invite code.

Default officer invite code right now:

```text
SASE-OFFICER
```

For real deployment, change this before publishing by setting environment variables:

```powershell
$env:OFFICER_INVITE_CODE="your-secret-code"
$env:SECRET_KEY="your-secret-session-key"
python backend.py
```

## How stars work now

- RSVP does not award stars.
- Members only earn stars when they successfully check in for an event.
- Each member can only check in once per event.
- Officers are excluded from the public prize leaderboard even if they earn stars.

## Officer check-in workflow

1. Log in as an officer
2. Open the `Admin` tab
3. For the event you want, click `Start Attendance`
4. The app generates a live attendance code for that event
5. Show the same permanent SASE QR code to the room
6. Show the live attendance code on your laptop/projector
7. Members scan the SASE QR, log in, and enter the live code
8. Click `Stop Attendance` when the event is over

## Push notifications

Members can enable notifications from the app after logging in. Officers can then send:

- reminders
- location changes
- general updates
- attendance-live alerts

Notifications can be sent to:

- members who RSVP'd
- members who marked Interested
- both groups together

To make push notifications work in production, set these environment variables:

```text
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_CLAIMS_SUBJECT
```

You can generate a VAPID keypair with a web-push tool or an online generator, then copy those values into Render.

## Backend data view

Officer accounts now get an extra `Backend Data` panel in the `Admin` tab. It shows:

- total users, officers, events, RSVPs, attendance, and push subscriptions
- a snapshot of recent user records from the shared backend

There is also an officer-only API endpoint:

```text
/api/admin/data
```

## Supabase migration

If you already have a Render Postgres database and want to move it to Supabase:

1. In Render, copy the current database connection string.
2. In Supabase, open `Connect` and copy the **Session pooler** URI.
3. Export the Render database:

```powershell
$env:OLD_DB_URL="YOUR_RENDER_DATABASE_URL"
pg_dump "$env:OLD_DB_URL" `
  --clean `
  --if-exists `
  --quote-all-identifiers `
  --no-owner `
  --no-privileges `
  > dump.sql
```

4. Import into Supabase:

```powershell
$env:NEW_DB_URL="YOUR_SUPABASE_SESSION_POOLER_URL"
psql -d "$env:NEW_DB_URL" -f dump.sql
```

5. In Render, replace the web service `DATABASE_URL` value with the Supabase Session pooler URI.
6. Redeploy and test logins, events, attendance, stars, and notifications.

## Notes before public launch

- Use Postgres in production. SQLite is only a local fallback.
- Do not commit your live database file.
- If you deploy publicly, set a real `SECRET_KEY`, `OFFICER_INVITE_CODE`, `DATABASE_URL`, and VAPID keys for notifications.
- The next strong upgrade would be attendance windows, expiring check-in tokens, and officer-only manual attendance overrides.
