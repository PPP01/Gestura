# Sync onboarding and the "Sync between browsers" section — design

Status: approved in conversation 2026-10-09, written for review.
Builds on: [2026-09-04-storage-move-design.md](2026-09-04-storage-move-design.md),
[2026-09-04-sync-reconciliation-design.md](2026-09-04-sync-reconciliation-design.md),
the contract [docs/gestura-eu-api.md](../../gestura-eu-api.md).

## 1. Why

A first-time user who reaches the sync section today reads "Einstellungen
abgleichen – Verschlüsselt, ohne Konto" and a switch. From that they learn
neither that there are three ways to get settings into another browser, nor
that the browser's own sync is the reason their custom search engines run out
of room. Whoever switches on gets a code and an empty list and has to work out
the rest.

Goals:

1. The section explains the three ways by **being** the choice between them.
2. Switching to gestura.eu is a **guided wizard** that ends with a usable
   setup, or leaves nothing behind.
3. gestura.eu not being reachable is said up front, not discovered mid-flow.
4. After onboarding, the Settings tab is tidy: code, changing the code,
   deleting everything — each in its own card.
5. Users see **"Profil"**, not "Stand".

Non-goals: translations (en and de only, as always before a release); the
design hand-off's sections 2b–2d (preview, conflict dialog); any change to the
crypto, the merge or the write order.

## 2. Text rules

These apply to every user-visible string touched by this work.

- **Understandable before short.** No units or jargon a lay user cannot read
  ("8 KB" becomes "only room for a few custom search engines and menus"). Say
  what it means for the user.
- One or two short sentences per place. Consequence first, reason second.
- Never promise a way back that does not exist (see the lock text, §7).
- **"Profil" / "Profile" replaces "Stand" / "Stände"** in every user-visible
  string of the sync feature, in en ("profile") and de. Code, message keys and
  the contract keep `state` — it is the right technical term there.
  README, README.de and PRIVACY follow.
- Owner-approved wordings that are not listed in §11 (turn-off dialog, the
  new-code confirmation) change only by the Stand→Profil replacement.

## 3. The section: one choice with three options

The section "Abgleich zwischen Browsern" opens with a **single choice of three
cards** (radio semantics, `role="radiogroup"`). The three valid storage states
map one-to-one onto them; the fourth combination (browser sync on *and*
gestura.eu on) cannot be expressed any more.

| Card | `GesturaSettingsStorage.area()` | `euSync.enabled` |
|---|---|---|
| Über deinen Browser | `sync` | false |
| Nur in diesem Browser | `local` | false |
| Über gestura.eu | `local` | true |

Below the choice:

- **Status row** (moved from "Datenverwaltung"): "Gespeichert um 15:58 ·
  Abgleich über gestura.eu" — the saved time it shows today plus the active way.
- The "another browser switched browser sync off" note (`storageMovedNote`)
  moves here too.
- With "Über gestura.eu" active: the tabs "Deine Profile | Einstellungen".

"Datenverwaltung" keeps storage usage and Export / Import / Reset. The
browser-sync switch and the status row leave it.

**Architecture.** Switching the storage area lives in `options-page.js` today
(`#switchArea`, `#confirmWayBack`, the refusal texts). It moves into a small
module `js/components/storage-area-switch.js` that both the sync section and the
storage-full dialog's handler use. The choice is rendered by the sync panel,
which already owns the gestura.eu state, the turn-off dialog and the wizard
entry.

## 4. Transitions

Exactly one dialog per change:

| From → to | What happens |
|---|---|
| Browser → Nur hier | Switched at once, no dialog — nothing is lost. |
| Nur hier → Browser | The existing confirmation ("replaces what browser sync holds"). Too large → the refusal with numbers, at the card. |
| Browser / Nur hier → gestura.eu | Reachability check (§5), then the wizard (§6). Storage switches only when the wizard finishes. |
| gestura.eu → Nur hier | Today's turn-off dialog (Just turn off / Delete everything). |
| gestura.eu → Browser | The same turn-off dialog plus one sentence (§11). After it: back to browser sync; if the settings do not fit, the user lands on "Nur hier" with the refusal. |

