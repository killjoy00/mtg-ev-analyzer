# Cloudflare access from a phone

This setup uses a manually dispatched GitHub Action; a desktop app or direct Cloudflare connector is not required. The token stays in a GitHub Actions secret and is sent only to Cloudflare's API by the runner. Do not commit it to a file or paste it into chat, a PR, an issue or a workflow input.

## Create a limited inspection token

In your phone's browser, open [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens), choose **Create Token**, then create a custom **user API token** named `Pack One routing audit`.

Add these permissions; each uses the **Zone** category:

| Permission | Access |
|---|---|
| Zone | Read |
| DNS | Read |
| Workers Routes | Read |

Under **Zone Resources**, select **Include → Specific zone → packone.pro**. Use a short expiration, such as seven days, for this inspection. Create the token and copy its value once. Use an API token, not the legacy Global API Key or an R2 access key. Cloudflare documents [token creation and zone scoping](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), and the required read permissions for [zones](https://developers.cloudflare.com/api/resources/zones/methods/list/), [DNS](https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/list/) and [Worker routes](https://developers.cloudflare.com/api/resources/workers/subresources/routes/methods/list/).

## Save it in GitHub

Open the repository's [Actions secrets settings](https://github.com/killjoy00/mtg-ev-analyzer/settings/secrets/actions) in your browser. Select **New repository secret**, use the exact name `CLOUDFLARE_AUDIT_TOKEN`, paste the token into **Secret**, and save. This is **Settings → Secrets and variables → Actions**, not an ordinary repository file or an Actions variable. See [GitHub's secret instructions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

The assistant cannot retrieve a stored secret's plaintext. It can review the checked-in workflow and the sanitized results of an authorized run. The Cloudflare token grants read access only to the selected zone; the workflow grants GitHub read access only and gives the token only to the audit step. Repository users who can change and run workflows are part of the secret's trust boundary.

## Run the inspection

Open [inspect Cloudflare routing](https://github.com/killjoy00/mtg-ev-analyzer/actions/workflows/cloudflare-audit.yml), select **Run workflow**, choose **main**, and run it. If the mobile page hides a control, try your browser's **Request Desktop Website** option; this does not require a desktop computer. Tell the assistant the run finished, or provide the run URL. No token value is needed in chat.

The workflow only sends GET requests to Cloudflare. It reports zone status, proxy flags and broad destination categories for the apex, `www`, `api`, `auth`, `data` and wildcard hostnames, plus Worker route patterns and whether a Worker is attached. Raw DNS targets/IPs, TXT records, account/zone IDs, script names and credentials are excluded. The filtered report appears in the job log and a seven-day artifact; visibility follows the repository's Actions access. Errors fail the workflow without printing raw API error bodies. Missing scope or oversized/incomplete pagination is not treated as an empty healthy inventory.

This first audit does not inspect Worker custom domains, redirects, WAF/rate-limit rules or TLS settings, and does not prove direct-origin bypass is blocked. It makes no DNS, security-rule, Worker, Neon or gameplay changes. Live connectivity remains unverified until the configured workflow succeeds.

After the inventory, prepare a concrete first-party routing/session plan and identify any additional scoped read/deployment permissions it needs. Do not widen this token to a global administrator key to skip that review. The existing R2 secrets are for replay storage and must not be repurposed as zone-management access. Revoke the audit token when it is no longer needed.
