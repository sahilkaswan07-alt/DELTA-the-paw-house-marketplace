/* ============================================================
   data.js — Firebase-backed data layer for Δ Delta Marketplace
   ============================================================
   Load order on every page:
   <script src="https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js"></script>
   <script src="https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore-compat.js"></script>
   <script src="https://www.gstatic.com/firebasejs/12.16.0/firebase-auth-compat.js"></script>
   <script src="firebaseconfig.js"></script>
   <script src="cloudinaryconfig.js"></script>
   <script src="data.js"></script>

   Provides window.DeltaStore with: ready, getAll, getById, add,
   getSaved, isSaved, toggleSaved, onListingsChange

   IMPORTANT CHANGE FROM THE LOCALSTORAGE VERSION:
   Every data method is now ASYNC (returns a Promise), since it
   talks to Firestore over the network instead of reading
   localStorage synchronously. Call sites need `await` or `.then()`.

   PHOTO UPLOADS: these go to Cloudinary's free tier (see
   cloudinaryconfig.js), NOT Firebase Storage — Firebase Storage
   now requires the project to be on the paid Blaze plan, even for
   free-tier usage. Firestore + Auth stay on Firebase's free Spark
   plan; only image hosting moved to Cloudinary.
   ============================================================ */
const DeltaStore = (() => {
  const db = firebase.firestore();
  const auth = firebase.auth();
  const LISTINGS = 'listings';
  const SAVED = 'saved';

  const SEED_LISTINGS = [
    {
      name: 'Golden Retriever',
      breed: 'Golden Retriever',
      category: 'dog',
      city: 'Ahmedabad',
      price: 18000,
      age: '8 months',
      gender: 'Male',
      color: 'Golden',
      description: "Friendly, playful, and great with kids. Fully vaccinated with all health records available. Raised in a loving home — looking for a family that can give this pup the same care and attention.",
      photo: '🐶',
      sellerName: 'Rahul Sharma',
      sellerMeta: 'Member since 2024 · 12 listings',
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 3
    },
    {
      name: 'Persian Cat',
      breed: 'Persian Cat',
      category: 'cat',
      city: 'Surat',
      price: 10500,
      age: '1 year',
      gender: 'Female',
      color: 'White',
      description: "Calm, affectionate lap cat. Litter trained and used to easy indoor living.",
      photo: '🐱',
      sellerName: 'Priya Patel',
      sellerMeta: 'Member since 2023 · 5 listings',
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 7
    }
  ];

  let uid = null;
  let savedCache = [];

  // Resolves once we have an anonymous uid, the seed data exists,
  // and the user's saved list has been loaded. Every public method
  // awaits this first, so callers never have to think about it.
  //
  // IMPORTANT: this now rejects (instead of hanging forever) if
  // anonymous auth fails or nothing happens within 10s — e.g. because
  // Anonymous sign-in isn't enabled in the Firebase console, or the
  // Storage/Firestore services weren't set up. Without this, a failed
  // sign-in would leave every DeltaStore call ("await ready") frozen
  // with no visible error.
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for Firebase to initialize. Check that Anonymous sign-in is enabled in Firebase Console → Authentication → Sign-in method, and that Firestore/Storage have been set up.'));
    }, 10000);

    auth.onAuthStateChanged(async (user) => {
      if (user) {
        uid = user.uid;
        try {
          await Promise.all([_loadSavedCache(), _seedIfEmpty()]);
        } catch (e) {
          console.error('DeltaStore init error:', e);
          clearTimeout(timeout);
          reject(e);
          return;
        }
        clearTimeout(timeout);
        resolve();
      } else {
        auth.signInAnonymously().catch(err => {
          console.error('DeltaStore anon auth failed:', err);
          clearTimeout(timeout);
          reject(new Error(`Anonymous sign-in failed (${err.code || 'unknown error'}). Enable Anonymous sign-in in Firebase Console → Authentication → Sign-in method.`));
        });
      }
    }, err => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // Surface any init failure in the console immediately, even before
  // any DeltaStore method is called, so it's not silent.
  ready.catch(err => console.error('DeltaStore failed to initialize:', err));

  const SEEDED_FLAG = 'delta_seeded_v1';

  async function _seedIfEmpty() {
    // Once we know listings exist, remember it locally so every future
    // page load skips this extra read instead of re-checking Firestore
    // every single time.
    if (localStorage.getItem(SEEDED_FLAG) === '1') return;

    const snap = await db.collection(LISTINGS).limit(1).get();
    if (snap.empty) {
      const batch = db.batch();
      SEED_LISTINGS.forEach((l, i) => {
        const ref = db.collection(LISTINGS).doc('seed-' + (i + 1));
        batch.set(ref, l);
      });
      await batch.commit();
    }
    localStorage.setItem(SEEDED_FLAG, '1');
  }

  async function _loadSavedCache() {
    const doc = await db.collection(SAVED).doc(uid).get();
    savedCache = doc.exists ? (doc.data().ids || []) : [];
  }

  async function getAll() {
    await ready;
    const snap = await db.collection(LISTINGS).orderBy('createdAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function getById(id) {
    await ready;
    if (!id) return null;
    const doc = await db.collection(LISTINGS).doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  }

  // Generates an id up front so photo uploads can be stored under a
  // path that matches the listing before the Firestore doc exists.
  function newId() {
    return 'l-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  }

  // Uploads real image files to Cloudinary (free tier, no Firebase
  // Blaze plan required) and returns their public URLs, in order.
  //
  // Reads CLOUDINARY_CLOUD_NAME / CLOUDINARY_UPLOAD_PRESET from
  // cloudinaryconfig.js (must be loaded before data.js).
  //
  // onProgress(doneCount, totalCount, pctOfCurrentFile) is called as
  // each file uploads, so the UI can show real progress instead of a
  // static "(0/N)" that never moves.
  //
  // Each file gets a 20s stall timeout: if Cloudinary never responds
  // (bad cloud name, wrong/non-existent preset, preset not set to
  // "Unsigned", network issue) the upload used to hang forever with
  // no error. Now it fails loudly instead, so the Publish button can
  // recover and show why.
  async function uploadPhotos(id, files, onProgress) {
    await ready;
    if (typeof CLOUDINARY_CLOUD_NAME === 'undefined' || typeof CLOUDINARY_UPLOAD_PRESET === 'undefined') {
      throw new Error('Cloudinary is not configured — check that cloudinaryconfig.js is loaded before data.js and has your cloud name + upload preset filled in.');
    }
    const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
    const urls = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const url = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const STALL_MS = 20000;
          let lastActivity = Date.now();

          const stallCheck = setInterval(() => {
            if (Date.now() - lastActivity > STALL_MS) {
              clearInterval(stallCheck);
              xhr.abort();
              reject(new Error(
                `Upload of "${file.name}" stalled for ${STALL_MS / 1000}s with no response from Cloudinary. ` +
                `Check: CLOUDINARY_CLOUD_NAME is correct, CLOUDINARY_UPLOAD_PRESET exists and is set to "Unsigned" ` +
                `(Cloudinary Console -> Settings -> Upload -> Upload presets), and you're online.`
              ));
            }
          }, 2000);

          xhr.open('POST', endpoint);

          xhr.upload.onprogress = evt => {
            lastActivity = Date.now();
            if (evt.lengthComputable && onProgress) {
              const pct = Math.round((evt.loaded / evt.total) * 100);
              onProgress(i, files.length, pct);
            }
          };

          xhr.onload = () => {
            clearInterval(stallCheck);
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const data = JSON.parse(xhr.responseText);
                if (onProgress) onProgress(i + 1, files.length, 100);
                resolve(data.secure_url);
              } catch (e) {
                reject(new Error('Cloudinary returned an unexpected response: ' + xhr.responseText.slice(0, 200)));
              }
            } else {
              let msg = `Cloudinary upload failed (HTTP ${xhr.status}).`;
              try {
                const errData = JSON.parse(xhr.responseText);
                if (errData.error && errData.error.message) msg += ' ' + errData.error.message;
              } catch (e) { /* ignore parse failure, use generic message */ }
              reject(new Error(msg));
            }
          };

          xhr.onerror = () => {
            clearInterval(stallCheck);
            reject(new Error(`Network error uploading "${file.name}" to Cloudinary. Check your connection and that the cloud name is correct.`));
          };

          const formData = new FormData();
          formData.append('file', file);
          formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
          formData.append('folder', `listings/${id}`);
          xhr.send(formData);
        });

        urls.push(url);
      } catch (err) {
        console.error(`DeltaStore: photo ${i + 1} ("${file.name}") failed to upload —`, err.message || err);
        throw err; // let the caller decide how to surface this to the user
      }
    }
    return urls;
  }

  async function add(listing) {
    await ready;
    const id = listing.id || newId();
    const { id: _drop, ...rest } = listing;
    const newListing = Object.assign({
      createdAt: Date.now(),
      sellerName: 'You',
      sellerMeta: 'New seller · 1 listing',
      photo: listing.category === 'cat' ? '🐱' : listing.category === 'dog' ? '🐶' : '🐾',
      photos: []
    }, rest, {
      // Always the real poster's anonymous uid — never trust a
      // client-supplied value for this. Listings created before this
      // field existed won't have it, so chat treats those as
      // "not available yet" rather than guessing a seller.
      sellerId: uid
    });
    await db.collection(LISTINGS).doc(id).set(newListing);
    return Object.assign({ id }, newListing);
  }

  /* ---------------- CHAT ----------------
     One chat doc per (listing, buyer) pair — id: "<listingId>__<buyerUid>".
     Messages live in a subcollection under that doc. Both the buyer and
     the seller (matched by uid) can read/write it. Since accounts here
     are anonymous-per-browser, a seller only sees incoming messages when
     they're viewing this browser/device — there's no cross-device inbox
     without a real login step, which this app doesn't have yet. */
  const CHATS = 'chats';

  function _chatId(listingId, buyerId) {
    return `${listingId}__${buyerId}`;
  }

  // Returns the current anonymous user's id, once known.
  async function getCurrentUid() {
    await ready;
    return uid;
  }

  // Creates (or reuses) the chat thread for this listing between the
  // current user (as buyer) and the listing's seller. Throws a
  // user-friendly error if the listing has no seller on file (posted
  // before chat existed) or if you're trying to message your own listing.
  async function getOrCreateChat(listingId, sellerId, petName, sellerName) {
    await ready;
    if (!listingId) throw new Error('Missing listing id.');
    if (!sellerId) throw new Error("This listing doesn't have a seller on file yet, so chat isn't available for it.");
    if (sellerId === uid) throw new Error("This is your own listing — you can't chat with yourself.");
    const id = _chatId(listingId, uid);
    const ref = db.collection(CHATS).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        listingId,
        petName: petName || '',
        buyerId: uid,
        sellerId,
        sellerName: sellerName || '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastMessage: '',
        lastSenderId: ''
      });
    }
    return id;
  }

  // Real-time subscription to every chat thread the current user is
  // part of, as either buyer or seller. Firestore can't OR two
  // different-field queries in one call, so this runs both and merges
  // client-side. This is what powers the inbox — without it, sellers
  // had messages sitting in Firestore with no page to ever see them.
  function onMyChats(callback) {
    let unsubBuyer = () => {};
    let unsubSeller = () => {};
    let buyerChats = [];
    let sellerChats = [];
    let buyerReady = false;
    let sellerReady = false;

    function emit() {
      if (!buyerReady || !sellerReady) return;
      const map = new Map();
      buyerChats.forEach(c => map.set(c.id, { ...c, role: 'buyer' }));
      sellerChats.forEach(c => map.set(c.id, { ...c, role: 'seller' }));
      const merged = Array.from(map.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      callback(merged);
    }

    ready.then(() => {
      unsubBuyer = db.collection(CHATS).where('buyerId', '==', uid)
        .onSnapshot(snap => {
          buyerChats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          buyerReady = true;
          emit();
        }, err => console.error('DeltaStore onMyChats (buyer) error:', err));

      unsubSeller = db.collection(CHATS).where('sellerId', '==', uid)
        .onSnapshot(snap => {
          sellerChats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          sellerReady = true;
          emit();
        }, err => console.error('DeltaStore onMyChats (seller) error:', err));
    });

    return () => { unsubBuyer(); unsubSeller(); };
  }

  async function sendMessage(chatId, text) {
    await ready;
    const clean = (text || '').trim();
    if (!clean) return;
    const chatRef = db.collection(CHATS).doc(chatId);
    await chatRef.collection('messages').add({
      senderId: uid,
      text: clean,
      createdAt: Date.now()
    });
    await chatRef.set({ updatedAt: Date.now(), lastMessage: clean, lastSenderId: uid }, { merge: true });
  }

  // Real-time subscription to a chat's messages, oldest first.
  // Returns an unsubscribe function.
  function onChatMessages(chatId, callback) {
    let unsub = () => {};
    ready.then(() => {
      unsub = db.collection(CHATS).doc(chatId).collection('messages')
        .orderBy('createdAt', 'asc')
        .onSnapshot(snap => {
          callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }, err => console.error('DeltaStore chat subscription error:', err));
    });
    return () => unsub();
  }

  async function getSaved() {
    await ready;
    return savedCache.slice();
  }

  async function isSaved(id) {
    await ready;
    return savedCache.includes(id);
  }

  async function toggleSaved(id) {
    await ready;
    const nowSaved = !savedCache.includes(id);
    savedCache = nowSaved ? [...savedCache, id] : savedCache.filter(x => x !== id);
    await db.collection(SAVED).doc(uid).set({ ids: savedCache });
    return nowSaved;
  }

  // Real-time subscription: callback fires immediately with the
  // current listings, then again whenever ANY device adds a pet.
  // Returns an unsubscribe function.
  function onListingsChange(callback) {
    let unsub = () => {};
    ready.then(() => {
      unsub = db.collection(LISTINGS).orderBy('createdAt', 'desc')
        .onSnapshot(snap => {
          callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }, err => console.error('DeltaStore listings subscription error:', err));
    });
    return () => unsub();
  }

  return {
    ready, getAll, getById, add, getSaved, isSaved, toggleSaved, onListingsChange, newId, uploadPhotos,
    getCurrentUid, getOrCreateChat, sendMessage, onChatMessages, onMyChats
  };
})();