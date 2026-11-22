import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type RequestHandler } from "express";
import { connectDB } from "./config/db.js";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { menuRouter } from "./routes/menu.routes.js";

const withDatabase: RequestHandler = async (_req, _res, next) => {
  await connectDB();
  next();
};

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  const allowed = env.clientUrls();
  app.use(
    cors({
      origin(origin, callback) {
        // Server-to-server calls (Next.js server components, Stripe) send no Origin header
        if (!origin || allowed.includes(origin.replace(/\/$/, ""))) return callback(null, true);
        callback(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.get("/", (_req, res) => {
    res.json({ success: true, name: "PizzaHub API", status: "running", docs: "See the README for every endpoint." });
  });
  app.get("/api/health", (_req, res) => {
    res.json({ success: true, status: "ok", time: new Date().toISOString() });
  });

  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use("/api", withDatabase);

  app.use("/api/menu", menuRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
