# Launch measurement owner guide

This is the practical operating guide for the launch attribution and Daily habit tools introduced in PR #505.

The detailed measurement definitions live in [Decision quality reporting](DECISION-MEASUREMENTS.md). The release evidence lives in [the launch measurement closeout](reports/PACK-ONE-LAUNCH-MEASUREMENT-CLOSEOUT-2026-09-25.md).

## 1. Open the owner report

Go to:

`https://packone.pro/admin/`

Sign in with the Pack One account that has owner/admin access.

The page still contains the existing decision-quality and Daily result-share reports. The new launch sections are:

- **Daily habit cohorts**
- **3-in-7 daily health**

The habit tables use the **From** and **Through** dates as the first-Daily cohort window.

The environment, run-type, set, difficulty, pick and selection-version filters on the page do **not** change the habit metrics. Those controls belong to the decision-quality report.

## 2. Make campaign links

The preferred operator surface is the Admin **Campaign Links / Link Builder**:

`https://packone.pro/admin/?area=campaign-links`

It validates and normalizes the slug, source, campaign, and optional medium; previews the tracked UTM URL; previews the intended `/go/<slug>/` vanity URL; produces the exact `campaign-links.json` entry; and warns when a slug already exists.

A tracked UTM URL can be copied and used immediately. A vanity `/go/<slug>/` URL is **not** published by the builder: its JSON entry and generated page must be committed through the normal site PR and deployed by GitHub Pages.

For the complete publishing, retirement, generator, and troubleshooting workflow, use [Campaign Links owner guide](CAMPAIGN-LINKS-OWNER-GUIDE.md).

For links you control, add:

- `utm_source` — where the visitor came from;
- `utm_campaign` — the campaign or push you want to compare;
- `utm_medium` — optional channel type.

Example:

`https://packone.pro/?utm_source=reddit&utm_campaign=launch-week&utm_medium=social`

A simple naming convention keeps the report readable:

| Field | Recommended style | Examples |
| --- | --- | --- |
| `utm_source` | platform / partner | `reddit`, `discord`, `newsletter` |
| `utm_campaign` | one stable initiative name | `launch-week`, `hob-season`, `elite-push` |
| `utm_medium` | broad channel | `social`, `email`, `partner` |

Values are normalized to lowercase. Keep them to letters, numbers, underscores and hyphens, starting with a letter or number. The current sanitizer accepts at most 40 characters per value.

Do not put names, email addresses, account IDs or other personal information into campaign values.

After Pack One records the attribution, the `utm_*` parameters are removed from the visitor's address bar.

### What happens without UTM tags

When there is no UTM source:

- an external referrer hostname may become the first-touch source;
- otherwise a post-tracking user can appear as `direct`;
- an older user whose activity predates acquisition tracking can appear as `pre_tracking`.

A marked Daily result-share visit remains `result_share` and continues to feed the existing Daily result-share funnel.

## 3. Read the Daily habit cohorts

Each row is grouped by **First touch** and **Campaign**.

### First-Daily people

This is the number of people whose **first real completed Daily** falls in your selected From/Through window.

It is the cohort size. It is not page visits and it is not number of Dailies played.

One person can complete all three Dailies on the same day and still contribute one habit day.

### Next-day return

This asks:

> Of people whose first Daily is mature enough to measure, how many completed any Daily on the next Pacific date?

Read the small line under the rate. It shows:

`returned / mature denominator · immature count`

Do not include the immature count mentally as failures. Those people simply have not had enough elapsed time yet.

### 7-day return

This asks whether the person completed a Daily during the seven-day follow-up window.

Again, compare the mature numerator and denominator, not just the percentage.

### 3-in-7

This is the strongest fixed launch-habit signal in the table:

> Did the person complete Dailies on at least three distinct Pacific dates during the first seven-day window?

Three Dailies on one day do not count as three days.

### Ever 3-in-7

This is different from the fixed-window 3-in-7 metric.

It asks whether the person has **ever** demonstrated a three-Daily-days-in-seven pattern in the observed history. It can rise later, after the original first-seven-day cohort window is over.

Use it as a longer-horizon behavior marker, not as a fixed conversion rate.

## 4. Read the source labels correctly

| Label | Meaning |
| --- | --- |
| `result_share` | First touch came through the marked Daily result-share path. |
| `pre_tracking` | The person had Pack One activity before acquisition tracking began. |
| `direct` | First observed after tracking began, but no campaign/referrer source was captured. |
| External hostname | First touch came from an external referring site without a UTM source. |
| `(none)` campaign | A source exists but no campaign value was captured. |

First touch is intentionally sticky. If someone first arrives from one source and returns later through another campaign, the later visit does not rewrite the original first touch.

That makes these rows acquisition cohorts, not last-click marketing reports.

## 5. Use 3-in-7 daily health

