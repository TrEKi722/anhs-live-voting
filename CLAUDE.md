# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ANHS Live Voting is a static HTML/CSS/JS live polling app for a high school (ANHS). There is no build system, no package manager, and no framework. Files are served directly as static assets, most likely via Cloudflare Pages.

## Development

Since there's no build step, development is just editing files and opening them in a browser. The app relies on Supabase for all backend functionality (auth, database, realtime), so it requires an internet connection to work.

To preview locally, use any static file server, e.g.:
```
npx serve .
# or
python3 -m http.server
```

Note: OAuth redirects and Cloudflare Turnstile require the actual deployed domain to work properly.

## Architecture

### Script loading model
- **`common.js`** — shared script loaded by every page. Contains all auth logic, Supabase queries, realtime subscriptions, and UI update functions. It uses feature-detection (`typeof updateAdminUI === 'function'`) to call page-specific functions only when present.
- **`61646D696E64617368.js`** — hex for "admindash"; admin-only script loaded only by `admin.html`. Defines `updateAdminUI`, `updateAdminOptionInputs`, `openModal`, `closeModal`, and all admin/super-admin action functions.
- **`script.js`** — legacy script, superseded by `common.js`. Not referenced by any current HTML page.

### Pages and routes
| File | Route | Access |
|------|-------|--------|
| `index.html` | `/` | Voters (anonymous or OAuth) |
| `wall.html` | `/wall` | Admin only — projector/live display with QR code |
| `admin.html` | `/admin` | Admin only — dashboard |
| `sign-in.html` | `/sign-in` | Admin sign-in with email/password + Turnstile CAPTCHA |
| `reset-password.html` | `/reset-password.html` | Password reset flow |

### Auth flow
- Voters on `/` sign in with Microsoft OAuth (Google commented out) and get a persistent session, OR visit anonymously (no auth-container shown if no session)
- Admins sign in via email/password on `/sign-in` with Cloudflare Turnstile CAPTCHA
- `/admin` and `/wall` routes redirect to `/sign-in` if the user isn't authenticated as admin
- Roles (`admin`, `super_admin`) are stored server-side and fetched from a Supabase Edge Function (`get-user-role`)

### Supabase backend
- **Database tables**: `poll_config` (single row with `id='main'`, stores `is_locked`, `results_hidden`, `question`, `option0`–`option3`) and `votes` (stores `user_id`, `option_index`)
- **Realtime**: Subscriptions on both tables drive live UI updates across all connected clients simultaneously
- **Edge Functions**: `get-user-role`, `get-users-with-roles`, `edit-role`, `invite-user`, `delete-user` — called directly via fetch with the user's Supabase access token in the Authorization header

### Role levels
- **voter** — anonymous or OAuth session, can cast one vote
- **admin** — can lock/unlock voting, hide/show results, reset poll, edit question/options
- **super_admin** — all admin powers plus invite/remove admins and edit user roles

### UI conventions
- Dark/light theme is applied automatically via `data-theme` attribute on `<html>` based on `prefers-color-scheme`
- Toasts use `showToast(message)` with a 3-second auto-dismiss
- Modal dialogs are plain `display:block/none` toggles via `openModal(id)` / `closeModal(id)`
- Vote bar colors are index-mapped: 0=yellow, 1=green, 2=blue, 3=red
