# Synapse

Priority matrix web app that visualizes task urgency and importance in a 4x4 Eisenhower matrix.

## Run locally

1. Install dependencies:
   - `npm install`
2. Create `.env` from `.env.example` and add:
   - `REACT_APP_GROQ_KEY`
   - `REACT_APP_GOOGLE_CLIENT_ID`
3. Start the app:
   - `npm start`
4. Open [Synapse](https://synapse3-topaz.vercel.app/) in your browser.

## Google Tasks testing on localhost

To connect Google Tasks during local testing, configure your Google Cloud OAuth app (Web application type):

1. In Google Cloud Console, open **APIs & Services > Credentials**.
2. Create or edit an **OAuth 2.0 Client ID** for web.
3. Add these values:
   - **Authorized JavaScript origins**
     - `https://localhost:3000`
     - `http://localhost:3000` (recommended fallback for CRA default)
   - **Authorized redirect URIs**
     - `https://localhost:3000`
     - `http://localhost:3000`
4. Ensure **Google Tasks API** is enabled for the same project.
5. In **OAuth consent screen**, keep app type as **External** and add your test users.
6. Copy the OAuth web client ID into `REACT_APP_GOOGLE_CLIENT_ID`.

Then click **Connect Google Tasks** in the app. The browser OAuth popup returns an access token that the app uses to fetch task lists and tasks via the Google Tasks REST API.

## Notes

- If Google is not connected, mock tasks are preloaded and manual tasks can be added.
- Urgency score is derived from due date.
- Importance score is generated from goal alignment via Groq, with a local fallback if Groq is unavailable.
