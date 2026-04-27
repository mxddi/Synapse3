# Synapse
Synapse is an AI-powered task prioritization web app that bridges the intuitive gap between your daily to-do list and your long-term goals.
Visit [the web app here.](https://synapse3-topaz.vercel.app/)

## Running locally:

1. Install dependencies:
   - `npm install`
2. Create `.env` from `.env.example` and add:
   - `REACT_APP_GROQ_KEY`
   - `REACT_APP_GOOGLE_CLIENT_ID`
3. Start the app:
   - `npm start`
4. Open [https://localhost:3000](https://localhost:3000) in your browser.

## Notes

- If Google is not connected, mock tasks are preloaded and manual tasks can be added.
- Urgency score is derived from due date.
- Importance score is generated from goal alignment via Groq, with a local fallback if Groq is unavailable.
