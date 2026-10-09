# Sync onboarding and the "Sync between browsers" section — design

Status: revised after review (Codex, Gemini, Sonnet), 2026-10-09. Owner
decisions still open are listed in §14.
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
crypto, the merge or the merge's write order; deleting the stale copy browser
sync keeps after a switch to local (storage-move §10.1 stays as decided).

## 2. Text rules

These apply to every user-visible string touched by this work.

- **Understandable before short.** No units or jargon a lay user cannot read
  ("8 KB" becomes "only room for a few custom search engines and menus"). Say
  what it means for the user.
- One or two short sentences per place. Consequence first, reason second.
- Never promise a way back that does not exist (see the lock text, §7).
- Every claim must hold against the code and the contract (review found three
  that did not; see §14).
- **"Profil" / "Profile" replaces "Stand" / "Stände"** in every user-visible
  string of the sync feature, in en ("profile") and de. Code, message keys and
  the contract keep `state`. README, README.de and PRIVACY follow. Where a
  sentence could be read as the browser's own profiles, say "Gestura-Profil".
- Owner-approved wordings not listed in §11 (turn-off dialog, the new-code
  confirmation) change only by the Stand→Profil replacement.

## 3. The section: one choice with three options

The section "Abgleich zwischen Browsern" opens with **three cards**. The three
valid storage states map one-to-one onto them:

| Card | `GesturaSettingsStorage.area()` | `euSync.enabled` |
|---|---|---|
| Über deinen Browser | `sync` | false |
| Nur in diesem Browser | `local` | false |
| Über gestura.eu | `local` | true |

**The mapping is total.** It reads `euSync.enabled`, never `syncEnabled()` — a
stale consent still shows "Über gestura.eu" (with the reconfirm step, §6). The
fourth combination, `(sync, enabled:true)`, can arise from a race across two
options tabs or a half-finished switch (§6). It shows "Über gestura.eu" with a
repair line "Die Umstellung ist nicht abgeschlossen. – **Erneut versuchen**",
which runs the switch to local. Nothing else is offered in that state.

**Interaction (accessibility).** The cards are **not** an auto-selecting radio
group: arrow keys must not trigger dialogs or storage switches. Each card is one
button (`aria-pressed` on the active one), activated with Enter/Space or a click;
Tab moves between them. The active card cannot be activated again.

Below the choice:

- **Status row** (moved from "Datenverwaltung"): "Gespeichert um 15:58 ·
  Abgleich über gestura.eu" — the saved time it shows today plus the active way.
