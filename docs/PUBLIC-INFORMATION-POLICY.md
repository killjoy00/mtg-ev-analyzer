# Public information handling

Pack One uses a public code repository. Issues, pull requests, comments, commit history, workflow output and attached artifacts may be viewed by anyone.

## What belongs in public updates

Share product status, feature descriptions, build and commit references, testing outcomes, and publicly released campaign material.

Keep private:
- Store-review and other test-account identifiers, contact information, and special access configuration
- Customer and partner details, unpublished business plans, and internal operations discussions
- Detailed production incident reports, individual account activity, infrastructure consumption metrics, and diagnostic attachments
- Any secrets or authentication material

Use concise summaries with safe placeholders. Do not copy private material into a public ticket merely to request its removal. Inspect CI logs, screenshots and uploaded artifacts before sharing them. Existing published information may remain available through edit history or archived copies even after correcting the current text.

## Existing systems

Current production monitoring uses issue #596 as a sanitized coverage watermark. Its availability is part of the recovery design. Separate private incident routing is planned in [issue #1144](https://github.com/killjoy00/mtg-ev-analyzer/issues/1144).

Do not disable monitoring or change issue #596 as part of a documentation cleanup. Plan and test the future private issue routing separately, preserving recovery, operator notification, and verification.

This document sets rules for future public content and does not claim historical postings have been erased.
