// Firebase web config — public by design; security enforced by Firestore rules.
// Replace placeholders with values from:
//   Firebase Console → Project Settings → Your apps → Web app
(function () {
  const firebaseConfig = {
    apiKey:            "AIzaSyAiHXf0pI31GMNHOtmXsjvpCvGr0U748xo",
    authDomain:        "anhs-live-voting-b5033.firebaseapp.com",
    projectId:         "anhs-live-voting-b5033",
    storageBucket:     "anhs-live-voting-b5033.firebasestorage.app",
    messagingSenderId: "484586348271",
    appId:             "1:484586348271:web:ea8cdecc2fc92b8494c51a"
  };

  firebase.initializeApp(firebaseConfig);
  firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);

  // All callable functions are in us-central1 — must match functions/index.js.
  window._fns = firebase.app().functions('us-central1');

  // Append ?emulator=1 to point at local emulators.
  if (new URLSearchParams(location.search).get('emulator') === '1') {
    firebase.auth().useEmulator('http://localhost:9099');
    firebase.firestore().useEmulator('localhost', 8080);
    window._fns.useEmulator('localhost', 5001);
    console.log('[Firebase] emulators active');
  }
})();
