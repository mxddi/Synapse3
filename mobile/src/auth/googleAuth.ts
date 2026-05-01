import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
WebBrowser.maybeCompleteAuthSession();

/**
 * OAuth redirect must match Google Cloud Console **exactly** (scheme, host, path, trailing slash).
 * Set `EXPO_PUBLIC_GOOGLE_REDIRECT_URI` on Vercel to your production origin (e.g. `https://synapse-mobile-pwa.vercel.app`)
 * and register that same string under Authorized redirect URIs for your OAuth client.
 */
function getGoogleOAuthRedirectUri(): string {
  const fromEnv = process.env.EXPO_PUBLIC_GOOGLE_REDIRECT_URI?.trim();
  const raw = fromEnv || AuthSession.makeRedirectUri({ scheme: "synapse3" });
  try {
    const u = new URL(raw);
    const path = u.pathname === "" ? "/" : u.pathname;
    if (path === "/" && !u.search && !u.hash) {
      return u.origin;
    }
    return u.toString();
  } catch {
    return raw;
  }
}

/** Web-application OAuth clients often require client_secret on the token endpoint; PKCE-only requests omit it. Prefer a "Desktop app" or iOS/Android OAuth client (no secret). */
function googleClientSecretFromEnv(): string | undefined {
  const s = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET?.trim();
  return s || undefined;
}

function throwGoogleOAuthHelp(err: unknown, redirectUri: string): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (/client_secret is missing|Client authentication failed/i.test(msg)) {
    throw new Error(
      `${msg}\n\n` +
        "You are using a **Web application** OAuth client. Google requires **client_secret** when exchanging the auth code at the token endpoint.\n\n" +
        "**Option A (matches your current client type):** In Google Cloud Console open this OAuth client → copy **Client secret**. In Vercel → Project → Settings → Environment Variables, add **EXPO_PUBLIC_GOOGLE_CLIENT_SECRET** with that value, then redeploy. The value is embedded in the shipped JavaScript (visible in DevTools)—treat that as acceptable only for low-risk or private use.\n\n" +
        "**Option B (no secret in the app):** Create a new OAuth client of type **Desktop app**, add the same **Authorized redirect URIs** as your Web client, set **EXPO_PUBLIC_GOOGLE_CLIENT_ID** to the new client ID, remove **EXPO_PUBLIC_GOOGLE_CLIENT_SECRET**, redeploy."
    );
  }
  if (/redirect_uri_mismatch|redirect uri mismatch/i.test(msg)) {
    throw new Error(
      `${msg}\n\n` +
        `Register this exact redirect URI in Google Cloud Console → Credentials → your OAuth client → Authorized redirect URIs:\n` +
        `  ${redirectUri}\n\n` +
        "For Web application clients, also add the same origin under Authorized JavaScript origins. " +
        "Set EXPO_PUBLIC_GOOGLE_REDIRECT_URI in Vercel to that exact URL if the app ever uses a different host (preview URLs need their own client or redirect entries)."
    );
  }
  throw err;
}

const TOKEN_KEY = "synapse_google_token_v1";

export const GOOGLE_TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
export const GOOGLE_COMBINED_SCOPE = `${GOOGLE_TASKS_SCOPE} ${GOOGLE_CALENDAR_SCOPE}`;

type StoredToken = {
  accessToken: string;
  expiresAtMs: number;
  refreshToken?: string | null;
  scope?: string;
};

function nowMs() {
  return Date.now();
}

function isAccessTokenValid(token: StoredToken | null) {
  if (!token?.accessToken) return false;
  // give a small buffer so we don't fail mid-request
  return token.expiresAtMs - nowMs() > 60_000;
}

function webStorageAvailable() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

async function loadStoredToken(): Promise<StoredToken | null> {
  try {
    const raw = await SecureStore.getItemAsync(TOKEN_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredToken;
    } catch {
      return null;
    }
  } catch {
    if (!webStorageAvailable()) return null;
    const raw = window.localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredToken;
    } catch {
      return null;
    }
  }
}

async function saveStoredToken(token: StoredToken) {
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(token));
  } catch {
    if (!webStorageAvailable()) throw new Error("Unable to persist Google token on this platform.");
    window.localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  }
}

export async function disconnectGoogle() {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    if (webStorageAvailable()) window.localStorage.removeItem(TOKEN_KEY);
  }
}