## 5. Reachability: `GET /api/v1/sync/ping`

New endpoint, announced to the index on 2026-10-09
(`gestura-index/exchange/2026-10-09-instruktion-sync-ping.md`); the contract text
is added to `docs/gestura-eu-api.md` once the index confirms.

- No body, no locator, no `apiLevel`. `200 { status: "ok", features: [...] }`
  when the sync service *including its database* works.
- Maintenance: ping **and every `/sync/*` endpoint** answer
  `503 { error: "maintenance", until?: <ISO-8601 UTC> }`. No server free text.
- Client reading: `200` → reachable; `503` + `maintenance` → maintenance (with
  the local time of `until` if present); any other 5xx, timeout, network error →
  unreachable; `404` (a service without ping) → reachable; `429` → rate limited.

When it runs: **once** when the user picks "Über gestura.eu", and on Refresh.
Never in the background, never in a loop. With sync on, the list request is the
check — no extra ping when the page opens.

Until the index deploys the ping, development runs against the local mock
(`browser-verify/sync-mock.mjs` gets the endpoint).

## 6. The wizard

A new component `js/components/sync-onboarding-dialog.js`. Today's consent
dialog becomes its first step.

**Steps.**

1. **Consent** — the text of §11, button "Weiter". If browser sync is on, a
   yellow box above it (§11).
2. **Choice** — two equal cards: "Ich habe noch keinen Code" / "Ich habe bereits
   einen Code".
3. **Way A (new code)** — the code in clear text (seeing it is the point here),
   Copy and "Als Datei sichern", the save hint (§11); below, a name field
   prefilled with the browser's name (Chrome, Edge, Firefox, …) and "Erstes
   Profil hochladen". The upload goes through the usual preview.
4. **Way B (existing code)** — the code field with today's strict validation and
   "Code übernehmen". At least one profile → done. None → "Unter diesem Code ist
   noch nichts gespeichert…" and the name field of Way A, under the entered code.

Every step has Back and Cancel; Escape and × cancel.

**Done** means: Way A — the first profile is uploaded; Way B — a code with at
least one profile is loaded. Activating a profile is *not* required: the user
may first want to save their current settings as a new profile.

**Nothing is stored before done.** Code and consent live in the wizard. The
network calls in between (list, upload) use the existing low-level functions
(`listStates`, `uploadState`) directly — the stored gate (`gated()`) knows of
no sync yet; its role is taken by an "is the wizard still open?" check after
every answer. Cancelling at any point leaves sync off and browser sync
untouched.

**Finishing, in this order:**

- A: upload succeeds → switch storage to local → write `euSync` (enabled,
  consent with date, secret, the profile record, active profile) and the base.
- B: list with ≥ 1 profile → switch storage to local → write `euSync`.
- If the storage switch fails, the wizard stays open with the message and "Erneut
  versuchen". An uploaded profile does no harm; the code is still on screen.
- If upload or list fail, the wizard stays open with the message and "Erneut
  versuchen"; nothing is stored.

**Where it lands.** Both ways land on "Deine Profile". After Way B the tab shows
the hint "Wähle ein Profil aus, um es zu aktivieren – oder sichere deine
aktuellen Einstellungen vorab als neues Profil."

**Re-enabling.** A code kept by "Nur ausschalten" means the wizard is step 1
only, then done — "everything is back", as the turn-off dialog promises. The
same for a stale consent ("needs your consent again").

## 7. After onboarding: the Settings tab

From top to bottom:

