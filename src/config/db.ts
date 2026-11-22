import mongoose from "mongoose";
import { env } from "./env.js";

mongoose.set("strictQuery", true);

const cache = globalThis as typeof globalThis & { _pizzahubMongo?: Promise<typeof mongoose> };

// One shared connection per server instance. On Vercel the same instance serves many requests,
// so the promise is cached instead of reconnecting every time.
export function connectDB() {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose);
  if (!cache._pizzahubMongo) {
    cache._pizzahubMongo = mongoose
      .connect(env.mongoUri(), {
        dbName: env.dbName(),
        serverSelectionTimeoutMS: 10_000,
        maxPoolSize: 10,
      })
      .catch((err) => {
        cache._pizzahubMongo = undefined;
        throw err;
      });
  }
  return cache._pizzahubMongo;
}
