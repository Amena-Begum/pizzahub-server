// Vercel runs the whole Express app as one serverless function; vercel.json sends every path here.
import { createApp } from "../src/create-app.js";

const app = createApp();
export default app;
