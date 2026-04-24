const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { verifyRecaptcha } = require('./recaptcha');

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

const RECAPTCHA_SECRET = defineSecret('RECAPTCHA_SECRET');
const WEB_API_KEY = defineSecret('WEB_API_KEY');
const REGION = 'us-central1';

// ==========================================
// Auth helpers
// ==========================================

// Admin email+password sign-in with reCAPTCHA gate.
// Returns a custom token the client signs in with (which carries the role claim).
exports.adminEmailPasswordSignIn = onCall(
  { region: REGION, secrets: [RECAPTCHA_SECRET, WEB_API_KEY] },
  async (req) => {
    const { email, password, recaptchaToken } = req.data || {};
    if (!email || !password) throw new HttpsError('invalid-argument', 'Email and password required.');

    const check = await verifyRecaptcha(recaptchaToken, RECAPTCHA_SECRET.value());
    if (!check.success) throw new HttpsError('permission-denied', 'Captcha failed.');

    const apiKey = process.env.WEB_API_KEY;
    if (!apiKey) throw new HttpsError('failed-precondition', 'Missing WEB_API_KEY.');

    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: false }) }
    );
    const data = await resp.json();
    if (!resp.ok || !data.localId) throw new HttpsError('unauthenticated', 'Invalid email or password.');

    const user = await auth.getUser(data.localId);
    const role = user.customClaims?.role || null;
    const customToken = await auth.createCustomToken(user.uid, { role });
    return { customToken };
  }
);

// Password reset with reCAPTCHA gate. Silently succeeds for non-admin emails
// to avoid account enumeration.
exports.adminSendPasswordReset = onCall(
  { region: REGION, secrets: [RECAPTCHA_SECRET, WEB_API_KEY] },
  async (req) => {
    const { email, recaptchaToken } = req.data || {};
    if (!email) throw new HttpsError('invalid-argument', 'Email required.');

    const check = await verifyRecaptcha(recaptchaToken, RECAPTCHA_SECRET.value());
    if (!check.success) throw new HttpsError('permission-denied', 'Captcha failed.');

    try {
      const user = await auth.getUserByEmail(email);
      const role = user.customClaims?.role;
      if (role !== 'admin' && role !== 'super_admin') return { sent: true };
    } catch (_) {
      return { sent: true };
    }

    const apiKey = process.env.WEB_API_KEY;
    if (!apiKey) throw new HttpsError('failed-precondition', 'Missing WEB_API_KEY.');

    await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }) }
    );
    return { sent: true };
  }
);

// Voter anonymous sign-in gate: verify reCAPTCHA before client calls signInAnonymously().
exports.verifyVoterCaptcha = onCall(
  { region: REGION, secrets: [RECAPTCHA_SECRET] },
  async (req) => {
    const { recaptchaToken } = req.data || {};
    const check = await verifyRecaptcha(recaptchaToken, RECAPTCHA_SECRET.value());
    if (!check.success) throw new HttpsError('permission-denied', 'Captcha failed.');
    return { ok: true };
  }
);

// ==========================================
// Super-admin user management
// ==========================================

function requireSuperAdmin(req) {
  if (req.auth?.token?.role !== 'super_admin')
    throw new HttpsError('permission-denied', 'Super-admin only.');
}

function requireAdmin(req) {
  const r = req.auth?.token?.role;
  if (r !== 'admin' && r !== 'super_admin')
    throw new HttpsError('permission-denied', 'Admin only.');
}

exports.listAdmins = onCall({ region: REGION }, async (req) => {
  requireSuperAdmin(req);
  const out = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      const role = u.customClaims?.role;
      if (role === 'admin' || role === 'super_admin')
        out.push({ uid: u.uid, email: u.email || '', role });
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return { admins: out };
});

