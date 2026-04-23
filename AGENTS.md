# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

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
# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## What this is

ANHS Live Voting is a static HTML/CSS/JS live polling and games app for a high school (ANHS). There is no build system, no package manager, and no framework. Files are served directly as static assets via Cloudflare Pages.

## Development

Since there's no build step, development is just editing files and opening them in a browser. The app relies on Firebase (Auth, Firestore, Cloud Functions) for all backend functionality, so it requires an internet connection to work.

To preview locally, use any static file server, e.g.:
```
npx serve .
# or
python3 -m http.server
```

Note: OAuth redirects and Cloudflare Turnstile require the actual deployed domain to work properly. Append `?emulator=1` to any URL to point the Firebase SDK at local emulators (auth on :9099, Firestore on :8080, Functions on :5001).

## Architecture

### Script loading model
- **`firebase-config.js`** — initializes Firebase app, Auth, Firestore, and Cloud Functions. Loaded first by every page.
- **`common.js`** — shared script loaded by every page. Contains all auth logic, Firestore queries, realtime subscriptions, and UI update functions. Exposes a `supabaseC` compatibility shim (wraps Firebase) so callers use a consistent query API. Uses feature-detection (`typeof updateAdminUI === 'function'`) to call page-specific functions only when present.
- **`61646D696E64617368.js`** — hex for "admindash"; admin-only script loaded only by `admin.html`. Defines `updateAdminUI`, `updateAdminOptionInputs`, `openModal`, `closeModal`, and all admin/super-admin action functions.
- **`script.js`** — legacy script, superseded by `common.js`. Not referenced by any current HTML page.
- **`functions/index.js`** — Firebase Cloud Functions (Node.js). Handles privileged operations and Firestore triggers.

### Pages and routes
| File | Route | Access |
|------|-------|--------|
| `index.html` | `/` | Voters (anonymous or OAuth) |
| `vote.html` | `/vote` | Vote page |
| `wall.html` | `/wall` | Admin only — projector/live display with QR code |
| `admin.html` | `/admin` | Admin only — dashboard |
| `sign-in.html` | `/sign-in` | Admin sign-in with email/password + Turnstile CAPTCHA |
| `reset-password.html` | `/reset-password` | Password reset flow |
| `welcome.html` | `/welcome` | Welcome/onboarding |
| `cups.html` | `/cups` | Cups speed game (voter view) |
| `hats.html` | `/hats` | Hats page |
| `name-game.html` | `/name-game` | Name Game (voter view) |
| `yearbook.html` | `/yearbook` | Yearbook game (voter view) |
| `wally.html` | `/wally` | Wally find-the-teacher game (voter view) |
| `admin/vote.html` | `/admin/vote` | Admin view — poll |
| `admin/cups.html` | `/admin/cups` | Admin view — Cups |
| `admin/name-game.html` | `/admin/name-game` | Admin view — Name Game |
| `admin/yearbook.html` | `/admin/yearbook` | Admin view — Yearbook |
| `admin/wally.html` | `/admin/wally` | Admin view — Wally |
| `admin/admins.html` | `/admin/admins` | Super-admin — manage admins |
| `wall/vote.html` | `/wall/vote` | Wall display — poll |
| `wall/cups.html` | `/wall/cups` | Wall display — Cups |
| `wall/ng.html` | `/wall/ng` | Wall display — Name Game |
| `wall/yearbook.html` | `/wall/yearbook` | Wall display — Yearbook |
| `wall/wally.html` | `/wall/wally` | Wall display — Wally |

### Auth flow
- Voters sign in with Microsoft OAuth (Google commented out) and get a persistent session, OR visit anonymously
- Admins sign in via email/password on `/sign-in` — handled by the `adminEmailPasswordSignIn` Cloud Function which verifies Cloudflare Turnstile and returns a Firebase custom token
- `/admin` and `/wall` routes redirect to `/sign-in` if the user isn't authenticated as admin
- Roles (`admin`, `super_admin`) are stored as Firebase custom claims on the user token

### Firebase backend

