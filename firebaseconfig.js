/* ============================================================
   firebase-config.js — your Firebase project credentials
   ============================================================
   SETUP (5 minutes):
   1. Go to https://console.firebase.google.com → Add project
      (you can turn off Google Analytics, not needed here)
   2. In your new project: click the </> (web) icon to register a
      web app → copy the `firebaseConfig` object it gives you and
      paste it below, replacing the placeholder values.
   3. Left sidebar → Build → Firestore Database → Create database
      → start in TEST MODE (fine for development; lock it down
      with security rules before going live).
   4. Left sidebar → Build → Authentication → Sign-in method →
      enable "Anonymous". This lets each visitor get a private
      uid for their own "Saved" list without needing a login form.
   5. Save this file, drop it next to your other HTML files, and
      you're done — data.js will do the rest.
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyAL58Y9WeVJ6YRpeFMASxrYnUD7CgD4gng",
  authDomain: "delta-paw-house.firebaseapp.com",
  projectId: "delta-paw-house",
  storageBucket: "delta-paw-house.firebasestorage.app",
  messagingSenderId: "723832043077",
  appId: "1:723832043077:web:8590f156fb52220662d52c",
  measurementId: "G-TXSHHWPW2G"
};

firebase.initializeApp(firebaseConfig);