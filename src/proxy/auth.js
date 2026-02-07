export async function verifyApiKey(request, store) {
  // Support both OpenAI style (Authorization: Bearer sk-xxx)
  // and Claude style (x-api-key: sk-xxx)
  let key = null;

  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    key = auth.slice(7);
  }

  if (!key) {
    key = request.headers.get('x-api-key');
  }

  if (!key) {
    return { valid: false, error: 'Missing API key (Authorization or x-api-key header)' };
  }

  const apiKeys = await store.getApiKeys();
  const found = apiKeys.find(k => k.key === key && k.enabled);
  if (!found) {
    return { valid: false, error: 'Invalid or disabled API key' };
  }
  return { valid: true, apiKey: found };
}
