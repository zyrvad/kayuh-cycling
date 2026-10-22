/**
 * Who is calling.
 *
 * In production Cloudflare Access sits in front of Kayuh: people sign in with a one-time code
 * sent to their email, and Access forwards a signed JWT (`Cf-Access-Jwt-Assertion`). We verify
 * it against the team's public keys and trust only the email inside.
 *
 * Locally there is no Access, so with DEV_AUTH=1 (set only in .dev.vars, never deployed) an
 * `X-Dev-Email` header stands in for it.
 */

export interface AuthEnv {
  /** e.g. "zyrvad.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's audience (AUD) tag. */
  ACCESS_AUD?: string;
  /** "1" enables the X-Dev-Email header. Local development only. */
  DEV_AUTH?: string;
}

type Jwk = JsonWebKey & { kid?: string };
export type CertFetcher = (url: string) => Promise<{ keys: Jwk[] }>;

const KEY_TTL_MS = 60 * 60 * 1000;
let keyCache: { domain: string; at: number; keys: Map<string, CryptoKey> } | null = null;

const defaultFetcher: CertFetcher = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Access certs ${res.status}`);
  return res.json();
};

function b64urlBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const b64urlJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

async function signingKeys(domain: string, fetcher: CertFetcher, refresh = false): Promise<Map<string, CryptoKey>> {
  if (!refresh && keyCache && keyCache.domain === domain && Date.now() - keyCache.at < KEY_TTL_MS) return keyCache.keys;
  const { keys } = await fetcher(`https://${domain}/cdn-cgi/access/certs`);
  const map = new Map<string, CryptoKey>();
  for (const jwk of keys) {
    if (!jwk.kid || jwk.kty !== "RSA") continue;
    map.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
  }
  keyCache = { domain, at: Date.now(), keys: map };
  return map;
}

/** The verified email in an Access JWT, or null if the token is missing, forged or expired. */
export async function verifyAccessJwt(token: string, domain: string, aud: string, fetcher: CertFetcher = defaultFetcher): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: { alg?: string; kid?: string }, payload: { aud?: string | string[]; exp?: number; nbf?: number; iss?: string; email?: string };
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;
  const now = Math.floor(Date.now() / 1000);
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud) || !payload.exp || payload.exp < now || (payload.nbf && payload.nbf > now + 60)) return null;
  if (payload.iss !== `https://${domain}`) return null;
  let keys = await signingKeys(domain, fetcher);
  // Access rotates keys: an unknown kid means our cache is stale.
  if (!keys.has(header.kid)) keys = await signingKeys(domain, fetcher, true);
  const key = keys.get(header.kid);
  if (!key) return null;
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  return ok && typeof payload.email === "string" ? payload.email.toLowerCase() : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cookie(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

/** The signed-in email for a request, if any. */
export async function requestEmail(req: Request, env: AuthEnv, fetcher?: CertFetcher): Promise<string | null> {
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    const token = req.headers.get("Cf-Access-Jwt-Assertion") ?? cookie(req.headers.get("Cookie"), "CF_Authorization");
    if (token) {
      const email = await verifyAccessJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD, fetcher).catch(() => null);
      if (email) return email;
    }
  }
  if (env.DEV_AUTH === "1") {
    const dev = (req.headers.get("X-Dev-Email") ?? "").trim().toLowerCase();
    if (EMAIL.test(dev)) return dev;
  }
  return null;
}

/** Test hook: forget cached Access keys. */
export function resetKeyCache() {
  keyCache = null;
}
