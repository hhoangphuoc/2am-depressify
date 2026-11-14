# Patients sign in with their own account

Until now the Patient app signed in anonymously on first open, and the Patient record's id was that anonymous uid. Patients now sign in with an account of their own: email and password, or Google. Sign-up is open, but an email and password account must verify its email before it can create a Patient record or start a Check-in; Google accounts arrive verified. The Clinician is told apart by a custom claim, `role: "clinician"`, which only the Admin sets, rather than by their email alone.

This replaces "the Patient signs in anonymously for the demo" in the [system design](../context/system-design.md#roles-and-sign-in), and in the v1 spec (issue #5): user story 1 ("open the app without creating an account"), "anonymous Patient sign-in" in the v1 scope, and "Patient accounts with Google sign-in" under Out of Scope. It also changes issue #7's "First open signs in anonymously and creates the Patient record" (the app now signs in first) and issue #8's demo shortcut, which now needs a verified account instead of any signed-in user. The Invite stays deferred.

## Why

- **Tracking each Patient.** An anonymous uid lives on one install. Reinstalling the app, clearing its data or changing phones creates a new, empty Patient, and the Clinician sees a stranger instead of their Patient's history. An account follows the person.
- **Abuse.** Anonymous sign-in costs nothing, and each anonymous user could create a Patient record and start Check-ins, which spend Gemini credit (Start Check-in mints a Live token, Finish Check-in calls the text model). Requiring a verified email, or a Google account, puts a real identity behind every record and every Check-in.
- **The Clinician's identity.** The rules matched the Clinician by sign-in email only, and did not check that the email was verified: anyone could register an unverified account under a Clinician's address and read that Clinician's Patients. With open sign-up for Patients that gap would be open to everyone. A custom claim that only the Admin sets closes it, and a Patient can never read as a Clinician, whatever email they sign up with.

## Options considered

1. **Keep anonymous sign-in.** No friction on a low-energy day, but no continuity across installs and no protection against Gemini spending. Rejected.
2. **Invite only.** The Clinician creates the account or gives a code (the Invite in [GLOSSARY.md](../../GLOSSARY.md)). Strongest link between Patient and Clinician, but it needs dashboard screens, an invite flow and email delivery we don't have in the demo. Still the long-term plan; this decision does not rule it out.
3. **Open sign-up with email verification, plus Google.** Chosen. It is built into Firebase Auth, keeps the uid as the Patient id, and works with the `clinicians` allowlist that already limits who a new Patient may link to.

## The checks

- **Rules** (`firebase/firestore.rules`): a verified account is one whose `sign_in_provider` is not `anonymous` and whose `email_verified` is true.
  - Creating a Patient record needs the owner's verified account (`patientId == auth.uid`, as before).
  - The demo shortcut (acting as a Patient marked `synthetic`) needs a verified account too, so an anonymous or unverified account reaches no data.
  - The Clinician needs a verified account with `role == "clinician"` and `token.email == patient.clinicianEmail`, while sharing is granted. A new Patient may still link only to a Clinician in the `clinicians` allowlist.
- **Functions:** `assertClinicianOf` (Intake, Digest) checks the same claim and verified email. `assertActsAsPatient` (Start and Finish Check-in) needs a verified account and answers an anonymous or unverified caller with `failed-precondition`, "Verify your account to continue."
- **Admin:** `npm run allow-clinician -- --email <email>` writes the allowlist entry, sets the claim on the Auth account with that email and marks the email verified. With open sign-up, anyone could register a Clinician's address before the Clinician does, so an account whose email is not yet verified is refused unless the Admin names it with `--uid` (the account they added in the console, which they vouch for). The Clinician picks up the claim at their next sign-in or token refresh.

## Transition

- A Patient record that already exists stays its owner's: the rules give the owner (`auth.uid == patientId`) the same access as before, whatever kind of account it is. Patients who signed in anonymously keep reading and writing their records, and their Clinician keeps seeing them while they share.
- Those Patients cannot start or finish a Check-in until they upgrade the account with `linkWithCredential` (email and password, then verify; or Google), which keeps the uid and so the record. A Check-in started anonymously before the change cannot be finished after it.
- The Anonymous provider stays enabled in the Firebase console until the app ships the new sign-in, then is disabled. Disabling it does not delete existing anonymous accounts.

## Consequences

- The app needs sign-up, sign-in, a "verify your email" step, Google sign-in and password reset before the first screen (client contract in the [README](../../README.md#patient-sign-in)). The first open is slower than before, which goes against spec user story 1.
- Firebase Auth holds each Patient's email. The Clinician's dashboard does not show it, and the Patient record does not store it.
- A Patient who forgets their password and loses access to their email loses their records, as with any account.
- Every Clinician account must go through `allow-clinician`; a Clinician account created by hand in the console sees nothing until then, and the dashboard says so.
