const outcomes = {
  connected: 'Patreon authorization was processed. Verify the resulting membership in the app.',
  cancelled: 'Patreon authorization was cancelled. A new connection was not confirmed.',
  expired: 'This authorization request expired or was already used.',
  unavailable: 'Patreon connection is temporarily unavailable.',
  'identity-mismatch': 'A different Patreon identity is already connected. Review it in the app.',
  conflict: 'This Patreon identity could not be connected to the initiating account.',
  error: 'Patreon authorization could not be completed.',
};
const result = new URLSearchParams(location.search).get('result');
document.getElementById('outcome').textContent = Object.hasOwn(outcomes, result) ? outcomes[result] : outcomes.error;
history.replaceState(null, '', location.pathname);
