import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = "synapse_google_token_v1";

export const GOOGLE_TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const GOOGLE_COMBINED_SCOPE = `${GOOGLE_TASKS_SCOPE} ${GOOGLE_CALENDAR_SCOPE}`;

type StoredToken = {
  accessToken: string;
  expiresAtMs: number;
  scope?: string;
};

function nowMs() {
  return Date.now();
}

function isValid(token: StoredToken | null) {
  if (!token?.accessToken) return false;
  // give a small buffer so we don't fail mid-request
  return token.expiresAtMs - nowMs() > 60_000;
}

async function loadStoredToken(): Promise<StoredToken | null> {
  const raw = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredToken;
  } catch {
    return null;
  }
}

async function saveStoredToken(token: StoredToken) {
  await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(token));
}

export async function disconnectGoogle() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
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
  if (!forceReauth) {
    const existing = await loadStoredToken();
    if (isValid(existing)) return existing.accessToken;
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
      // Keep this consistent with the web app behavior: always show consent so we can get both scopes.
      prompt: "consent",
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
  await saveStoredToken({ accessToken, expiresAtMs, scope: scopes });

  return accessToken;
}