The **3-in-7 daily health** table is a rolling product-health series.

For each date, it counts people who completed a Daily on at least three distinct Pacific dates in the trailing seven dates.

Use it to answer:

> Is the population currently showing repeat-Daily behavior growing, flat or shrinking?

Do not read it as a conversion percentage. It is a rolling count.

A useful operating habit is to watch the shape over time rather than react to a single date.

## 6. Keep the result-share funnel separate

The **Daily result-share funnel** still measures the sharing loop using its existing definition:

- share-link arrivals;
- unique arriving browser identities;
- new attributed Daily starts;
- completed attributed Dailies.

That funnel answers a different question from the new first-touch cohort table.

Use the share funnel to ask:

> Are shared results bringing people into a Daily and getting them to completion?

Use the habit cohorts to ask:

> Where did first-Daily people come from, and did they build a repeat-Daily habit?

Do not expect the new acquisition logic to rewrite the existing result-share funnel.

## 7. Understand the new player-facing streak cue

Players do not need to configure anything.

For a Daily player, Pack One now calculates a session-derived `daily_streak` from consecutive distinct completed Daily dates.

After a Daily result, Pack One shows:

`New Dailies in …`

When the player has a streak of at least two days, it adds:

`· N-day streak`

The same cue appears on the Daily home after all three Dailies for the current date are finished.

The countdown uses the next Pacific Daily boundary, so daylight-saving transitions are handled correctly.

Regular Practice does not show the Daily streak/reset cue.

## 8. Suggested weekly workflow

For normal launch monitoring:

1. Pick a first-Daily cohort window in **From** and **Through**.
2. Scan **First-Daily people** by source/campaign to confirm acquisition is landing where expected.
3. Ignore immature users when evaluating fixed-window rates.
4. Compare **Next-day return**, **7-day return** and **3-in-7** only when their mature denominators are large enough to be meaningful.
5. Check **3-in-7 daily health** for the broader repeat-Daily trend.
6. Check the **Daily result-share funnel** separately to understand the sharing loop.
7. If a campaign underperforms, verify the campaign link and sample size before changing the product.

For a fresh campaign, it is normal for the 7-day and 3-in-7 columns to remain mostly immature during the first week.

## 9. Quick launch-link checklist

Before posting a tracked link:

- choose one stable `utm_source`;
- choose one stable `utm_campaign`;
- optionally add `utm_medium`;
- use canonical acquisition values 1–40 characters long that match `/^[a-z0-9][a-z0-9_-]{0,39}$/`;
- use no personal information;
- open the link once and confirm Pack One loads normally;
- expect the UTM parameters to disappear from the address bar after capture.

Browser attribution converts each UTM value to a string, trims it, lowercases it, then applies the validation rule above. That normalization is convenient for interactive input, but malformed manually constructed values can still be rejected and dropped. For example, `launch week`, `r/magictcg`, and any 41-character value are invalid after normalization. Checked-in campaign configuration should already contain canonical values rather than relying on normalization; the admin Campaign Link Builder helps surface these validation errors before a link is committed.

Example campaign family:

`https://packone.pro/?utm_source=reddit&utm_campaign=launch-week&utm_medium=social`

`https://packone.pro/?utm_source=discord&utm_campaign=launch-week&utm_medium=social`

Using the same campaign name across sources makes the launch initiative easy to compare while still separating the acquisition source.

## 10. Common mistakes to avoid

- **Treating immature cohorts as churned.** They are excluded from fixed-window denominators until their window closes.
- **Reading 3-in-7 health as a percentage.** It is a rolling count.
- **Assuming three Dailies in one day equals 3-in-7.** Habit metrics count distinct Daily dates.
- **Expecting page filters to change habit metrics.** Most of the existing admin filters apply to decision-quality reporting, not the habit tables.
- **Changing campaign names mid-push.** That fragments one initiative into multiple rows.
- **Using personally identifying data in UTM values.** Campaign values should describe marketing/source context only.
- **Expecting a later campaign to replace first touch.** The new report is intentionally first-touch based.
- **Expecting the streak cue in Practice.** It is Daily-only.
- **Making product decisions from tiny early cohorts.** The first purpose of these tools is to establish clean measurement; sample size still matters.

## Example analysis requests

Useful operator requests include:

- “Check the Pack One launch metrics and summarize what changed this week.”
- “Compare the mature launch-week cohorts by source without counting immature users.”
- “Which campaigns are producing first-Daily players, and what are their 3-in-7 results?”
- “Check whether the Daily habit health trend is improving.”
- “Create tracked links for Reddit, Discord and newsletter for campaign `hob-season`.”
- “Audit the release and tell me whether acquisition, habit metrics and streaks are still healthy.”

For a live read, use the connected repository/backend evidence available to the operator and distinguish measured results from cohorts that are still too early to interpret.
