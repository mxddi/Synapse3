# Synapse
Synapse is an AI-powered task prioritization web app that bridges the intuitive gap between your daily to-do list and your long-term goals.
Visit [the web app here.](https://synapse3-topaz.vercel.app/)


Users begin by entering their weekly goals along with the number of hours they want to dedicate to each. Synapse then pulls in tasks directly from Google Calendar and Google Tasks—or lets users enter them manually—and automatically scores each task across two dimensions: urgency, calculated from the task's due date, and importance, determined by an AI-powered alignment check against the user's stated goals. Each task is assigned a vector and placed into one of the four quadrants of a visual Eisenhower Matrix, naturally training users to learn an intuitive mental method for task prioritization over time.
Based on a user’s goal-oriented task prioritization matrix, a Groq-powered AI coach generates personalized suggestions and alerts — flagging tasks that don't align with any of your goals, warning when your time allocations fall short of what a goal requires, and celebrating when your week is well-structured. 
Automated adjustments are made to calendar scheduling based on every task's relevancy to a user's goals and schedule availability. Users can review prioritization suggestions and accept, reject, or edit schedule adjustments based on intelligent feedback—placing the user in executive control while letting AI assist with clearing mental clutter and enhancing available time all while considering long term goals.


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
