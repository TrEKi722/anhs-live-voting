# Cups Game Leaderboard System

## Overview

The Cups leaderboard tracks the fastest correct answers and displays them in real-time on both the voter page (`/cups`) and the wall/projector page (`/wall/cups`).

## Architecture

### Cloud Functions (Firebase)

**`onHatsPressWrite` trigger** (`functions/index.js`)

Fires whenever a user submits a cup press. Performs three tasks:

1. **Counter updates** - Keeps `counters/hats` in sync with total presses and correct answers
2. **Leaderboard rebuild** - When a correct answer is submitted:
   - Fetches all correct presses for the current round
   - Sorts by timestamp (earliest first, tie-breaker: user ID alphabetically)
   - Saves top 5 to `leaderboards/hats`
3. **Rank stamping** - Writes the user's rank back to their `hats_presses/{uid}` doc for display

### Firestore Schema

#### `leaderboards/hats`
```json
{
  "top": [
    { "display_name": "azure-tiger", "timestamp": "2025-04-23T21:02:15.000Z" },
    { "display_name": "stellar-wolf", "timestamp": "2025-04-23T21:02:18.500Z" },
    ...
  ],
  "updatedAt": <server timestamp>
}
```

#### `hats_presses/{uid}`
```json
{
  "user_id": "user_123",
  "choice": 2,
  "timestamp": "2025-04-23T21:02:15.000Z",
  "rank": 1
}
```

### Client Logic (common.js)

- **`loadCupsLeaderboard(limit)`** - Fetches top N entries from `leaderboards/hats`
- **`setupCupsRealtime()`** - Subscribes to real-time updates for the leaderboard and user's press
- **`updateCupsUI()`** - Displays leaderboard on voter page when game is inactive or after submission
- **`updateWallCupsUI()`** - Displays leaderboard on wall page during breaks between rounds

## Deployment

### Step 1: Deploy Cloud Functions

```bash
cd functions
npm install
npm run deploy
```

This deploys the updated `onHatsPressWrite` trigger.

### Step 2: Verify Firestore Indexes

The `onHatsPressWrite` function uses a single-field query on `hats_presses.choice`. This doesn't require a composite index and should work immediately.

### Step 3: Test End-to-End

1. Start a Cups round on the admin page
2. Set the correct option (e.g., cup 2)
3. From a voter account, submit the correct answer
4. Verify on the wall page that the leaderboard appears with your name in 1st place
5. Submit from another account at a later timestamp
6. Verify both names appear in correct order on the leaderboard

## Data Flow

```
User submits → hats_presses/{uid} created
              ↓
Cloud Function triggered (onHatsPressWrite)
              ↓
Fetch all correct presses → Sort by time → Save top 5 to leaderboards/hats
              ↓
Client subscribed to leaderboards/hats receives update
              ↓
updateCupsUI() renders leaderboard on screen
```

## Display Logic

### Voter Page (`/cups`)

- **During round** - Hidden (user should be focused on picking)
- **After submitting** - Shows result card + leaderboard below
- **Waiting for next round** - Shows leaderboard if data exists

### Wall Page (`/wall/cups`)

- **During round** - Hidden (shows live count of correct answers)
- **Between rounds** - Shows leaderboard with top 5

## Troubleshooting

### Leaderboard not showing

1. Check `leaderboards/hats` exists in Firestore
2. Verify Cloud Functions were deployed: `firebase functions:list`
3. Check Cloud Functions logs for errors: `firebase functions:log`
4. Ensure at least one correct answer has been submitted in the current round

### Incorrect ranking

1. Verify timestamps are ISO 8601 format in Firestore
2. Check the sorting logic in `onHatsPressWrite` (line 307-312)
3. Confirm no data corruption in `hats_presses` collection

### Missing display name

1. Verify user profile exists in `user_profiles/{uid}` collection
2. Check `common.js` `getOrCreateUsername()` function is being called during auth

## Performance Considerations

- Leaderboard query fetches all correct presses (limited by round, but could be many)
- Sorting happens in-memory in Cloud Function (acceptable for typical round sizes)
- Real-time subscription updates via single document (`leaderboards/hats`)
- No additional indexes required

## Future Enhancements

- [ ] Historical leaderboards per round
- [ ] Stats: fastest time, accuracy percentage
- [ ] Sound effect when entering top 5
- [ ] Animation when rank changes during live round