1. "Der Abgleich ist an · Zugestimmt am …" (as now).
2. **Card "Dein Abgleich-Code"** (as now: masked, show, copy, save).
3. **Card "Code wechseln"**
   - 0 profiles: the sentence of §11 and the load field, unlocked.
   - > 0 profiles, or the list could not be read: no sentence; the yellow lock
     with the count (§11). "Code trotzdem wechseln" opens **two fields**:
     *Code laden* (hint + input with strict validation) and *Neuer Code* (with
     its explanation). Cancel locks again; a tab switch, reload or code change
     locks again.
   - Before any change: the confirmation with the count (as now).
4. **Card "Alles unter diesem Code löschen"** — an equal card, always present.
   The button is active while profiles are known or the list is unknown; with a
   known 0 the card says "Unter diesem Code ist nichts gespeichert".

## 8. Errors

- **List could not be read.** In place of the list a box stays until a list has
  been read: "Deine Profile konnten nicht geladen werden. An deinen Einstellungen
  hier ändert das nichts." with "Erneut versuchen". Uploading stays possible.
- **Maintenance.** A `503 maintenance` from any endpoint reads "gestura.eu wird
  gewartet (voraussichtlich bis 14:00 Uhr)." instead of "not reachable".
- **While a request runs** a line "Verbinde mit gestura.eu …" shows, so fifteen
  seconds of locked buttons do not look like a hang.
- **In the wizard** every failure keeps it open with the message and "Erneut
  versuchen"; nothing is stored.

## 9. Storage warnings and the storage-full dialog

- The warning line under menus and search engines (`renderStorageLine`, ≥ 75 %
  and full) gets a link "Mehr Platz bekommen →" to the sync section — only while
  "Über deinen Browser" is active. The line is a shared pure function, so the
  link dispatches an event the options page turns into its existing section jump.
- The storage-full dialog's way "Auf gestura.eu-Sync umsteigen" opens the
  wizard (with the reachability check) instead of switching storage itself; its
  description loses the wrong sentence about the integration. If gestura.eu is
  unreachable, the dialog says so and points to "Browser-Sync ausschalten".

## 10. Version and storage

- `CURRENT_SYNC_CONSENT` goes from 1 to 2: the consent text changes in
  substance. Only the owner has consented so far; nothing is released.
- No new storage keys. "Onboarding in progress" is not a stored state — it is
  the wizard being open.

## 11. Texts (de, owner-approved; en written to match in the plan)

**Cards**

- **Über deinen Browser** – Automatische Synchronisation, aber nicht
  browserübergreifend (z. B. nur Chrome zu Chrome) und nicht in jedem Browser
  (Brave z. B. gar nicht). Bietet wenig Platz – nur für wenige eigene
  Suchmaschinen und Menüs.
- **Nur in diesem Browser** – Reichlich Platz und 100 % lokal: Deine
  Einstellungen bleiben auf diesem Gerät, außer du exportierst sie selbst. Ein
  Abgleich mit anderen Browsern läuft manuell per Datei-Ex- und -Import.
- **Über gestura.eu** – Ebenso reichlich Platz, Ende-zu-Ende-verschlüsselt und
  deutlich komfortabler als der Ex-/Import: Übertrage deine Einstellungen
  browserübergreifend zwischen Chrome, Firefox, Brave & Co. Bis zu 5 Profile
  (Büro, Laptop, Privat …), komplett ohne Konto.

**Messages**

