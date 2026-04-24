#!/bin/bash

# Deployment script for Cups Leaderboard feature
# Run from repository root: bash DEPLOY_CUPS_LEADERBOARD.sh

set -e

echo "📊 Deploying Cups Leaderboard Feature"
echo "======================================"
echo ""

# Step 1: Run tests
echo "1️⃣  Running ranking algorithm tests..."
cd functions
if node test-hats-ranking.js; then
    echo "✓ All tests passed"
else
    echo "✗ Tests failed"
    exit 1
fi
cd ..
echo ""

# Step 2: Deploy Cloud Functions
echo "2️⃣  Deploying Cloud Functions to Firebase..."
cd functions

if command -v firebase &> /dev/null; then
    firebase deploy --only functions
    echo "✓ Cloud Functions deployed"
else
    echo "⚠️  Firebase CLI not found. Install with: npm install -g firebase-tools"
    echo "   Then run: cd functions && firebase deploy --only functions"
    exit 1
fi
cd ..
echo ""

# Step 3: Verify deployment
echo "3️⃣  Verifying deployment..."
if firebase functions:list 2>/dev/null | grep -q "onHatsPressWrite"; then
    echo "✓ onHatsPressWrite function deployed"
else
    echo "⚠️  Could not verify function deployment"
fi
echo ""

# Step 4: Summary
echo "======================================"
echo "✨ Deployment complete!"
echo ""
echo "📌 Next steps:"
echo "1. Start a Cups round on the admin page"
echo "2. Have voters submit correct answers"
echo "3. Verify leaderboard appears on /cups and /wall/cups"
echo ""
echo "📖 For troubleshooting, see: CUPS_LEADERBOARD.md"
echo ""