exports.setUserRole = onCall({ region: REGION }, async (req) => {
  requireSuperAdmin(req);
  const { email, role } = req.data || {};
  if (!email || !['admin', 'super_admin', 'none'].includes(role))
    throw new HttpsError('invalid-argument', 'Invalid email or role.');

  const user = await auth.getUserByEmail(email);
  if (role === 'none') {
    await auth.setCustomUserClaims(user.uid, {});
    await db.collection('admins').doc(user.uid).delete().catch(() => {});
  } else {
    await auth.setCustomUserClaims(user.uid, { role });
    await db.collection('admins').doc(user.uid).set({
      email, role, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  return { ok: true };
});

exports.inviteAdmin = onCall({ region: REGION, secrets: [WEB_API_KEY] }, async (req) => {
  requireSuperAdmin(req);
  const { email, role } = req.data || {};
  if (!email || !['admin', 'super_admin'].includes(role))
    throw new HttpsError('invalid-argument', 'Invalid email or role.');

  let user;
  try { user = await auth.getUserByEmail(email); }
  catch (_) {
    user = await auth.createUser({
      email, emailVerified: false,
      password: `tmp-${Math.random().toString(36).slice(2)}-${Date.now()}`,
    });
  }

  await auth.setCustomUserClaims(user.uid, { role });
  await db.collection('admins').doc(user.uid).set({
    email, role, createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const apiKey = process.env.WEB_API_KEY;
  if (apiKey) {
    await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }) }
    );
  }
  return { ok: true, uid: user.uid };
});

exports.deleteAdmin = onCall({ region: REGION }, async (req) => {
  requireSuperAdmin(req);
  const { email } = req.data || {};
  if (!email) throw new HttpsError('invalid-argument', 'Email required.');
  const user = await auth.getUserByEmail(email);
  if (user.uid === req.auth.uid)
    throw new HttpsError('failed-precondition', 'Cannot delete yourself.');
  await auth.deleteUser(user.uid);
  await db.collection('admins').doc(user.uid).delete().catch(() => {});
  return { ok: true };
});

// ==========================================
// Admin bulk resets (clients can't batch-delete collections)
// ==========================================

async function wipeCollection(name, filter) {
  let q = db.collection(name);
  if (filter) q = q.where(filter.field, filter.op, filter.value);
  const snap = await q.get();
  for (let i = 0; i < snap.size; i += 400) {
    const batch = db.batch();
    snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

exports.adminResetGame = onCall({ region: REGION }, async (req) => {
  requireAdmin(req);
  const { game, roundId } = req.data || {};
  const ts = admin.firestore.FieldValue.serverTimestamp;

  switch (game) {
    case 'poll':
      await wipeCollection('votes');
      await db.doc('counters/poll').set({ total: 0, o0: 0, o1: 0, o2: 0, o3: 0, updatedAt: ts() });
      await db.doc('config/poll').update({ is_locked: false });
      return { ok: true };

    case 'cups':
      await wipeCollection('hats_presses');
      await db.doc('counters/hats').set({
        total: 0, c0: 0, c1: 0, c2: 0, c3: 0, correctCount: 0, updatedAt: ts() });
      await db.doc('config/hats').update({ is_active: false, correct_option: null });
      return { ok: true };

    case 'name_game':
      await wipeCollection('name_game_scores');
      await db.doc('leaderboards/name_game').set({ top: [], updatedAt: ts() });
      await db.doc('config/name_game').update({
        is_active: false, image_set: null, image_order: [],
        round_start_time: null, round_end_time: null,
      });
      return { ok: true };

    case 'yearbook_scores':
      await wipeCollection('yearbook_scores');
      await db.doc('leaderboards/yearbook').set({ top: [], updatedAt: ts() });
      return { ok: true };

    case 'wally':
      if (roundId) await wipeCollection('wally_scores', { field: 'round_id', op: '==', value: roundId });
      else await wipeCollection('wally_scores');
      await db.doc('leaderboards/wally').set({ top: [], round_id: null, updatedAt: ts() });
      await db.doc('config/wally').update({
        is_active: false, scene_id: null, round_id: null, started_at: null });
      return { ok: true };

    default:
      throw new HttpsError('invalid-argument', 'Unknown game: ' + game);
  }
});

// ==========================================
// Firestore triggers — keep counters & leaderboards in sync
// ==========================================

exports.onVoteWrite = onDocumentWritten(
  { region: REGION, document: 'votes/{uid}' },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    const bi = before?.option_index ?? null;
    const ai = after?.option_index  ?? null;
    if (bi === ai) return;

    await db.runTransaction(async (tx) => {
      const ref  = db.doc('counters/poll');
      const snap = await tx.get(ref);
      const d    = snap.data() || { total: 0, o0: 0, o1: 0, o2: 0, o3: 0 };
      if (bi !== null) { d[`o${bi}`] = Math.max(0, (d[`o${bi}`] || 0) - 1); d.total = Math.max(0, d.total - 1); }
      if (ai !== null) { d[`o${ai}`] = (d[`o${ai}`] || 0) + 1; d.total = (d.total || 0) + 1; }
      d.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      tx.set(ref, d);
    });
  }
);

exports.onHatsPressWrite = onDocumentWritten(
  { region: REGION, document: 'hats_presses/{uid}' },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    const bc = before?.choice ?? null;
    const ac = after?.choice  ?? null;

    const cfgSnap = await db.doc('config/hats').get();
    const correct = cfgSnap.data()?.correct_option ?? null;

    if (bc !== ac) {
      await db.runTransaction(async (tx) => {
        const ref  = db.doc('counters/hats');
        const snap = await tx.get(ref);
        const d    = snap.data() || { total: 0, c0: 0, c1: 0, c2: 0, c3: 0, correctCount: 0 };
        if (bc !== null) {
          d[`c${bc}`] = Math.max(0, (d[`c${bc}`] || 0) - 1);
          d.total = Math.max(0, d.total - 1);
          if (correct !== null && bc === correct) d.correctCount = Math.max(0, d.correctCount - 1);
        }
        if (ac !== null) {
          d[`c${ac}`] = (d[`c${ac}`] || 0) + 1;
          d.total = (d.total || 0) + 1;
          if (correct !== null && ac === correct) d.correctCount = (d.correctCount || 0) + 1;
        }
        d.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        tx.set(ref, d);
      });
    }

    // Write rank back to the doc. Guard: only when rank is not yet set, preventing infinite recursion.
    // Note: !before removed — if a user presses again in a new round without a reset, Firestore
    // sees it as an update (before exists), but we still need to rank it.
    if (after && ac !== null && after.rank === undefined) {
      let rank = null;
      if (correct !== null && ac === correct) {
        // Fetch all correct presses, sort by timestamp, and find this user's rank
        const snap = await db.collection('hats_presses')
          .where('choice', '==', correct)
          .get();
        const docs = snap.docs
          .map(d => ({ id: d.id, timestamp: d.data().timestamp }))
          .sort((a, b) => {
            const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            if (timeA !== timeB) return timeA - timeB;
            return String(a.id).localeCompare(String(b.id));
          });
        const userIndex = docs.findIndex(d => d.id === event.data.after.id);
        if (userIndex >= 0) rank = userIndex + 1;
      }
      await event.data.after.ref.update({ rank });
    }
  }
);

exports.onYearbookVoteWrite = onDocumentWritten(
  { region: REGION, document: 'yearbook_votes/{docId}' },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    const roundId = (after || before)?.round_id ?? null;
    if (roundId === null) return;

    await db.runTransaction(async (tx) => {
      const ref  = db.doc('counters/yearbook');
      const snap = await tx.get(ref);
      const d    = snap.data()?.round_id === roundId
        ? snap.data()
        : { round_id: roundId, counts: {}, total: 0 };

      const bt = before?.round_id === roundId ? (before?.teacher_index ?? null) : null;
      const at = after?.round_id  === roundId ? (after?.teacher_index  ?? null) : null;
      if (bt !== null) {
        d.counts[bt] = Math.max(0, (d.counts[bt] || 0) - 1);
        d.total = Math.max(0, d.total - 1);
      }
      if (at !== null) {
        d.counts[at] = (d.counts[at] || 0) + 1;
        d.total = (d.total || 0) + 1;
      }
      d.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      tx.set(ref, d);
    });
  }
);

