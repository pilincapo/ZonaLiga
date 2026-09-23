// Autenticación del panel: contraseña única (secret de Cloudflare)
// + sesión con cookie firmada HMAC-SHA256.

const SESSION_COOKIE = 'zl_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 días

/** Clave de desarrollo cuando no hay ADMIN_PASSWORD configurado (local). Detalle interno: el resto del mundo usa sessionSecret(). */
const DEV_SECRET_FALLBACK = 'zonaliga-dev-secret-change-me';

/** Secreto de firma de sesiones (admin y delegados). */
export function sessionSecret(env: { ADMIN_PASSWORD?: string }): string {
  return env.ADMIN_PASSWORD || DEV_SECRET_FALLBACK;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Firma `payload` como "payload.hmacB64url". Detalle interno: la sesión se usa vía create/verifySessionToken y create/verifyDelegateToken. */
async function sign(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Verifica un token firmado y devuelve el payload original, o null si es inválido. Detalle interno: ídem sign. */
async function verify(token: string, secret: string): Promise<string | null> {
  const idx = token.lastIndexOf('.');
  if (idx <= 0) return null;
  const payload = token.slice(0, idx);
  const sigB64 = token.slice(idx + 1);
  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    b64urlDecode(sigB64),
    encoder.encode(payload)
  );
  return valid ? payload : null;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const v = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(v)) return null;
    out[i] = v;
  }
  return out;
}

/** Cookie de sesión: "exp:<unix>.<nonce-hex>", firmada. */
export async function createSessionToken(secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return sign(`exp:${exp}.${nonce}`, secret);
}

/** Devuelve true si el token de sesión es válido y no expiró. */
export async function verifySessionToken(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  const payload = await verify(token, secret);
  if (!payload) return false;
  const m = /^exp:(\d+)\.[0-9a-f]+$/.exec(payload);
  if (!m) return false;
  const exp = Number(m[1]);
  return Number.isFinite(exp) && exp > Math.floor(Date.now() / 1000);
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** Detalle interno: lo consumen getSessionCookie y getDelegateCookie. */
function getCookieValue(request: Request, name: string): string | undefined {
  const cookie = request.headers.get('Cookie') ?? '';
  for (const part of cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return undefined;
}

export function getSessionCookie(request: Request): string | undefined {
  return getCookieValue(request, SESSION_COOKIE);
}

/* ---------- Sesión de delegado (un equipo por sesión) ---------- */

const DELEGATE_COOKIE = 'zl_delegate';
const DELEGATE_TTL_SECONDS = 60 * 60 * 24 * 60; // 60 días (una temporada amateur)

export interface DelegateSession {
  teamId: number;
  codeHash: string;
}

/**
 * El token incluye el hash del código de acceso: si el admin regenera o revoca
 * el código, las sesiones de ese equipo quedan invalidadas automáticamente.
 */
/** El token lleva solo este prefijo del hash del código. */
const CODE_HASH_SLICE = 16;

export async function createDelegateToken(secret: string, teamId: number, codeHash: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + DELEGATE_TTL_SECONDS;
  return sign(`team:${teamId}:${codeHash.slice(0, CODE_HASH_SLICE)}:${exp}`, secret);
}

export async function verifyDelegateToken(
  token: string | undefined,
  secret: string
): Promise<DelegateSession | null> {
  if (!token) return null;
  const payload = await verify(token, secret);
  if (!payload) return null;
  // Acepta exactamente lo que produce createDelegateToken: el prefijo del hash
  // (hasta CODE_HASH_SLICE caracteres hex).
  const m = new RegExp(`^team:(\\d+):([0-9a-f]{1,${CODE_HASH_SLICE}}):(\\d+)$`).exec(payload);
  if (!m) return null;
  const exp = Number(m[3]);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null;
  return { teamId: Number(m[1]), codeHash: m[2]! };
}

export function delegateCookieHeader(token: string): string {
  return `${DELEGATE_COOKIE}=${token}; Path=/delegado; HttpOnly; Secure; SameSite=Lax; Max-Age=${DELEGATE_TTL_SECONDS}`;
}

export function clearDelegateCookieHeader(): string {
  return `${DELEGATE_COOKIE}=; Path=/delegado; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function getDelegateCookie(request: Request): string | undefined {
  return getCookieValue(request, DELEGATE_COOKIE);
}

/** Comparación en tiempo (aproximadamente) constante para la contraseña. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Hash SHA-256 de la contraseña, para timing-insensitive comparison. */
export async function hashPassword(password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(password));
  return toHex(new Uint8Array(digest));
}