- The "another browser switched browser sync off" note (`storageMovedNote`)
  moves here. Its button follows `movedTo`: `'local'` switches to local;
  `'gestura.eu'` opens the wizard with Way B preselected (the user most likely
  has the other browser's code). The note shows only while `area === 'sync'`.
- With "Über gestura.eu" active: the tabs "Deine Profile | Einstellungen".

"Datenverwaltung" keeps storage usage and Export / Import / Reset. The
browser-sync switch and the status row leave it.

**Architecture.** Switching the storage area lives in `options-page.js` today
(`#switchArea`, `#confirmWayBack`, the refusal texts). It moves into a module
`js/components/storage-area-switch.js` with no component state: it returns
`{ landed, refusal }` and judges by `area()` after the call, never by `ok`
alone (a failed `toLocal()` can land either way). `options-page.js` keeps what
belongs to it (`_storageFailure`, the storage rows) and calls the module. The
choice is rendered by the sync panel, which owns the gestura.eu state, the
turn-off dialog and the wizard entry.

A **non-mutating fit check** joins `settings-storage.js`: whether the current
settings fit browser sync (`usage()` against `QUOTA.sync`, per item and total),
answering with the same branch/total numbers `toSync()` refuses with.

## 4. Transitions

Exactly one dialog per change:

| From → to | What happens |
|---|---|
| Browser → Nur hier | Switched at once, no dialog — nothing is lost. |
| Nur hier → Browser | Fit check first; too large → refusal with numbers at the card, no dialog. Fits → the existing confirmation ("replaces what browser sync holds"). |
| Browser / Nur hier → gestura.eu | Reachability check (§5), then the wizard (§6). |
| gestura.eu → Nur hier | Today's turn-off dialog (Just turn off / Delete everything). |
| gestura.eu → Browser | **Fit check first**; too large → refusal at the card, gestura.eu stays on. Fits → the turn-off dialog with the browser-sync sentence (§11) folded in — no second confirmation. Then turn off (or delete everything), then `toSync()`. |

## 5. Reachability: `GET /api/v1/sync/ping`

Agreed with the index on 2026-10-09 (logbook; instruction file
`2026-10-09-instruktion-sync-ping.md` with its addendum). The contract gets the
text once the ping is live.

- No body, no locator, no `apiLevel`, **no `Content-Type` header** (a simple
  request). CORS gains `GET` in `Access-Control-Allow-Methods` — Firefox sends a
  preflight from the extension page until host access is granted.
- `200 { status: "ok", features: [...] }` when the service including its
  database works; `503 { error: "unavailable" }` otherwise.
- Maintenance: ping **and every `/sync/*` endpoint** answer
  `503 { error: "maintenance", until?: <ISO-8601> }`, with `Retry-After`. No
  free text. `OPTIONS` stays `204` during maintenance.
- The ping has its own per-IP limit (60 per hour); over it, `429`.

**Client classification:**

| Answer | Meaning |
|---|---|
| `200`, valid JSON, `status === "ok"` | reachable |
| `503` + `error: "maintenance"` | maintenance (with `until`, see §8) |
| `429` | rate limited (existing text) |
| anything else: other 5xx, `404`, `403`, HTML, timeout, network | unreachable |

`request()` in `js/eu-sync.js` gains: `503` in its status map, and a defensive
body read for `503` (as it does for `412`) yielding `maintenance` and a
validated `until` — parsed as a date, otherwise ignored. The contract's "the
client reads a body for exactly one code" becomes two.

When the ping runs: **once** when the user activates "Über gestura.eu", and on
Refresh. Never in the background, never in a loop. With sync on, the list
request is the check — no extra ping when the page opens.

On failure the choice stays on the previous card; the message (§11) shows
under the cards with "Erneut versuchen", and activating the gestura.eu card
again pings again.

Until the ping is live, development runs against the local mock
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
   Copy and "Als Datei sichern", the save hint (§11); below, a name field (empty,
   placeholder "z. B. Büro") and "Erstes Profil hochladen". The code is
   generated once per wizard session: Back and forward again shows the same
   code. Whether uploading requires the code to be saved first: §14.
4. **Way B (existing code)** — the code field with today's strict validation and
   "Code übernehmen". At least one **readable** profile (`!broken`) → done. None
   → "Unter diesem Code ist noch nichts gespeichert…" and the name field of Way
   A, under the entered code.

Every step has Back and Cancel; Escape and × cancel. Errors are announced
(`role="alert"`), "Verbinde mit gestura.eu …" is a `role="status"` region.

**The preview.** The upload in Way A goes through the usual
`settings-preview-dialog`. The wizard hosts it: while the preview is open the
wizard's own panel is hidden (one modal at a time, one scroll lock, one
Escape handler); confirming uploads and returns to the wizard, cancelling
returns to step 3.

**Done** means: Way A — the first profile is uploaded; Way B — a code with at
least one readable profile is loaded. Activating a profile is not required:
the user may first want to save their current settings as a new profile.

**Nothing is stored before done.** Code and consent live in the wizard.

**The wizard's gate.** The calls in between (`listStates`, `uploadState`) do
not go through `gated()` — it knows of no sync yet. Instead:

- Every request carries a **generation token** of the wizard attempt; an answer
  whose token is no longer current (cancelled, restarted, closed) is dropped.
- The origin comes from `GesturaSyncLocal.syncOrigin(await
  GesturaEuLocal.read())`, as `gated()` does.
- The wizard records `euSync` and `area()` when it opens. Before finishing it
  re-reads both; if `euSync.enabled` became true or the secret changed (another
  tab finished or changed something), it stops with "Der Abgleich wurde
  inzwischen in einem anderen Tab eingerichtet." and stores nothing.

**Way A upload.** The `stateId` is generated once when step 3 opens and reused
by every retry: a `PUT` without `basePayloadHash` replaces, so a retry after a
timeout that did reach the server does not create a second profile.

**Finishing, in this order:**

1. Re-read and compare (gate above).
2. Write `euSync` in **one** `GesturaSyncLocal.write`: `enabled: true`, consent
   with date, secret, and for Way A the profile record (`name`,
   `lastUploadHash = hashOf(exportObj)`, `lastUploadDate`) plus `activeState`.
   Written first because it is the commit point and because `toSync()` refuses
   from then on — the race of §3 cannot start a switch back to browser sync.
3. Switch storage to local if `area() === 'sync'`, judged by `area()` after
   the call.
