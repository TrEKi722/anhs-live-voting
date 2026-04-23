// One-off seed script — run once after creating the Firebase project.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
//   SUPER_ADMIN_EMAIL=you@example.com \
//   node seed.js
//
// The service account JSON is downloaded from:
//   Firebase Console → Project Settings → Service accounts → Generate new private key

const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.applicationDefault() });

const db   = admin.firestore();
const auth = admin.auth();
const ts   = admin.firestore.FieldValue.serverTimestamp;

async function seedConfigs() {
  const batch = db.batch();

  batch.set(db.doc('config/poll'), {
    is_locked: true, results_hidden: true,
    question: 'Sample question?',
    option0: 'Option A', option1: 'Option B', option2: 'Option C', option3: 'Option D',
  }, { merge: true });
  batch.set(db.doc('counters/poll'), { total: 0, o0: 0, o1: 0, o2: 0, o3: 0 }, { merge: true });

  batch.set(db.doc('config/hats'),    { is_active: false, correct_option: null }, { merge: true });
  batch.set(db.doc('counters/hats'),  { total: 0, c0: 0, c1: 0, c2: 0, c3: 0, correctCount: 0 }, { merge: true });

  batch.set(db.doc('config/name_game'), {
    is_active: false, image_set: null, image_order: [],
    round_duration_seconds: 30, memorize_duration_seconds: 10,
    round_start_time: null, round_end_time: null,
  }, { merge: true });

  batch.set(db.doc('config/yearbook'), {
    phase: 'waiting', teacher_index: null, option_indices: [],
    round_id: null, teacher_queue: [], queue_position: 0,
  }, { merge: true });

  batch.set(db.doc('config/wally'), {
    is_active: false, scene_id: null, round_id: null, started_at: null,
  }, { merge: true });

  await batch.commit();
  console.log('✓ Config docs seeded');
}

async function promoteSuperAdmin() {
  const email = process.env.SUPER_ADMIN_EMAIL;
  if (!email) { console.log('! Skipping super-admin (SUPER_ADMIN_EMAIL not set)'); return; }

  let user;
  try { user = await auth.getUserByEmail(email); }
  catch (_) {
    user = await auth.createUser({
      email, emailVerified: false,
      password: `tmp-${Math.random().toString(36).slice(2)}-${Date.now()}`,
    });
    console.log(`  Created user ${email}`);
  }

  await auth.setCustomUserClaims(user.uid, { role: 'super_admin' });
  await db.collection('admins').doc(user.uid).set({
    email, role: 'super_admin', createdAt: ts(),
  }, { merge: true });

  console.log(`✓ ${email} promoted to super_admin. Send them a password reset to set their password.`);
}

async function main() {
  await seedConfigs();
  await promoteSuperAdmin();
  console.log('Done.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
