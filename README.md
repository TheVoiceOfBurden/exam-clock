# exam-clock

An exam supervision clock for the projector, with plane-style toilet availability signs that bathroom-duty staff control from their phones.

- **Display** (`index.html`): big clock, reading and writing times, an end-of-exam warning, and Male/Female signs (VACANT / OCCUPIED / CLOSED).
- **Phone remote** (`remote.html`): staff scan a QR code from the display's setup screen and tap to mark a student out or back.
- **Final 15 minutes:** both toilets show CLOSED. The database itself refuses "out" taps after that point, and "back" taps still work.
- **Log:** every out and back is logged on the display laptop (press **L**). No student names are stored anywhere.

Live site: `https://thevoiceofburden.github.io/exam-clock/`

---

## Using it

| Key | Action |
| --- | --- |
| `M` or `1` | Toggle male sign |
| `F` or `2` | Toggle female sign |
| `R` | Reset both to vacant |
| `S` | Exam setup (title, times, warning, light mode, phone remote) |
| `L` | Toilet break log (copyable) |

**Starting the phone remote:** press **S** → **Start phone remote**. Staff scan the QR code. Keep the setup screen off the projector while you do this. Press **End remote** after the exam, and start a new one for each exam.

A wireless clicker or macro keypad that sends `1`/`2` or `M`/`F` works too, with no setup.

---

## One-time setup (about 20 minutes)

### 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> → **Add project** (Google Analytics can be off).
2. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable**.
3. **Build → Realtime Database → Create database**.
   - Location: **Singapore (asia-southeast1)**, the closest region to Australia.
   - Start in **locked mode**.
4. Open the database's **Rules** tab, replace everything with the contents of [`database.rules.json`](database.rules.json), and press **Publish**.

### 2. Connect the site to Firebase
1. **Project settings (gear) → General → Your apps → Web (`</>`)** → register an app (no Hosting needed).
2. Copy the values into [`js/firebase-config.js`](js/firebase-config.js). If `databaseURL` is missing from the snippet, copy it from the top of the Realtime Database page.
3. Commit and push.

These values are designed to be public. The database rules are what protect the data, so never commit service-account keys or anything from the **Service accounts** tab.

### 3. Turn on GitHub Pages
**Settings → Pages → Deploy from a branch → `main` / `(root)` → Save.**

### 4. Check the school network
Open `https://thevoiceofburden.github.io/exam-clock/check.html` on a school laptop **and** a staff phone. All three lines should be green. If the database line is red, ask IT to allow `*.firebaseio.com`, `*.firebasedatabase.app`, `www.gstatic.com` and `identitytoolkit.googleapis.com`.

---

## How the security works

- Every browser signs in to Firebase anonymously, so no accounts are needed.
- Each remote session has a long random room id, shown only on the display's setup screen. Rooms can't be listed or searched for.
- Only the display that created a room can change its title and times, or delete it.
- Phones can only set the two on/off values, and the server refuses "out" after the closing time. Firebase's own clock enforces this, so a phone with the wrong time can't get around it.

## Files

```
index.html             Display (projector)
remote.html            Phone remote
check.html             Network check
js/firebase-config.js  Your Firebase project config
js/firebase.js         Shared Firebase loader
js/display-remote.js   Display ↔ database sync
js/remote.js           Phone remote logic
js/vendor/qrcode.js    QR code generator (MIT, Kazuhiko Arase)
database.rules.json    Realtime Database security rules
```