4. Way A: write the base for the uploaded `stateId` under the `payloadHash`
   the upload returned. A failed base write is harmless (it means "no base";
   Sync becomes available after the next activate).

**Failures:**

- Upload or list fails → wizard stays open with the message and "Erneut
  versuchen"; nothing stored.
- Step 2 (`euSync` write) fails → nothing stored locally; the wizard stays open
  with "Erneut versuchen".
- Step 3 (area switch) fails → `euSync` is rolled back to what was read when
  the wizard opened, and the wizard stays open with "Erneut versuchen". If the
  rollback fails too, the state is `(sync, enabled:true)` and §3's repair line
  takes over.
- **Cancel after a successful upload** (Way A, before done): the wizard deletes
  the profile it uploaded (`deleteStates` with its `stateId`, best effort) so
  "nothing is left behind" holds for gestura.eu too. If that delete fails, the
  profile remains under a code nobody stored and expires under the 12-month
  retention.

**Where it lands.** Both ways land on "Deine Profile". After Way B the tab shows
the hint "Wähle ein Profil aus, um es zu aktivieren – oder sichere deine
aktuellen Einstellungen vorab als neues Profil."

**Re-enabling with a kept code, and stale consent.** A code kept by "Nur
ausschalten" (or a stale consent) shows step 1 with the kept code named
("Gespeicherter Code: GS1-XXXX-…-XXXX", masked) and two buttons: "Mit diesem
Code fortfahren" (done) and "Anderen Code verwenden" (→ step 2). Done here
runs the same finishing order: write `enabled` + consent, then switch storage
to local if `area() === 'sync'`.

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
4. **Card "Alles unter diesem Code löschen"** — always present, last, in the
   danger style. Its description says it deletes on gestura.eu for every
   browser using this code, and that turning sync off is the choice at the top.
   The button is active while profiles are known or the list is unknown (a
   request while unreachable fails cleanly); with a known 0 the card says
   "Unter diesem Code ist nichts gespeichert".

## 8. Errors

- **List could not be read.** In place of the list a box stays until a list has
  been read: "Deine Profile konnten nicht geladen werden. An deinen Einstellungen
  hier ändert das nichts." with "Erneut versuchen". Uploading stays possible.
- **Maintenance.** A `503 maintenance` from any endpoint reads "gestura.eu wird
  gewartet (voraussichtlich bis 14:00 Uhr)." `until` on a later day adds the
  date; `until` in the past or missing drops the time.
- **While a request runs** a `role="status"` line "Verbinde mit gestura.eu …"
  shows, so fifteen seconds of locked buttons do not look like a hang.
- **A 404 from `list` or `PUT /state`** (never legitimate per the contract)
  reads as "unreachable", not "profile not found".
- **In the wizard** every failure keeps it open with the message and "Erneut
  versuchen" (§6).

## 9. Storage warnings and the storage-full dialog

- The warning line under menus and search engines (`renderStorageLine`, ≥ 75 %
  and full) gets a link "Mehr Platz bekommen →" to the sync section — only while
  "Über deinen Browser" is active. The line is a shared pure function, so the
  link dispatches an event the options page turns into its existing section jump.
- The storage-full dialog's way "Auf gestura.eu-Sync umsteigen" opens the
  wizard (with the reachability check) instead of switching storage itself; its
  description loses the wrong sentence about the integration. If gestura.eu is
  unreachable, the dialog says so and points to "Browser-Sync ausschalten". As
  today, the change that failed to save is not retried; the dialog's existing
  "Gespeichert ist noch nichts" says so. `_storageFailure` is cleared when the
  wizard opens.

## 10. Version, contract and storage

- `CURRENT_SYNC_CONSENT` goes from 1 to 2: the consent text changes in
  substance. The contract's sync-consent table gets a row for version 2 in the
  same change, stating that re-consent keeps the stored code, the profile map
  and `activeState`. Only the owner has consented so far; nothing is released.
- The contract gets the ping, the maintenance `503` on `/sync/*`, `GET` in
  CORS and the second body-read case (§5) once the ping is live.
- No new storage keys. "Onboarding in progress" is not a stored state — it is
  the wizard being open.

## 11. Texts (de; en written to match in the plan)

Marked **[§14]**: changed after review, needs the owner's confirmation.

**Cards**

- **Über deinen Browser** – Automatische Synchronisation, aber nicht
  browserübergreifend (z. B. nur Chrome zu Chrome) und nicht in jedem Browser
  (Brave z. B. gar nicht). Bietet wenig Platz – nur für wenige eigene
  Suchmaschinen und Menüs.
