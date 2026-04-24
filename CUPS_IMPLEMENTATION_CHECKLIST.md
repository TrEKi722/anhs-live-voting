# Cups Leaderboard Implementation Checklist

## ✅ Completed

### Code Implementation
- [x] Cloud Function `onHatsPressWrite` updated with leaderboard building logic
- [x] Leaderboard sorting algorithm (timestamp-based with tie-breaking)
- [x] Client-side leaderboard loading and real-time subscription
- [x] Voter page display (cups.html) - shows in result + waiting states
- [x] Wall page display (wall/cups.html) - shows between rounds
- [x] LEADERBOARD_DOCS.hats constant added
- [x] Initial load on page init

### Quality Assurance
- [x] Comprehensive test suite (functions/test-hats-ranking.js)
  - 8 tests covering all scenarios
  - All tests passing
  - Run with: `cd functions && node test-hats-ranking.js`

### Documentation
- [x] CUPS_LEADERBOARD.md - Complete feature documentation
  - Architecture overview
  - Firestore schema documentation
  - Client logic explanation
  - Data flow diagrams
  - Troubleshooting guide
  
- [x] JSDoc comments
  - onHatsPressWrite Cloud Function
  - loadCupsLeaderboard client function

- [x] DEPLOY_CUPS_LEADERBOARD.sh - One-command deployment script
  - Runs tests
  - Deploys Cloud Functions
  - Verifies deployment
  - Provides next steps

## 🚀 Ready to Deploy

### Deployment Command
```bash
bash DEPLOY_CUPS_LEADERBOARD.sh
```

Or manually:
```bash
cd functions
npm install  # if needed
firebase deploy --only functions
```

### What Gets Deployed
- Updated `onHatsPressWrite` Cloud Function trigger

### What's Already Live
- Client-side code (cups.html, wall/cups.html, common.js)
- UI elements and real-time subscriptions

## 📋 Post-Deployment Verification

### Checklist for first test round:
1. [ ] Start a Cups round on admin page
2. [ ] Set correct option to one of the cups (1, 2, or 3)
3. [ ] From a voter account, submit the correct answer
4. [ ] Check `/cups` page - verify leaderboard shows 1st place
5. [ ] Check `/wall/cups` page - verify leaderboard shows your name
6. [ ] Submit from another account with later timestamp
7. [ ] Verify both names appear in correct order (earliest first)
8. [ ] Submit an incorrect answer from third account
9. [ ] Verify incorrect answer is filtered out of leaderboard

## 🔍 Files Modified

### Backend
- `functions/index.js` - Updated onHatsPressWrite trigger with leaderboard logic

### Frontend
- `common.js` - Added leaderboard state, loading, subscriptions, UI updates
- `cups.html` - Added leaderboard UI container
- `wall/cups.html` - Added leaderboard UI container

### Documentation & Tests
- `CUPS_LEADERBOARD.md` - Feature documentation
- `functions/test-hats-ranking.js` - Test suite
- `DEPLOY_CUPS_LEADERBOARD.sh` - Deployment script
- `CUPS_IMPLEMENTATION_CHECKLIST.md` - This file

## 🎯 Success Criteria

The implementation is complete when:
- [ ] Cloud Functions deployed successfully
- [ ] First test round completes
- [ ] Leaderboard displays correctly on both pages
- [ ] Ranking is accurate (earliest first)
- [ ] Wrong answers filtered out
- [ ] Real-time updates work

## 📝 Notes

- All code follows existing patterns in the codebase
- Matches Wally game's proven leaderboard approach
- Handles edge cases: anonymous users, missing timestamps, empty results
- No database schema changes required (uses existing `hats_presses` docs)
- Real-time updates via Firestore subscriptions
- Fully documented and tested
