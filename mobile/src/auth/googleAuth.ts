import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();

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
 * For internal builds we keep this simple: we request a short-lived access token and
 * re-auth when it expires (no refresh token flow).
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
  const existing = forceReauth ? null : await loadStoredToken();
  if (existing?.accessToken && isAccessTokenValid(existing)) return existing.accessToken;

  // If we have a refresh token, refresh without opening a browser.
  if (!forceReauth && existing?.refreshToken) {
    const redirectUri = AuthSession.makeRedirectUri({ scheme: "synapse3" });
    const discovery = {
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
    };

    try {
      const refreshed = await AuthSession.refreshAsync(
        {
          clientId,
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
    } catch {
      // fall through to interactive auth
    }
  }

  // SDK 54+ uses AuthRequest.promptAsync / exchangeCodeAsync (AuthSession.startAsync is not available).
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "synapse3",
  });

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

  if (result.type !== "success" || !result.params?.code) {
    throw new Error("Google sign-in was cancelled or failed.");
  }

  const tokenResponse = await AuthSession.exchangeCodeAsync(
    {
      clientId,
      code: result.params.code,
      redirectUri,
      extraParams: { code_verifier: request.codeVerifier || "" },
    },
    discovery
  );

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