- **Nur in diesem Browser** **[§14]** – Reichlich Platz und 100 % lokal: Dieser
  Browser überträgt deine Einstellungen nicht mehr – außer du exportierst sie
  selbst. Ein Abgleich mit anderen Browsern läuft manuell per Datei-Ex- und
  -Import.
- **Über gestura.eu** – Ebenso reichlich Platz, Ende-zu-Ende-verschlüsselt und
  deutlich komfortabler als der Ex-/Import: Übertrage deine Einstellungen
  browserübergreifend zwischen Chrome, Firefox, Brave & Co. Bis zu 5 Profile
  (Büro, Laptop, Privat …), komplett ohne Konto.

**Messages**

| Place | Text |
|---|---|
| Status row | Gespeichert um {time} · Abgleich über gestura.eu (resp. „über deinen Browser“ / „nur in diesem Browser“) |
| Check running | Verbinde mit gestura.eu … |
| Unreachable | gestura.eu ist derzeit nicht erreichbar. Bitte versuche es später noch einmal. – **Erneut versuchen** |
| Maintenance | gestura.eu wird gewartet (voraussichtlich bis {time} Uhr). — later day: „bis {date}, {time} Uhr“; no/past `until`: gestura.eu wird gewartet. |
| Repair (§3) | Die Umstellung ist nicht abgeschlossen. – **Erneut versuchen** |
| Other tab (§6) | Der Abgleich wurde inzwischen in einem anderen Tab eingerichtet. |
| Wizard, browser-sync box | Dein Browser-Sync ist aktiv. gestura.eu löst ihn ab – deine Einstellungen werden danach nicht mehr über das Browser-Konto abgeglichen. |
| Wizard, choice | **Ich habe noch keinen Code** – neuen Abgleich-Code erstellen · **Ich habe bereits einen Code** – Profile aus einem anderen Browser laden |
| Wizard, kept code | Gespeicherter Code: {masked} – **Mit diesem Code fortfahren** · **Anderen Code verwenden** |
| Way A | Sichere diesen Code (z. B. im Passwortmanager). Nur mit ihm hast du in anderen Browsern Zugriff auf deine Profile. |
| Way A, name placeholder | z. B. Büro |
| Way B, empty | Unter diesem Code ist noch nichts gespeichert. Lade hier dein erstes Profil hoch. |
| After Way B | Wähle ein Profil aus, um es zu aktivieren – oder sichere deine aktuellen Einstellungen vorab als neues Profil. |
| Change code, 0 profiles | Nutzt du gestura.eu bereits? Gib deinen Code aus dem anderen Browser ein, um dessen Profile hier zu laden. |
| Lock | Ein Wechsel entfernt **hier** deine {n} Profile, deine aktuellen Einstellungen bleiben erhalten. Sichere den aktuellen Code vorher. – **Code trotzdem wechseln** (one profile: „… entfernt **hier** dein Profil …“) |
| New code (field) | Startet ohne Profile. Deine bisherigen erreichst du weiter mit dem alten Code. |
| Delete all, description | Löscht deine Profile auf gestura.eu – auch für deine anderen Browser mit diesem Code. Zum Ausschalten wähle oben einen anderen Weg. |
| Delete all, empty | Unter diesem Code ist nichts gespeichert. |
| List failed | Deine Profile konnten nicht geladen werden. An deinen Einstellungen hier ändert das nichts. – **Erneut versuchen** |
| Storage warning link | Mehr Platz bekommen → |
| gestura.eu → Browser (in the turn-off dialog) | Danach überträgt wieder dein Browser – mit den Einstellungen aus diesem Browser. |

**Consent (step 1)** — **[§14]** for bullets 2 and 4

