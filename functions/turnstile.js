async function verifyTurnstile(token, secret, remoteip) {
  if (!token || !secret) return { success: false };
  const body = new URLSearchParams({ secret, response: token });
  if (remoteip) body.set('remoteip', remoteip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', body,
  });
  if (!res.ok) return { success: false };
  const data = await res.json();
  return { success: !!data.success };
}

module.exports = { verifyTurnstile };