/**
 * Gets an access token that can be used for both Google Tasks and Google Calendar.
 *
 * Uses authorization code + PKCE. If `EXPO_PUBLIC_GOOGLE_CLIENT_ID` is a **Web application**
 * client, set `EXPO_PUBLIC_GOOGLE_CLIENT_SECRET` (same value as in Google Cloud Console) so
 * the token request satisfies Google; that secret is bundled in client JS. A **Desktop app**
 * OAuth client does not need a secret for this flow.
 */
export async function getGoogleAccessToken({
  clientId,
  scopes = GOOGLE_COMBINED_SCOPE,
  forceReauth = false,
}: {
  clientId: string;
  scopes?: string;
  forceReauth?: boolean;
}): Promise<string> {
  const clientSecret = googleClientSecretFromEnv();
  const redirectUri = getGoogleOAuthRedirectUri();
  const existing = forceReauth ? null : await loadStoredToken();
  if (existing?.accessToken && isAccessTokenValid(existing)) return existing.accessToken;

  // If we have a refresh token, refresh without opening a browser.
  if (!forceReauth && existing?.refreshToken) {
    const discovery = {
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
    };

    try {
      const refreshed = await AuthSession.refreshAsync(
        {
          clientId,
          clientSecret,
          refreshToken: existing.refreshToken,
        },
        discovery
      );

      const accessToken = refreshed.accessToken;
      if (!accessToken) throw new Error("Google refresh did not return an access token.");

      const expiresAtMs = refreshed.expiresIn
        ? nowMs() + refreshed.expiresIn * 1000
        : nowMs() + 3600 * 1000;

      const next: StoredToken = {
        accessToken,
        expiresAtMs,
        refreshToken: refreshed.refreshToken || existing.refreshToken,
        scope: scopes,
      };
      await saveStoredToken(next);
      return accessToken;
    } catch (err) {
      if (
        err instanceof Error &&
        (/client_secret is missing|Client authentication failed|redirect_uri_mismatch/i.test(err.message))
      ) {
        throwGoogleOAuthHelp(err, redirectUri);
      }
      // Other refresh errors: fall through to interactive auth
    }
  }

  // SDK 54+ uses AuthRequest.promptAsync / exchangeCodeAsync (AuthSession.startAsync is not available).
  const discovery = {
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
  };

  const request = new AuthSession.AuthRequest({
    clientId,
    redirectUri,
    scopes: scopes.split(" ").filter(Boolean),
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: {
      // Needed to obtain refresh tokens for long-lived sessions (best-effort).
      access_type: "offline",
      // Only force consent when explicitly re-authing; otherwise Google can return a silent-ish flow when possible.
      ...(forceReauth ? { prompt: "consent" } : {}),
      include_granted_scopes: "true",
    },
  });

  await request.makeAuthUrlAsync(discovery);
  const result = await request.promptAsync(discovery);

  if (result.type === "error" && "error" in result && result.error) {
    const errObj = result.error as Error & { params?: Record<string, string> };
    const msg = errObj.message || String((result as { params?: { error?: string; error_description?: string } }).params?.error_description || "");
    throwGoogleOAuthHelp(new Error(msg), redirectUri);
  }

  if (result.type !== "success" || !result.params?.code) {
    throw new Error("Google sign-in was cancelled or failed.");
  }

  let tokenResponse: Awaited<ReturnType<typeof AuthSession.exchangeCodeAsync>>;
  try {
    tokenResponse = await AuthSession.exchangeCodeAsync(
      {
        clientId,
        clientSecret,
        code: result.params.code,
        redirectUri,
        extraParams: { code_verifier: request.codeVerifier || "" },
      },
      discovery
    );
  } catch (err) {
    throwGoogleOAuthHelp(err, redirectUri);
  }

  const accessToken = tokenResponse.accessToken;
  if (!accessToken) throw new Error("Google auth did not return an access token.");

  const expiresAtMs = tokenResponse.expiresIn
    ? nowMs() + tokenResponse.expiresIn * 1000
    : nowMs() + 3600 * 1000;
  const refreshToken =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tokenResponse as any).refreshToken ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tokenResponse as any).refresh_token ||
    null;

  await saveStoredToken({ accessToken, expiresAtMs, refreshToken: refreshToken || undefined, scope: scopes });

  return accessToken;
}