> **Übertrage deine Gestura-Einstellungen flexibel in andere Browser –
> Ende-zu-Ende-verschlüsselt, ohne Konto und ohne Passwort.**
>
> - **Kein heimlicher Abgleich:** Du bestimmst den Zeitpunkt. Einstellungen
>   werden nur gespeichert oder geladen, wenn du es selbst auslöst.
> - **Echte Ende-zu-Ende-Verschlüsselung:** Die Verschlüsselung passiert direkt
>   in deinem Browser. gestura.eu erhält deine Einstellungen nur verschlüsselt –
>   selbst die Namen deiner Profile sind geschützt. Dein Code wird nie an
>   gestura.eu gesendet.
> - **Volle Kontrolle vor jeder Änderung:** Gestura zeigt dir bei jeder
>   Übertragung eine Vorschau, was sich an deinen Einstellungen ändert.
> - **Dein Code ist der einzige Schlüssel:** Nur wer deinen Code hat, kann deine
>   Profile lesen – und mit ihm auch ändern und löschen. Bewahre ihn gut auf –
>   ohne ihn gibt es keine Wiederherstellung. *({retention})*
> - **Ersetzt den Browser-Sync:** Gestura verwaltet deine Einstellungen ab jetzt
>   lokal und über gestura.eu statt über das Sync-Konto deines Browsers. Du
>   kannst das jederzeit oben wieder umstellen.

`{retention}` waits for the index's answer whether a list counts as a read: if
yes, „Profile, die 12 Monate lang niemand nutzt, werden gelöscht.“; if no,
„Profile, die 12 Monate lang weder geladen noch geändert werden, werden
gelöscht.“

## 12. Testing

- **Unit (vitest):** the total mapping of (area, enabled) to cards including
  `(sync, true)`; the transition table with the fit check; the ping
  classification (200 ok / 200 HTML / 503 maintenance with valid, past, later-day
  and garbage `until` / 503 other / 404 / 403 / 429 / timeout); the wizard's
  finishing order with injected steps (as `commitOrder` does for the merge):
  each failure point and its rollback, nothing written on upload or list
  failure, the generation token dropping a stale answer, the other-tab abort,
  the reused `stateId` on retry, the delete on cancel after upload; the
  non-mutating fit check against `toSync()`'s refusals; singular/plural of the
  lock text; `PENDING_TRANSLATION` for every new key.
- **Browser (test Edge + mock):** each transition of §4, including "does not
  fit" for both ways into browser sync; keyboard through the cards without side
  effects; both wizard ways including cancel at every step (sync stays off, area
  unchanged, an uploaded profile deleted); Way B with 0, with only broken and
  with ≥ 1 profiles; re-enable with a kept code (continue / other code); two
  options tabs finishing the wizard; unreachable, maintenance and 429 at the
  start; list failure box; storage-warning link; storage-full dialog path;
  `storageMovedNote` with both `movedTo` values; light and dark screenshots.

## 13. Documentation

README, README.de and PRIVACY: "Profil", the three ways, the wizard, and that
a switch to local leaves the copy already in the browser's own sync where it
is. CLAUDE.md's gestura.eu paragraph: the section owns the storage-area choice.
The contract: §10.

## 14. Open owner decisions

1. **Card "Nur in diesem Browser".** The approved „Deine Einstellungen bleiben
   auf diesem Gerät“ is not true for someone coming from browser sync: the
   switch copies and never deletes, so the old copy stays in the browser
   account (storage-move §10.1 — deleting it would wipe the settings of other
   browsers still on browser sync). Proposed in §11: „Dieser Browser überträgt
   deine Einstellungen nicht mehr – außer du exportierst sie selbst.“
2. **Consent bullet 2.** „empfängt ausschließlich unlesbaren, verschlüsselten
   Text“ overclaims: gestura.eu also receives the locator, profile ids, sizes,
   times and the IP. And „Der Schlüssel wird nie gesendet“ next to „Dein Code ist
   der einzige Schlüssel“ uses one word for two things. Proposed: „erhält deine
   Einstellungen nur verschlüsselt … Dein Code wird nie an gestura.eu gesendet“
   (true: only a one-way derivation of it travels).
3. **Consent bullet 4.** „Nur wer deinen Code hat, kann … ändern und löschen“
   is not strictly true for the service itself. Proposed: „kann deine Profile
   lesen – und mit ihm auch ändern und löschen“.
4. **Retention wording**, bullet 4 — waits for the index (see §11).
5. **Way A: must the code be saved before uploading?** Gemini: enable "Erstes
   Profil hochladen" only after Copy, Save or a checkbox „Ich habe den Code
   gesichert“. The trade: one more step against users who reach the second
   browser without their code (they can still find it under Einstellungen).

Rejected review points, with reasons, are in the review log of the conversation
that produced this revision; the two that change behaviour are recorded here:

- *Way B must end by activating a profile* — rejected: the owner decided that
  loading the code is done, so a user can first save their current settings.
- *Overwrite on a non-active profile is dangerous* — real, but older than this
  work and independent of it. A follow-up ticket: the overwrite preview should
  show what changes in the profile being replaced.
