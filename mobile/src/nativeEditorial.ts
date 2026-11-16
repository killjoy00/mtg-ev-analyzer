import type { ArticleSection } from '@/src/components/ArticleScreen';

export const aboutSections: ArticleSection[] = [
  {
    title: 'Make a pick, then compare.',
    body: [
      'The idea for Pack One came from a Reddit post about studying trophy drafts to get better at Limited. I thought it would be fun to see the same packs successful drafters did, make my own picks, and then compare. So I built a daily game around eight picks from eight different trophy drafts.',
    ],
  },
  {
    title: 'Three free Dailies.',
    body: [
      "Every day there are three challenges: Draft Run, Powered Cube, and Latest Set. Everyone gets the same picks. You don't need an account to play or share your results. A free account lets you join the leaderboard and play as many regular practice runs as you want.",
    ],
  },
  {
    title: 'How scoring works',
    body: [
      'Matching the trophy drafter gets you 100 points. Other picks can score up to 95 if the model supports them. That doesn’t mean every other card was wrong.',
    ],
  },
  {
    title: 'Independent project.',
    body: [
      'Pack One is an independent Magic: The Gathering fan project. It uses 17Lands public draft data under CC BY 4.0 and card data and images from Scryfall. No affiliation or endorsement by those sources is implied. See the Terms for full source attribution and license details.',
      'Pack One is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.',
    ],
  },
  {
    title: 'How I built Pack One',
    body: [
      "I'm not a programmer, and I built Pack One with a lot of help from AI tools. I decide what goes into the game, and I'm responsible when something doesn't work.",
      'Every pick comes from an actual recorded draft, and scoring uses a statistical model based on real drafting behavior. Neither the model nor the trophy drafter is right every time.',
      'A lot of the site has gotten better because players told me what wasn’t working. If something bugs you or you have an idea, email me.',
    ],
  },
];

export const supportSections: ArticleSection[] = [
  {
    title: 'Product and support',
    body: [
      'For bugs, picks that look wrong, questions about scoring, accessibility problems, or ideas, email admin@packone.pro.',
    ],
  },
  {
    title: 'Partnerships and business',
    body: [
      'For advertising, sponsorships, affiliates, or other business questions, email partner@packone.pro.',
    ],
  },
];

