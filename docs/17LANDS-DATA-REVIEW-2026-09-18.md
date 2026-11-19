# 17Lands data-use review — 18 September 2026

Reviewed the currently served [Public Datasets](https://www.17lands.com/public_datasets), [Usage Guidelines](https://www.17lands.com/usage_guidelines) and [Terms of Service](https://www.17lands.com/terms_of_service), plus the [CC BY 4.0 deed](https://creativecommons.org/licenses/by/4.0/) and [legal code](https://creativecommons.org/licenses/by/4.0/legalcode.en). The 17Lands pages render their policy text from the live `Routes.d6002c066f6e98b97e49.bundle.js` asset; inspecting only their HTML shell would miss it. The terms page gives an effective date of September 12, 2024; this review checked the page served today.

## Which policy applies

17Lands identifies its public datasets as CC BY 4.0 unless a dataset says otherwise. Its request to share analyses with the community is an encouragement, not a separate license condition. Dataset-specific notices must still be checked at ingestion. [Public Datasets](https://www.17lands.com/public_datasets).

The Usage Guidelines explicitly exclude public datasets and individual-user data from their curated-data scope. Their curated-data citation, embargo and scraping guidance must not be misrepresented as a special public-archive license. They prefer use of public downloads over scraping. Pack One's active Draft Run importer downloads the official draft/game archives, derives its own pick evidence and verifies source trajectories; it does not use the curated Card Data API as its answer key. [Usage Guidelines](https://www.17lands.com/usage_guidelines).

The site's general terms contain a non-resale restriction and recognize exceptions identified on specific pages. Read that alongside the public-dataset grant; neither ignore the general terms nor silently apply the curated-data rules to separately licensed archives. [Terms of Service](https://www.17lands.com/terms_of_service).

## Explicit license requirements

When sharing licensed material, including modifications, retain supplied creator/attribution identification, copyright and license notices, warranty-disclaimer notices and a practicable source link. Identify modifications and retain earlier modification indications. Link to or include the license. Attribution can be reasonable for the medium but cannot imply endorsement. Do not impose additional restrictions or effective technological measures that restrict recipients' licensed rights. The license does not grant trademark rights or guarantee that all other permissions are covered. [CC BY legal code, sections 2–4](https://creativecommons.org/licenses/by/4.0/legalcode.en).

CC BY expressly permits sharing and adaptation for commercial purposes. Its reviewed text does not add a Patreon prohibition, membership requirement, model-training fee, or obligation to publish application source code. This establishes the grant for licensed material, not a blanket conclusion about card artwork, trademarks, privacy or every possible paid feature. [CC BY deed](https://creativecommons.org/licenses/by/4.0/).

## Pack One implementation

| Actual/planned use | Treatment |
|---|---|
| Draft archives and trophy trajectories | Preserve archive URLs, hashes, outcomes and cohort provenance; credit 17Lands |
| Game archives | Disclose their role in skill verification and context-model evidence |
| Derived statistics/model training | State that Pack One filters, transforms and trains on the inputs; model support is Pack One's derived output |
| Free Dailies/account practice | Same source attribution and license notices |
| Future paid capabilities | No provider-specific exception to the attribution/license obligations; do not claim rights over licensed inputs |
| Card metadata/images | Identify Scryfall and respective artwork/trademark rights separately from 17Lands data licensing |

The homepage already credits 17Lands, links the source and license, identifies adaptation and disclaims endorsement. The methodology and terms pages are being reconciled with the rebuilt product. They must preserve recipients' rights in licensed data while describing service access separately.

Conservative product choices, rather than extra claimed license obligations: visible top-level attribution, source/version manifests, modest request rates, no curated-API scraping in ingestion, no implied partnership, and a fresh review before launching paid functionality. No outreach to 17Lands has been sent or represented as approval.
