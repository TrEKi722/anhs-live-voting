// set-super-admin.js  (delete after use)
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // path to your key

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const uid = 'kirJVMkpMuUP9EsP345qZyBnZgh1';

admin.auth().setCustomUserClaims(uid, { role: 'super_admin' })
  .then(() => admin.firestore().collection('admins').doc(uid).set({
      email: 'troy@ekinney.com', role: 'super_admin',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
  }))
  .then(() => { console.log('Done!'); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });