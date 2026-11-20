// Shared Firebase loader for the display, the phone remote and the network check.
import { firebaseConfig } from './firebase-config.js';

const V = '10.12.2';
const BASE = `https://www.gstatic.com/firebasejs/${V}`;

export const configured = !!(firebaseConfig.apiKey && firebaseConfig.databaseURL);

export async function connect() {
  if (!configured) throw new Error('Firebase is not configured (js/firebase-config.js).');
  const [appMod, authMod, dbMod] = await Promise.all([
    import(`${BASE}/firebase-app.js`),
    import(`${BASE}/firebase-auth.js`),
    import(`${BASE}/firebase-database.js`)
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  // Anonymous sign-in: no accounts, but every write carries a stable per-browser id.
  const cred = await authMod.signInAnonymously(auth);
  const db = dbMod.getDatabase(app);
  return { db, uid: cred.user.uid, ...dbMod };
}

// Room ids are the "key" to a remote session, so make them long and random.
export function newRoomId() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, b => a[b % a.length]).join('');
}

export const ROOM_RE = /^[a-z0-9]{8,32}$/;
