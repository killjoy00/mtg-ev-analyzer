# Beat the Creator — private-profile source approval

Administrators may publish an individual completed Daily or shared Practice run
from a creator who keeps their Pack One profile private. This **does not**
make the creator's profile public, and it never grants public profile access.

## Admin workflow

1. Obtain the creator's explicit permission **to publish their eight choices,
   score, and chosen public challenge name** (not just permission to inspect
   their Daily). Do not infer permission merely from access to a result link.
2. Open Admin → Creator Challenges → **Completed Daily**. Search the creator's
   owned username, choose the linked private account, then choose the completed
   Daily. Shared Practice source resolution is also supported.
3. Confirm the displayed session, environment, score and chosen public name.
   For a private profile, check the mandatory authorization box only after
   permission has actually been received. This confirmation is stored in the
   challenge row and the creator-challenge audit with the admin identity.
4. Create/publish through the normal protected workflow, **after the Pacific
   date rolls over** for Daily sources. Verify the live URL before distributing.
5. If permission is withdrawn, retire the individual public challenge through
   Admin. Never turn on the creator's public profile as a workaround.

## Privacy guarantees

- Only admin-authenticated discovery may see eligible private source accounts.
  A private source must have a linked account and an owned username. Anonymous
  or unowned-username private runs are not promotable.
- Moderated/hidden public identities, deleted sources, incomplete/QA runs and
  unapproved private profiles remain ineligible. Consent applies to **one**
  challenge; it is not permanent permission to expose a player's profile.
- The public challenge uses only the admin-entered creator display name,
  optional handle, eight decisions and score, and the existing controlled
  social image. Private account ID, email, sign-in state and player profile are
  not included in the public page.
- Existing profile hide/moderation and account-deletion workflows continue to
  retire and scrub matching challenges. A formerly public creator who switches
  off public profile triggers the existing privacy-retirement path.
- A normal Daily "Share result" URL points to the universal Daily, **not**
  to a particular creator's completed session. To create a creator challenge,
  select the authoritative session in Admin instead.

## Schema and release

`migrations/0063_private_creator_consent.sql` adds
`creator_challenges.private_profile_consent_attested` with default false.
The secure-auth release applies this additive schema in development and
production **before** deploying the corresponding runtime code. Existing
public-profile challenges remain valid without change. Do not deploy the new
runtime alone or manually modify a customer's profile settings.