async function rebuildLeaderboard(collection, field, asc, docId) {
  const snap = await db.collection(collection).orderBy(field, asc ? 'asc' : 'desc').limit(5).get();
  const top = snap.docs.map(d => ({ display_name: d.data().display_name || 'Anonymous', [field]: d.data()[field] }));
  await db.doc(`leaderboards/${docId}`).set({
    top, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

exports.onNameGameScoreWrite = onDocumentWritten(
  { region: REGION, document: 'name_game_scores/{uid}' },
  async () => rebuildLeaderboard('name_game_scores', 'score', false, 'name_game')
);

exports.onYearbookScoreWrite = onDocumentWritten(
  { region: REGION, document: 'yearbook_scores/{uid}' },
  async () => rebuildLeaderboard('yearbook_scores', 'score', false, 'yearbook')
);

exports.onWallyScoreWrite = onDocumentWritten(
  { region: REGION, document: 'wally_scores/{docId}' },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    const roundId = (after || before)?.round_id;
    if (!roundId) return;

    // Keep this trigger independent of composite indexes by reading the round's
    // scores and sorting in memory. Wally rounds are small enough that this is
    // a safer tradeoff than relying on round_id + time_ms indexes being deployed.
    const snap = await db.collection('wally_scores')
      .where('round_id', '==', roundId)
      .get();

    const rankedDocs = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const timeDiff = (a.time_ms || 0) - (b.time_ms || 0);
        if (timeDiff !== 0) return timeDiff;
        return String(a.id).localeCompare(String(b.id));
      });

    const top = rankedDocs.slice(0, 5).map((d) => ({
      display_name: d.display_name || 'Anonymous',
      time_ms: d.time_ms,
    }));
    await db.doc('leaderboards/wally').set({
      round_id: roundId, top,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Stamp rank onto the user's doc on first insert
    if (!before && after?.time_ms && after.rank === undefined) {
      const rank = rankedDocs.findIndex((d) => d.id === event.data.after.id) + 1;
      if (rank > 0) {
        await event.data.after.ref.update({ rank });
      }
    }
  }
);
