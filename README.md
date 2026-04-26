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

## Notes

- If Google is not connected, mock tasks are preloaded and manual tasks can be added.
- Urgency score is derived from due date.
- Importance score is generated from goal alignment via Groq, with a local fallback if Groq is unavailable.
