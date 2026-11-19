# Public-repository safety rules

This repository and its GitHub issues, pull requests, code, workflow logs, screenshots, and artifacts are publicly readable. These rules apply to human contributors and automated coding/operations agents.

**Never place sensitive information in public repository content, even temporarily.** This includes:
- Access tokens, passwords, one-time links, cookies, private keys, credentials, or secrets from logs and environment variables
- Store-review or test-account email addresses, login details, account identifiers, or specific manual access grants; internal staff/customer addresses and personal information (other than deliberately published product contact information)
- Raw or detailed production incident telemetry, traffic/request logs, private provider usage or billing breakdowns, account events, or unreleased operational/partner/campaign information
- Screenshots, recordings, or artifacts containing any of the above

For public issues, PRs, comments, documentation and generated release updates, use *sanitized* status summaries: issue category, affected feature, build/commit, what was verified, and safe next steps. Do not quote the sensitive source when requesting its removal. Link to a private record only when doing so does not leak its contents.

**Check before publishing:** redact and review text, attached evidence, bot output, and uploaded artifacts before creating or updating any public resource. Prefer minimal public diagnostics and private owner-only evidence. An edited public issue or comment may retain visible history; treat any previously disclosed material as exposed.

**Protect existing operations:** Production launch monitoring and authentication alerts currently write to the public repository. Their move to a private destination is tracked in [issue #1144](https://github.com/killjoy00/mtg-ev-analyzer/issues/1144). Do not disable, silently redirect, or strip essential incident reporting, or move the #596 coverage watermark, without an approved, tested migration and a working operator alert path.

Follow [Public information handling](docs/PUBLIC-INFORMATION-POLICY.md) for the detailed policy. These rules do not authorize changing production credentials, GitHub repository visibility, CI gates, or release protections.
