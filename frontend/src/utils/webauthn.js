/**
 * Minimal WebAuthn browser helpers.
 *
 * Written by hand rather than pulling in @simplewebauthn/browser so the
 * base64url conversions the API expects are visible in one small file.
 */

export const isWebAuthnSupported = () =>
  typeof window !== 'undefined' &&
  Boolean(window.PublicKeyCredential) &&
  Boolean(navigator.credentials?.create);

/** True when the device has a built-in authenticator (fingerprint / face). */
export async function hasPlatformAuthenticator() {
  if (!isWebAuthnSupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

const toBuffer = (base64url) => {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
};

const toBase64Url = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Runs navigator.credentials.create() against server-issued options. */
export async function createCredential(options) {
  const publicKey = {
    ...options,
    challenge: toBuffer(options.challenge),
    user: { ...options.user, id: toBuffer(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((cred) => ({
      ...cred,
      id: toBuffer(cred.id)
    }))
  };

  const credential = await navigator.credentials.create({ publicKey });
  if (!credential) throw new Error('No credential was created');

  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toBase64Url(credential.response.clientDataJSON),
      attestationObject: toBase64Url(credential.response.attestationObject),
      transports: credential.response.getTransports?.() || []
    }
  };
}

/** Runs navigator.credentials.get() against server-issued options. */
export async function getAssertion(options) {
  const publicKey = {
    ...options,
    challenge: toBuffer(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((cred) => ({
      ...cred,
      id: toBuffer(cred.id)
    }))
  };

  const credential = await navigator.credentials.get({ publicKey });
  if (!credential) throw new Error('No credential was returned');

  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toBase64Url(credential.response.clientDataJSON),
      authenticatorData: toBase64Url(credential.response.authenticatorData),
      signature: toBase64Url(credential.response.signature),
      userHandle: credential.response.userHandle
        ? toBase64Url(credential.response.userHandle)
        : null
    }
  };
}
