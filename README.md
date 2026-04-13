# SASE Student Portal

This project is now a real shared full-stack club app.

## Stack

- Frontend: installable PWA served from the same app
- Backend: Flask
- Database: SQLite
- Auth: secure password hashing with Flask sessions

## What is shared now

- member accounts
- officer accounts
- events
- RSVP and interest counts
- attendance check-in
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

Because this app has a Python backend, use a host like Render, Railway, or Fly.io. GitHub Pages alone is not enough.

The project is already prepared for Render with [render.yaml](./render.yaml).

Basic Render flow:

1. Push this project to a GitHub repository
2. Create a new Render web service from that repo
3. Set `OFFICER_INVITE_CODE` in Render
4. Let Render build and deploy the app
5. Use the public Render URL for your QR codes

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
3. For the event you want, click `Start Check-in`
4. Copy the generated check-in link
5. Turn that link into a QR code
6. Show that QR code at the event
7. Members scan it, log in if needed, and their attendance is recorded
8. Click `Stop Check-in` when the event is over

The QR code should point to a public URL later, like:

```text
https://your-domain.com/?checkin=TOKEN
```

## Notes before public launch

- SQLite is fine for early real use and testing, but for a larger public rollout you may want Postgres later.
- Do not commit your live database file.
- If you deploy publicly, set a real `SECRET_KEY` and `OFFICER_INVITE_CODE`.
- The next strong upgrade would be attendance windows, expiring check-in tokens, and officer-only manual attendance overrides.