#### Firestore document structure
| Path | Purpose |
|------|---------|
| `config/poll` | Poll config: `is_locked`, `results_hidden`, `question`, `option0`–`option3` |
| `config/hats` | Cups config: `is_active`, `correct_option` |
| `config/name_game` | Name Game config: `is_active`, `image_set`, `image_order`, `round_start_time`, `round_end_time` |
| `config/yearbook` | Yearbook config: `phase`, `teacher_index`, `option_indices`, `round_id`, `teacher_queue`, `queue_position` |
| `config/wally` | Wally config: `is_active`, `scene_id`, `round_id`, `started_at` |
| `counters/poll` | Aggregated vote counts: `total`, `o0`–`o3` |
| `counters/hats` | Aggregated cups press counts: `total`, `c0`–`c3`, `correctCount` |
| `counters/yearbook` | Aggregated yearbook votes for current round: `round_id`, `counts`, `total` |
| `leaderboards/name_game` | Top 5 name game scores: `top[]` |
| `leaderboards/yearbook` | Top 5 yearbook scores: `top[]` |
| `leaderboards/wally` | Top 5 wally times for current round: `round_id`, `top[]` |
| `votes/{uid}` | One doc per user: `option_index` |
| `hats_presses/{uid}` | One doc per user: `choice`, `timestamp`, `rank` |
| `name_game_scores/{uid}` | One doc per user: `score`, `display_name` |
| `yearbook_scores/{uid}` | One doc per user: cumulative `score`, `display_name` |
| `yearbook_votes/{uid}_{round_id}` | One doc per user per round: `teacher_index`, `round_id` |
| `wally_scores/{uid}_{round_id}` | One doc per user per round: `time_ms`, `round_id`, `rank`, `display_name` |
| `user_profiles/{uid}` | One doc per user: `username` |
| `admins/{uid}` | One doc per admin: `email`, `role` |

#### Realtime
Firestore `onSnapshot` listeners drive live UI updates. Subscriptions are set up in `common.js` via `subscribeToDoc` and `subscribeToCollection` helpers.

#### Cloud Functions (`functions/index.js`)
| Function | Trigger | Role required | Purpose |
|----------|---------|--------------|---------|
| `adminEmailPasswordSignIn` | Callable | — | Email+password sign-in with Turnstile gate; returns custom token |
| `adminSendPasswordReset` | Callable | — | Password reset email with Turnstile gate |
| `listAdmins` | Callable | super_admin | List all admin/super_admin users |
| `setUserRole` | Callable | super_admin | Set or remove a user's role |
| `inviteAdmin` | Callable | super_admin | Create admin user and send reset email |
| `deleteAdmin` | Callable | super_admin | Delete an admin user |
| `adminResetGame` | Callable | admin | Wipe game data and reset config for a given game |
| `onVoteWrite` | Firestore trigger | — | Keeps `counters/poll` in sync |
| `onHatsPressWrite` | Firestore trigger | — | Keeps `counters/hats` in sync; stamps rank on first insert |
| `onYearbookVoteWrite` | Firestore trigger | — | Keeps `counters/yearbook` in sync |
| `onNameGameScoreWrite` | Firestore trigger | — | Rebuilds `leaderboards/name_game` |
| `onYearbookScoreWrite` | Firestore trigger | — | Rebuilds `leaderboards/yearbook` |
| `onWallyScoreWrite` | Firestore trigger | — | Rebuilds `leaderboards/wally`; stamps rank on first insert |

### Games

- **Poll** — voters pick one of up to 4 options on a question; admin can lock/unlock and hide/show results
- **Cups** — speed game: admin reveals the correct cup, voters race to press it; fastest correct presses are ranked
- **Name Game** — voters memorize a set of teacher photos+names then identify them under a time limit; cumulative score tracked
- **Yearbook** — admin runs rounds where voters identify a teacher from their old yearbook photo; score awarded per correct guess
- **Wally** — find-the-teacher hidden in a scene image; fastest find wins; leaderboard is per-round

### Role levels
- **voter** — anonymous or OAuth session, can participate in all games
- **admin** — can control all games (lock/unlock, start/stop, reset), edit poll question/options
- **super_admin** — all admin powers plus invite/remove admins and edit user roles

### UI conventions
- Dark/light theme is applied automatically via `data-theme` attribute on `<html>` based on `prefers-color-scheme`
- Toasts use `showToast(message)` with a 3-second auto-dismiss
- Modal dialogs are plain `display:block/none` toggles via `openModal(id)` / `closeModal(id)`
- Vote bar colors are index-mapped: 0=yellow, 1=green, 2=blue, 3=red
