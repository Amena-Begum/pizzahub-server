import { createApp } from "./app.js";
import { env } from "./config/env.js";

const port = env.port();
createApp().listen(port, () => console.log(`PizzaHub API listening on http://localhost:${port}`));
