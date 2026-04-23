async function verifyRecaptcha(token, secret) {
  if (!token || !secret) return { success: false };
  const body = new URLSearchParams({ secret, response: token });
  const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST', body,
  });
  if (!res.ok) return { success: false };
  const data = await res.json();
  return { success: !!data.success };
}

module.exports = { verifyRecaptcha };