export const privacySections: ArticleSection[] = [
  {
    title: 'What Pack One stores',
    body: [
      'Pack One keeps the information needed to run the game and remember your progress. On the website, that includes first-party cookies for player and account sessions and request security, plus browser storage for guest identity, game history, preferences, Daily history, and temporary product or sign-in flow state. Guest play is tied to a Pack One player identifier so progress can continue across visits. If you later sign in, eligible guest progress is merged into the account under Pack One’s existing ownership rules.',
      'In the mobile apps, sign-in sessions, in-progress shared runs, and similar recovery state are kept in device secure storage. Gameplay records, account-linked progress, memberships, and other server-backed features are stored by Pack One’s backend services.',
    ],
  },
  {
    title: 'Accounts and sign-in',
    body: [
      'Accounts are optional. You can sign in with an email address and password, with Google, or with Sign in with Apple. Pack One stores your account email address, the display name you choose, and the sign-in methods linked to the account. Pack One does not receive your Google or Apple password.',
      'Google sign-in shares your email address, name, and basic profile information with Pack One’s sign-in service. Sign in with Apple shares an email address, which can be an Apple private relay address if you choose to hide your email, and, on the first sign-in, the name you choose to share. For Sign in with Apple, Pack One also stores the Apple account identifier and an encrypted Apple token used to revoke Sign in with Apple when you delete the Pack One account.',
      "Email/password signup requires email verification. Pack One uses your account email for verification, password recovery, account deletion, security notices, and important account updates.",
      "We may also contact you individually about your account, your results, or your experience with the game, including to ask for feedback. You can ask us to stop nonessential individual messages by replying or emailing admin@packone.pro. Promotional emails are covered by the separate email preference described below.",
      "Pack One also sends optional emails about results, updates, community news, and offers. Those are described below.",
      "Our email provider receives the address and message information needed to send these emails.",
    ],
  },
  {
    title: 'Optional Daily reminders',
    body: [
      'Daily reminder emails are off by default and are sent only after you turn them on in Account settings. Pack One sends at most one reminder email a day and skips days you have already finished all three Dailies. Reminder emails go only to the verified email on your Pack One account and include unsubscribe and management links. In the Pack One mobile app, device notifications are a separate choice that also needs device permission and uses a device-specific push token. Granting email consent does not grant push consent.',
      'To deliver reminders, Pack One stores your reminder choices and when you made them, a minimal change history, delivery attempts and provider receipt states, and, for the mobile app, device registrations with protected push tokens. Resend receives the verified email and email contents for reminder emails; Expo and device push providers handle native notification tokens and message content. A provider accepting a message does not guarantee its appearance or delivery. Bounce and complaint events can turn off email reminders.',
      'Pack One removes reminder preferences, send records, and device registrations when your account is deleted. Delivery records are otherwise kept for up to 90 days, change history for up to 365 days, and revoked device registrations for up to 30 days; cleanup runs with the daily reminder job. Bounce and complaint suppression fingerprints remain until account deletion to honor delivery restrictions. Changing accounts or signing out revokes the corresponding device registration. Unsubscribing from email does not affect push. A message already handed to an email or device provider cannot be recalled. Pack One does not sell reminder destinations or publicly report individual reminder activity.'
    ],
  },
  {
    title: "Results and news emails",
    body: [
  "Pack One sends emails about your results, usually weekly, along with occasional game updates, community news, and offers.",
  "We only send these emails if you've turned them on. We'll ask once after you sign in, and you can change your answer anytime in Account settings.",
  "Every results and news email includes an unsubscribe link. Unsubscribing stops these emails, but doesn't affect important account or security messages, permitted non-promotional individual messages, or your Daily reminder preference. You can also ask us to stop nonessential individual messages.",
  "We keep a record of your email choices and changes, along with the delivery information needed to handle unsubscribes, bounces, and complaints.",
  "If you change your account email, an unsubscribe stays in effect. If you had turned emails on, we'll ask again before sending results and news to the new address."
],
  },
  {
    title: 'Gameplay, analytics, and decision reports',
    body: [
      'Pack One stores gameplay inputs and results needed to score runs, preserve progress, show history, support Daily leaderboards, and operate account features. Pack One also records product events such as page views, game starts, reveals, challenge opens and completions, shares, membership checkout and restoration steps, and outbound commerce clicks so it can understand whether the product works and where players stop in the experience.',
      'Analytics use a Pack One player identifier and a random browser or app-session identifier to understand repeat play. Gameplay properties are allowlisted; email addresses, passwords, auth tokens, and raw page URLs are not included in product events. Campaign tags may be recorded, and when no campaign source is present Pack One may record only the referring site’s hostname, not its path or query.',
      'Pack One uses Cloudflare Web Analytics to count visits to pages like Learn and the set guides. It does not collect personal data or record query strings.',
      'If you use Report this decision, Pack One stores the selected reason, optional comment, the reported decision and run context, scoring/corpus/release context, client platform/version/build when available, a timestamp, and the existing Pack One player identifier. Decision reports do not include email addresses, passwords, or auth tokens. If the associated player record is deleted, a report may remain without that player identifier so product-quality evidence can still be reviewed in aggregate.',
    ],
  },
  {
    title: 'Profiles and shared challenges',
    body: [
      'Profiles are private by default. Publishing requires an account and an explicit choice. Public profiles show the display name, game record, and selected career details; they exclude email and account/session identifiers. Private profile shares link to the general site. Creating a friend challenge makes its display name, score, and the run’s final packs available to anyone with that challenge link. Do not put sensitive personal information into a display name.',
    ],
  },
  {
    title: "Public leaderboards and results",
    body: [
  "Pack One shows leaderboards for eligible signed-in players. These can include your display name, rank, scores, season rating, and number of Dailies played.",
  "Your leaderboard results can be public even if your player profile is private.",
  "We may also publish weekly and season results, past standings, notable performances, and player features. These might appear on Pack One, in our emails, or on our official accounts on services such as Reddit, Patreon, YouTube, and Bluesky. Unlike the live leaderboards, these posts may stay up after a week or season ends.",
  "We won't include your account email, sign-in details, private account information, or anything from a private profile.",
  "You can ask us to leave your display name out of these publications in Account settings or by emailing admin@packone.pro. This won't remove you from the regular leaderboards.",
  "If you share comments or other material for a player feature, we'll show you what we plan to publish and ask for your approval first.",
  "We'll give existing players advance notice before introducing these publications, along with a chance to opt out."
],
  },
  {
    title: 'Memberships and subscriptions',
    body: [
      'Connecting Patreon stores the provider account and membership identifiers, current campaign and tier entitlements, membership and charge status, and connection and synchronization times. These records link benefits to your Pack One account. Pack One does not store your Patreon password or Patreon OAuth access token. Disconnecting removes the provider link and Patreon benefits without deleting your Pack One account or game history.',
      'When you subscribe to Pack One Elite through Apple, Pack One stores App Store subscription transaction identifiers, product identifier, environment, expiration and renewal state, and the Pack One account identifier supplied to StoreKit as the app account token. Pack One verifies Apple-signed transaction and server-notification data before granting Apple-provided access. Apple handles payment details; Pack One does not receive your full payment-card information.',
    ],
  },
  {
    title: 'Advertising and commerce links',
    body: [
      'Google advertising is currently disabled, so Pack One does not currently load Google display ads. While Google advertising is disabled, the Daily home can show a TCGplayer affiliate promotion to visitors who are eligible to see advertising.',
      'TCGplayer links are routed through Impact. The Daily-home promotion uses a logo image served by Pack One; merely viewing it does not load a TCGplayer or Impact script or tracking pixel. Pack One records outbound TCGplayer clicks, including the card, set, page surface, and affiliate-routing status. Purchases and payment details are handled by TCGplayer and its partners, not by Pack One.',
    ],
  },
  {
    title: 'Pack One apps',
    body: [
      'The Pack One apps use the same Pack One accounts and backend services as the website, so the rest of this page applies to them. The apps do not include third-party analytics, advertising, or crash-reporting SDKs. When you play, the apps send picks and run results to Pack One’s servers for scoring and recordkeeping, and the servers record gameplay events linked to the Pack One player identifier.',
      'Connecting Patreon from the apps opens Patreon in your browser. The apps’ Daily home can show the TCGplayer promotion to players who are eligible to see advertising, and TCGplayer links open in the browser through the same Impact affiliate routes. The apps do not separately record those outbound clicks. Apple subscriptions are offered only in the iOS app.',
    ],
  },
  {
    title: 'Third-party services and email delivery',
    body: [
      'Pack One uses third-party services where needed to provide the product: Google and Apple for optional sign-in, Patreon for connected membership, Apple for iOS subscriptions, Resend for account and optional emails, Scryfall for card images, and infrastructure providers for hosting, authentication, databases, and related operations. Card-image requests can be made to Scryfall from your device. When you follow a link to an external service, that service applies its own privacy practices.',
    ],
  },
  {
    title: 'Retention and deleting your account',
    body: [
      'Pack One keeps ordinary account and gameplay records to provide account features, saved history, leaderboards, and product operations. Account deletion removes attributable data as described below. Short-lived verification, sign-in, and similar technical records expire or are removed through cleanup processes.',
      'For supported sign-in methods, Account settings lets you permanently delete your Pack One account after fresh verification. Password accounts use the current password. Accounts without a password use a short-lived one-time code sent to the verified email address already associated with the account; Pack One does not ask the browser to choose the destination. Sign in with Apple accounts may be asked to verify with Apple instead.',
      "Deleting your Pack One account removes your account and player records, public profile, live leaderboard entries, game history, career history, and linked account information, including Patreon and Apple subscription connections.",
      "Deleting your Pack One account does not cancel an Apple App Store subscription. You must manage or cancel that through Apple.",
      "Anonymous or aggregate statistics may remain.",
      "Published results and player features are stored separately from live leaderboards. If you delete your account, we'll remove or anonymize your display name in the published results and player features we control within 28 days. You don't need to make another request.",
      "You can also ask us to remove your name from published results without deleting your account. Email admin@packone.pro.",
      "We can't recall emails already sent or remove copies that other people have saved, quoted, or republished.",
      "Account deletion normally happens immediately. If a sign-in provider is temporarily unavailable after deletion has started, we'll sign you out and finish the process automatically. You don't need to do anything else, and the deletion can't be canceled.",

    ],
  },
  {
    title: "Changes to this Privacy Policy",
    body: [
  "We may update this policy as Pack One changes. The date at the top shows when it was last updated.",
  "If we make a significant change to how we collect or use personal information, we'll give you advance notice through Pack One, an account email, or another suitable method.",
  "If the law requires your consent, we'll ask before making the change."
],
  },
  {
    title: 'Your choices and contact',
    body: [
      'You can play without an account, keep your profile private, manage optional emails, ask to be left out of published results, disconnect Patreon, sign out, or delete your account in Account settings. In the apps, open Account settings and choose Delete account. If you cannot complete deletion in the app or Account settings, email admin@packone.pro from the email address associated with the account; Pack One may require verification before acting on the request.',
    ],
  },
];

