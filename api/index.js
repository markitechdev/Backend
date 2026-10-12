// Vercel serverless entry point: the whole Express app handles every request.
// Local development still uses `npm run dev` (src/server.js).
import { createApp } from '../src/app.js';

export default createApp();
