# CareerStack - Clean Render-ready version

React + Vite frontend, Express + PostgreSQL backend.

## Local
1. Create PostgreSQL database.
2. Copy `server/.env.example` to `server/.env` and set DATABASE_URL and JWT_SECRET.
3. From root: `npm install`, `npm run install-all`, `npm run dev`.
4. Frontend defaults to `http://localhost:10000/api` for local API calls.

## Render backend
This project can be deployed as a Node Web Service. If using the root repository, set Root Directory to `career-stack/server` only when the repository itself contains this folder. If your GitHub repository is the project root, use Root Directory `server`, Build `npm install`, Start `npm start`.

Environment variables: DATABASE_URL, JWT_SECRET, NODE_ENV=production.

## Render frontend
Create a Static Site from `client`: Root Directory `client`, Build `npm install && npm run build`, Publish `dist`.

For a deployed backend URL, add frontend environment variable `VITE_API_URL=https://YOUR-BACKEND.onrender.com/api` and redeploy. Without it, the frontend uses localhost for local development.