export const termsSections: ArticleSection[] = [
  {
    title: 'Use of the site',
    body: [
      'Pack One is provided as an educational and entertainment tool for comparing Limited draft decisions. Scores and model support are informational. They are not guarantees of tournament results, card value, or financial return.',
      'These terms apply to the Pack One website and mobile apps.',
    ],
  },
  {
    title: 'Public identity and community rules',
    body: [
      "Leaderboard names, public profiles, and names attached to shared Pack One activity are public content provided by players. Leaderboards are for signed-in accounts. By signing in or saving a leaderboard name or public profile, you agree to these Public Identity rules.",
      "Your display name and results can appear on leaderboards even if your player profile is private.",
      "Pack One may also publish weekly and season results, historical standings, notable performances, and player features using public leaderboard information. These posts may remain available after a week or season ends.",
      "You can ask to be left out of these separate publications without leaving the regular leaderboards.",
      "Being on a leaderboard doesn't give Pack One permission to publish your private messages, contact information, or other nonpublic material without appropriate authorization.",
      'Do not use a public identity to threaten, harass, impersonate, spam, publish private contact information, evade moderation, or display hateful, sexually explicit, or otherwise abusive content. Do not present yourself as Pack One staff, support, or an official Pack One account unless Pack One has authorized that role.',
      'Pack One may reject a leaderboard name, hide a public identity, remove its name from public/shared surfaces, or restrict republication when these rules are violated. Moderation of public identity does not by itself delete the underlying gameplay or career record. Players can report a public profile and block another public identity from the in-app profile controls. Reports are reviewed by Pack One; false or abusive reporting is itself misuse.',
      'For a moderation or safety concern that cannot be handled in-app, contact admin@packone.pro.',
    ],
  },
  {
    title: "Communications",
    body: [
  "Pack One may contact you about your account, results, or experience with the game, including requests for feedback.",
  "We also offer optional emails about results, news, and offers. We only send these if you've turned them on.",
  "Creating an account or agreeing to these Terms doesn't turn optional emails on.",
  "You can unsubscribe anytime or ask us to stop nonessential individual messages."
],
  },
  {
    title: 'Data and attribution',
    body: [
      'Pack One filters and adapts 17Lands public draft and game archives into trophy puzzles, pick statistics and context-model evidence. These source datasets are licensed under CC BY 4.0, unless their source notices state otherwise; archive links and versions are recorded in corpus manifests. Licensed data is provided without warranties. Pack One is not endorsed by 17Lands. Account and capability rules govern access to Pack One services and do not replace or restrict recipients’ rights under the source-data license.',
      'Card metadata and card images are sourced from Scryfall. Scryfall is not affiliated with or responsible for Pack One, and use of Scryfall data or image URLs does not imply endorsement. Magic: The Gathering card names, art, symbols, trademarks, and other related intellectual property belong to Wizards of the Coast and other applicable rights holders.',
    ],
  },
  {
    title: 'Wizards Fan Content notice',
    body: [
      'Pack One is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.',
    ],
  },
  {
    title: 'Advertising & affiliate disclosure',
    body: [],
  },
  {
    title: 'TCGplayer affiliate relationship',
    body: [
      "Pack One participates in TCGplayer's affiliate program through Impact. TCGplayer links and the Daily-home TCGplayer promotion are sponsored/affiliate links, and Pack One may earn a commission from eligible purchases. The price a buyer pays is not increased by Pack One's commission. The Daily-home promotion includes an adjacent commission disclosure. Verified ad-free memberships hide that promotion and individual-card TCGplayer links on the website and app.",
    ],
  },
  {
    title: 'Editorial independence',
    body: [
      'Commerce relationships do not influence consensus support, card rankings, Daily Challenge results, or scoring. The model is generated from the draft-data workflow, not from marketplace prices or affiliate payouts.',
    ],
  },
  {
    title: 'Advertising',
    body: [
      'Display advertising, if enabled, is visually separated from editorial content and is excluded from active gameplay. Pack One does not ask users to click ads, and ads are not presented as game controls or recommendations.',
    ],
  },
  {
    title: 'Apple subscriptions',
    body: [
      'Pack One Elite may be offered in the iOS app as an auto-renewable subscription purchased through Apple. The App Store displays the price and billing period before purchase. Payment is charged to the Apple Account used for the purchase. The subscription renews automatically unless it is canceled through Apple; canceling stops future renewals but does not normally remove access before the end of the paid period. Restore Purchases can be used in the iOS app for an eligible subscription associated with the Apple Account and the same Pack One account binding.',
      "Apple manages subscription billing, cancellation, refunds, and payment methods. Deleting a Pack One account does not cancel an Apple subscription. Manage or cancel the subscription through Apple's subscription settings before or after deleting the Pack One account as appropriate.",
    ],
  },
  {
    title: 'External links',
    body: [
      'Pack One may link to marketplaces and other external resources. Those destinations control their own products, pricing, availability, terms, and privacy practices. Affiliate relationships do not change Pack One scores or model outputs.',
    ],
  },
  {
    title: 'Account age requirement',
    body: [
      'You must be at least 13 years old to create a Pack One account. Pack One’s public, non-account features may be used without creating an account.',
    ],
  },
  {
    title: 'No warranty',
    body: [
      'The site and model are provided as-is. Draft datasets, card metadata, third-party services, and model outputs can contain errors or change over time. Pack One may update the product, scoring, or supported data. Material model, corpus, selection, and scoring changes are versioned so historical results retain the versions under which they were produced.',
    ],
  },
  {title: "Changes to these Terms", body: ["We may update these Terms as Pack One changes. The date at the top shows when they were last updated.","We'll give notice of significant changes. Where the law requires your agreement or consent, we'll ask for it first."]},
];

export const resultsPolicyReleaseDate = "2026-11-16";
