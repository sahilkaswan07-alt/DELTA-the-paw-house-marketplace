/* ============================================================
   verification.js — Δ Delta Paw House seller/pet verification
   ============================================================
   WHY A SEPARATE FILE (not inside data.js):
   Your data.js already owns the "pets" collection and its own
   Firestore schema/rules. Rather than guess at that shape and
   risk breaking it, this module keeps verification data in its
   OWN collection ("verifications", one doc per pet, doc id =
   petId) and reads/writes Firestore directly using the same
   `firebase` app that firebaseconfig.js already initialized.
   Photos/video/documents go to Cloudinary, same as the rest of
   the site — no Firebase Storage, no paid plan required.

   LOAD ORDER (after firebase compat scripts):
     <script src="firebaseconfig.js"></script>
     <script src="cloudinaryconfig.js"></script>
     <script src="verification.js"></script>
     <script src="data.js"></script>   (order vs data.js doesn't matter)

   FIRESTORE RULES:
   While Firestore is in TEST MODE (as your firebaseconfig.js
   setup notes say) this needs no extra rules. Before going live,
   add a rule so only admins can write `status`, `adminNote`, and
   `reviewedAt` — everything else in this file assumes an honest
   client, which is fine for development but not for production.

   A NOTE ON THE "OTP":
   Real SMS OTP (Firebase Phone Auth) requires Google's Blaze
   (billing) plan — Spark's free tier does not include it, even
   for a single message. So this file uses a lightweight "mock"
   OTP instead: it generates a 6-digit code, stores it in
   Firestore, and hands it back to your page to *display* to the
   seller (see verify.html) rather than texting it. That's not a
   real identity check — it just confirms the seller can access
   the phone-number field they typed. If you later want a real
   SMS, free-credit options exist (Twilio trial, MSG91, Fast2SMS)
   and can slot into `sendMobileOTP` below without touching
   anything else in this file.
   ============================================================ */

const DeltaVerify = (() => {
  const COLLECTION = 'verifications';
  const db = () => firebase.firestore();

  const STATUS = {
    NONE: 'none',
    PENDING: 'pending',
    IN_REVIEW: 'review',
    MORE_INFO: 'moreinfo',
    APPROVED: 'approved',
    REJECTED: 'rejected'
  };

  // Single source of truth for badge color + meaning, used by
  // home.html, verify.html and admin.html so they never drift.
  const STATUS_META = {
    none:     { label: 'Not Verified',         color: '#7a7a8c', dot: '⚪', meaning: 'Seller hasn\'t started verification yet' },
    pending:  { label: 'Verification Pending', color: '#e0b64d', dot: '🟡', meaning: 'Waiting on the seller to complete verification' },
    review:   { label: 'Under Review',         color: '#4da6e0', dot: '🔵', meaning: 'Submitted — Delta Paw House admin is reviewing it' },
    moreinfo: { label: 'More Info Needed',     color: '#e0823d', dot: '🟠', meaning: 'Admin asked the seller for more information' },
    approved: { label: 'Delta Paw House Verified', color: '#3dbd6d', dot: '🟢', meaning: 'Approved by Delta Paw House admin' },
    rejected: { label: 'Verification Unsuccessful', color: '#e05656', dot: '🔴', meaning: 'Could not be verified with the info provided' }
  };

  async function ensureUid() {
    if (firebase.auth().currentUser) return firebase.auth().currentUser.uid;
    const cred = await firebase.auth().signInAnonymously();
    return cred.user.uid;
  }

  async function getRequest(petId) {
    const snap = await db().collection(COLLECTION).doc(petId).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  }

  function onRequest(petId, cb) {
    return db().collection(COLLECTION).doc(petId)
      .onSnapshot(
        snap => cb(snap.exists ? { id: snap.id, ...snap.data() } : null),
        err => { console.error('DeltaVerify onRequest error:', err); cb(null); }
      );
  }

  // Live { petId: status } map — used by home.html to paint badges
  // on every listing card without opening a doc per card.
  // Guarded: on any error (e.g. Firestore rules not yet set up),
  // this calls back with an EMPTY map instead of throwing, so
  // home.html's pet grid keeps rendering normally, just without badges.
  function onAllStatuses(cb) {
    return db().collection(COLLECTION).onSnapshot(
      qs => {
        const map = {};
        qs.forEach(d => { map[d.id] = (d.data().status) || STATUS.NONE; });
        cb(map);
      },
      err => { console.error('DeltaVerify onAllStatuses error:', err); cb({}); }
    );
  }

  // Live full list — used by admin.html.
  function onAllRequests(cb) {
    return db().collection(COLLECTION).orderBy('updatedAt', 'desc')
      .onSnapshot(
        qs => cb(qs.docs.map(d => ({ id: d.id, ...d.data() }))),
        err => { console.error('DeltaVerify onAllRequests error:', err); cb([]); }
      );
  }

  async function startVerification(petId, petName) {
    await ensureUid();
    await db().collection(COLLECTION).doc(petId).set({
      petId, petName,
      status: STATUS.PENDING,
      seller: { mobile: '', mobileVerified: false, name: '', email: '' },
      pet: { photos: [], video: '' },
      docs: { type: 'none', files: [] },
      adminNote: '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  async function patch(petId, data) {
    await db().collection(COLLECTION).doc(petId).set({
      ...data,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  function genOTP() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  // See "A NOTE ON THE OTP" above — returns the code so the UI
  // can show it, since there's no free SMS gateway wired up.
  async function sendMobileOTP(petId, mobile) {
    const otp = genOTP();
    await db().collection(COLLECTION).doc(petId).set({
      seller: { mobile },
      _otp: otp,
      _otpSentAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return otp;
  }

  async function confirmMobileOTP(petId, code) {
    const req = await getRequest(petId);
    if (!req || !req._otp) return false;
    if (String(req._otp) !== String(code).trim()) return false;
    await db().collection(COLLECTION).doc(petId).set({
      seller: { ...(req.seller || {}), mobileVerified: true },
      _otp: firebase.firestore.FieldValue.delete(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return true;
  }

  // Unsigned Cloudinary upload — works for images and video by
  // passing resourceType, reusing the preset from cloudinaryconfig.js.
  async function uploadToCloudinary(file, resourceType = 'image') {
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;
    const form = new FormData();
    form.append('file', file);
    form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    const res = await fetch(url, { method: 'POST', body: form });
    if (!res.ok) throw new Error('Upload failed — check your Cloudinary preset/cloud name.');
    const data = await res.json();
    return data.secure_url;
  }

  async function submitForReview(petId) {
    await patch(petId, {
      status: STATUS.IN_REVIEW,
      submittedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  // decision: 'approved' | 'moreinfo' | 'rejected'
  async function adminDecision(petId, decision, note) {
    await patch(petId, {
      status: decision,
      adminNote: note || '',
      reviewedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  return {
    STATUS, STATUS_META,
    ensureUid, getRequest, onRequest, onAllStatuses, onAllRequests,
    startVerification, patch, submitForReview, adminDecision,
    sendMobileOTP, confirmMobileOTP, uploadToCloudinary
  };
})();