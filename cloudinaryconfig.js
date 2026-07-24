/* ============================================================
   cloudinaryconfig.js — free photo hosting for pet listings
   ============================================================
   Why: Firebase Storage now requires the project to be on the
   paid Blaze plan, even for free-tier usage. Cloudinary has a
   genuinely free tier (25GB storage / 25GB bandwidth per month)
   that doesn't ask for a card. Firestore + Auth stay on Firebase
   (still free on the Spark plan) — only photo uploads go here.

   SETUP (5 minutes, no credit card):
   1. Go to https://cloudinary.com/users/register/free and sign up.
   2. On your Cloudinary Dashboard, copy the "Cloud name" shown
      near the top → paste it into CLOUDINARY_CLOUD_NAME below.
   3. Left sidebar → Settings (gear icon) → Upload tab →
      scroll to "Upload presets" → click "Add upload preset".
   4. Set "Signing Mode" to UNSIGNED (this is required — it's what
      lets your website upload directly from the browser without a
      backend server or secret key). Save.
   5. Copy the preset's name → paste it into
      CLOUDINARY_UPLOAD_PRESET below.
   6. Save this file, drop it next to your other HTML files, and
      make sure it's loaded BEFORE data.js:

      <script src="firebaseconfig.js"></script>
      <script src="cloudinaryconfig.js"></script>
      <script src="data.js"></script>

   Note: an unsigned preset means anyone with your cloud name can
   upload files to your account (that's normal for this kind of
   client-only site — Cloudinary's free tier is generous enough
   that this is fine for a small marketplace). If you ever want
   tighter control, Cloudinary supports restricting presets by
   file type/size in the preset settings, or moving to signed
   uploads later with a small backend.
   ============================================================ */

const CLOUDINARY_CLOUD_NAME = 'yktregvl';
const CLOUDINARY_UPLOAD_PRESET = 'DELTAPAW';