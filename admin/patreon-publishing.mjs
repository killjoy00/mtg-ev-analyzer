// Owner-only publishing management. Do not collect Patreon credentials in this page.
export function renderPatreonPublishing(root) {
 root.innerHTML=`<section class="subpage-section" aria-labelledby="patreon-title">
  <h1 id="patreon-title">Patreon publishing</h1>
  <p class="subpage-help">Daily featured picks, with the actual draft choice among the displayed options.</p>
  <h2>Connection</h2>
  <p role="status"><strong>Not connected through Pack One</strong></p>
  <p>The previous Codespaces sign-in has been retired. A secure, owner-authorized browser connection service is still required. Pack One will not ask for Patreon passwords or session cookies here.</p>
  <h2>Automatic publishing</h2>
  <p role="status"><strong>Not enabled</strong> — no Patreon posts are being published by this integration.</p>
  <p>When connected and verified, the existing morning featured-pick automation can publish a public image-and-text post, check for duplicates and record a publication receipt.</p>
  <p><a href="https://github.com/killjoy00/mtg-ev-analyzer/pull/1367" target="_blank" rel="noopener noreferrer">Review publisher implementation</a></p>
  <p class="subpage-help">This section is read-only until secure backend authorization and a real Patreon publishing test are available. Other publishing channels are unaffected.</p>
 </section>`;
}
