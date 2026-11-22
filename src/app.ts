import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type RequestHandler } from "express";
import { connectDB } from "./config/db.js";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { menuRouter } from "./routes/menu.routes.js";
import { adminRouter } from "./routes/admin.routes.js";
import { customerRouter } from "./routes/customer.routes.js";
import { orderRouter } from "./routes/order.routes.js";
import { paymentRouter, stripeWebhook } from "./routes/payment.routes.js";
import { userRouter } from "./routes/user.routes.js";
import { vendorRouter } from "./routes/vendor.routes.js";

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

  // Raw body for signature verification, so this must come before express.json()
  app.post("/api/payments/webhook", ...stripeWebhook);

  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use("/api", withDatabase);

  app.use("/api/menu", menuRouter);
  app.use("/api/vendor", vendorRouter);
  app.use("/api/orders", orderRouter);
  app.use("/api/customer", customerRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/users", userRouter);
  app.use("/api/payments", paymentRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
