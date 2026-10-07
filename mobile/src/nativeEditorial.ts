import type { ArticleSection } from '@/src/components/ArticleScreen';

export const aboutSections: ArticleSection[] = [
  {
    title: 'Make a pick, then compare.',
    body: [
      'Pack One is a short Limited decision game. Play eight independent decisions from qualified trophy drafts, with the original drafter’s earlier cards visible. Lock your choice before seeing their pick and the model’s alternatives.',
    ],
  },
  {
    title: 'Three Dailies, ready to play.',
    body: [
      'Daily Draft Run, Daily Powered Cube, and Daily Latest Set are free, fixed challenges shared by everyone that day. No account is needed to play, score or share. A free account adds leaderboard participation and unlimited regular random practice.',
    ],
  },
  {
    title: 'The trophy pick is the target.',
    body: [
      '100 means you matched the trophy drafter. Other choices receive up to 95 based on model support. An excellent alternative can differ from the choice made in that successful draft.',
    ],
  },
  {
    title: 'Independent project.',
    body: [
      'Pack One is an independent Magic: The Gathering fan project. It uses 17Lands public draft data under CC BY 4.0 and card data and images from Scryfall. No affiliation or endorsement by those sources is implied. See the Terms for full source attribution and license details.',
      'Pack One is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.',
    ],
  },
];

export const supportSections: ArticleSection[] = [
  {
    title: 'Product and support',
    body: [
      'For bug reports, methodology questions, data corrections, accessibility issues, or feature requests, email admin@packone.pro.',
    ],
  },
  {
    title: 'Partnerships and business',
    body: [
      'For advertising, sponsorship, affiliate, or other business inquiries, email partner@packone.pro.',
    ],
  },
];

export const privacySections: ArticleSection[] = [
  {
    title: 'What Pack One stores',
    body: [
      'Pack One keeps the information needed to run the game and remember your progress. On the website, that includes first-party cookies for player and account sessions and request security, plus browser storage for guest identity, game history, preferences, Daily history, and temporary product or sign-in flow state. Guest play is tied to a Pack One player identifier so progress can continue across visits. If you later sign in, eligible guest progress is merged into the account under Pack One’s existing ownership rules.',
      'In the iPhone, iPad and Android apps, sign-in sessions, in-progress shared runs, and similar recovery state are kept in device secure storage. Gameplay records, account-linked progress, memberships, and other server-backed features are stored by Pack One’s backend services.',
    ],
  },
  {
    title: 'Accounts and sign-in',
    body: [
      'Accounts are optional. You can sign in with an email address and password, with Google, or with Sign in with Apple. Pack One stores your account email address, the display name you choose, and the sign-in methods linked to the account. Pack One does not receive your Google or Apple password.',
      'Google sign-in shares your email address, name, and basic profile information with Pack One’s sign-in service. Sign in with Apple shares an email address, which can be an Apple private relay address if you choose to hide your email, and, on the first sign-in, the name you choose to share. For Sign in with Apple, Pack One also stores the Apple account identifier and an encrypted Apple token used to revoke Sign in with Apple when you delete the Pack One account.',
      'Email/password signup requires email verification. Pack One also sends account emails for verification, password recovery, deletion verification where applicable, and certain account notices. The email-delivery provider receives the destination address and message data needed to deliver those emails.',
    ],
  },
  {
    title: 'Gameplay, analytics, and decision reports',
    body: [
      'Pack One stores gameplay inputs and results needed to score runs, preserve progress, show history, support Daily leaderboards, and operate account features. Pack One also records product events such as page views, game starts, reveals, challenge opens and completions, shares, and outbound commerce clicks so it can understand whether the product works and where players stop in the experience.',
      'Analytics use a Pack One player identifier and a random browser-session identifier to understand repeat play. Gameplay properties are allowlisted; email addresses, passwords, auth tokens, and raw page URLs are not included in product events. Campaign tags may be recorded, and when no campaign source is present Pack One may record only the referring site’s hostname, not its path or query.',
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
      'Pack One uses third-party services where needed to provide the product: Google and Apple for optional sign-in, Patreon for connected membership, Apple for iOS subscriptions, Resend for transactional account email delivery, Scryfall for card images, and infrastructure providers for hosting, authentication, databases, and related operations. Card-image requests can be made to Scryfall from your device. When you follow a link to an external service, that service applies its own privacy practices.',
    ],
  },
  {
    title: 'Retention and deleting your account',
    body: [
      'Pack One keeps ordinary account and gameplay records to provide account features, saved history, leaderboards, and product operations. Account deletion removes attributable data as described below. Short-lived verification, sign-in, and similar technical records expire or are removed through cleanup processes.',
      'For supported sign-in methods, Account settings lets you permanently delete your Pack One account after fresh verification. Password accounts use the current password. Accounts without a password use a short-lived one-time code sent to the verified email address already associated with the account; Pack One does not ask the browser to choose the destination. Sign in with Apple accounts may be asked to verify with Apple instead.',
      'Deletion removes attributable Pack One data including the account/player record, public profile, leaderboard entry, individual gameplay and career history, and linked Patreon, Apple-subscription, and other account associations. Deleting a Pack One account does not cancel an Apple App Store subscription; Apple subscriptions must be managed or canceled through Apple. Genuinely aggregate or otherwise non-attributable statistics may remain where applicable.',
      'Deletion normally completes immediately. If identity-provider completion is temporarily unavailable after deletion has committed, Pack One signs you out and finishes the irreversible operation through server-side recovery. No further user action is required, and the deletion cannot be canceled after it enters the committed pending state.',
    ],
  },
  {
    title: 'Your choices and contact',
    body: [
      'You can play without an account, choose whether to publish a profile, disconnect Patreon, sign out, and use Account settings to request account deletion. In the apps, open Account settings and choose Delete account. If you cannot complete deletion in the app or Account settings, email admin@packone.pro from the email address associated with the account; Pack One may require verification before acting on the request.',
    ],
  },
];

export const termsSections: ArticleSection[] = [
  {
    title: 'Use of the site',
    body: [
      'Pack One is provided as an educational and entertainment tool for comparing Limited draft decisions. Scores and model support are informational. They are not guarantees of tournament results, card value, or financial return.',
      'These terms apply to the Pack One website and the Pack One apps for iPhone, iPad and Android.',
    ],
  },
  {
    title: 'Public identity and community rules',
    body: [
      'Account-owned leaderboard names, public profiles, and the identity attached to shared Pack One activity are user-provided public content. Leaderboards are for signed-in accounts. By signing in, or by saving a leaderboard name or public profile, you agree to these Public Identity rules.',
      'Do not use a public identity to threaten, harass, impersonate, spam, publish private contact information, evade moderation, or display hateful, sexually explicit, or otherwise abusive content. Do not present yourself as Pack One staff, support, or an official Pack One account unless Pack One has authorized that role.',
      'Pack One may reject a leaderboard name, hide a public identity, remove its name from public/shared surfaces, or restrict republication when these rules are violated. Moderation of public identity does not by itself delete the underlying gameplay or career record. Players can report a public profile and block another public identity from the in-app profile controls. Reports are reviewed by Pack One; false or abusive reporting is itself misuse.',
      'For a moderation or safety concern that cannot be handled in-app, contact admin@packone.pro.',
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
      "Pack One participates in TCGplayer's affiliate program through Impact. TCGplayer links and the Daily-home TCGplayer promotion are sponsored/affiliate links, and Pack One may earn a commission from eligible purchases. The price a buyer pays is not increased by Pack One's commission. The Daily-home promotion includes an adjacent commission disclosure and is excluded for visitors whose verified membership is ad-free.",
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
];
