import { createApp } from "./app.js";

// Vercel entry point: the default export is the Express app. Local development uses src/local.ts.
const app = createApp();
export default app;