| Place | Text |
|---|---|
| Status row | Gespeichert um {time} · Abgleich über gestura.eu (resp. „über deinen Browser“ / „nur in diesem Browser“) |
| Check running | Verbinde mit gestura.eu … |
| Unreachable | gestura.eu ist derzeit nicht erreichbar. Bitte versuche es später noch einmal. |
| Maintenance | gestura.eu wird gewartet (voraussichtlich bis {time} Uhr). — without `until`: gestura.eu wird gewartet. |
| Wizard, browser-sync box | Dein Browser-Sync ist aktiv. gestura.eu löst ihn ab – deine Einstellungen werden danach nicht mehr über das Browser-Konto abgeglichen. |
| Wizard, choice | **Ich habe noch keinen Code** – neuen Abgleich-Code erstellen · **Ich habe bereits einen Code** – Profile aus einem anderen Browser laden |
| Way A | Sichere diesen Code (z. B. im Passwortmanager). Nur mit ihm hast du in anderen Browsern Zugriff auf deine Profile. |
| Way B, empty | Unter diesem Code ist noch nichts gespeichert. Lade hier dein erstes Profil hoch. |
| After Way B | Wähle ein Profil aus, um es zu aktivieren – oder sichere deine aktuellen Einstellungen vorab als neues Profil. |
| Change code, 0 profiles | Nutzt du gestura.eu bereits? Gib deinen Code aus dem anderen Browser ein, um dessen Profile hier zu laden. |
| Lock | Ein Wechsel entfernt **hier** deine {n} Profile, deine aktuellen Einstellungen bleiben erhalten. Sichere den aktuellen Code vorher. – **Code trotzdem wechseln** (one profile: „… entfernt **hier** dein Profil …“) |
| New code (field) | Startet ohne Profile. Deine bisherigen erreichst du weiter mit dem alten Code. |
| Delete all, empty | Unter diesem Code ist nichts gespeichert. |
| List failed | Deine Profile konnten nicht geladen werden. An deinen Einstellungen hier ändert das nichts. – **Erneut versuchen** |
| Storage warning link | Mehr Platz bekommen → |
| gestura.eu → Browser | Danach überträgt wieder dein Browser – mit den Einstellungen aus diesem Browser. |

**Consent (step 1)**

> **Übertrage deine Gestura-Einstellungen flexibel in andere Browser –
> Ende-zu-Ende-verschlüsselt, ohne Konto und ohne Passwort.**
>
> - **Kein heimlicher Abgleich:** Du bestimmst den Zeitpunkt. Einstellungen
>   werden nur gespeichert oder geladen, wenn du es selbst auslöst.
> - **Echte Ende-zu-Ende-Verschlüsselung:** Die Verschlüsselung passiert direkt
>   in deinem Browser. gestura.eu empfängt ausschließlich unlesbaren,
>   verschlüsselten Text – selbst die Namen deiner Profile sind geschützt. Der
>   Schlüssel wird nie an gestura.eu gesendet.
> - **Volle Kontrolle vor jeder Änderung:** Gestura zeigt dir bei jeder
>   Übertragung eine Vorschau, was sich an deinen Einstellungen ändert.
> - **Dein Code ist der einzige Schlüssel:** Nur wer deinen Code hat, kann deine
>   Profile lesen, ändern und löschen. Bewahre ihn gut auf – ohne ihn gibt es
>   keine Wiederherstellung. *(Inaktive Profile werden nach 12 Monaten
>   gelöscht.)*
> - **Ersetzt den Browser-Sync:** Gestura verwaltet deine Einstellungen ab jetzt
>   lokal und über gestura.eu statt über das Sync-Konto deines Browsers. Du
>   kannst das jederzeit oben wieder umstellen.

## 12. Testing

- **Unit (vitest):** the mapping of (area, enabled) to the three cards and the
  transition table as a pure function; the ping answer classification
  (200/503-maintenance/503/404/429/timeout); the wizard's finish order with
  injected steps (as `commitOrder` does for the merge) — upload → area → write,
  and nothing written on any failure; singular/plural of the lock text;
  `PENDING_TRANSLATION` for every new key.
- **Browser (test Edge + mock):** each transition of §4; both wizard ways
  including cancel at every step (sync stays off, area unchanged); Way B with
  0 and with ≥ 1 profiles; unreachable and maintenance at the start; list
  failure box; storage-warning link; storage-full dialog path; light and dark
  screenshots of the section, the wizard steps and the Settings tab.

## 13. Documentation

README, README.de and PRIVACY: "Profil", the three ways, the wizard. CLAUDE.md's
gestura.eu paragraph: the section owns the storage-area choice. The contract gets
the ping and maintenance text after the index confirms.
