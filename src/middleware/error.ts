import type { ErrorRequestHandler, RequestHandler } from "express";
import mongoose from "mongoose";
import { HttpError } from "../utils/http.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ success: false, message: err.message, details: err.details });
    return;
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const first = Object.values(err.errors)[0]?.message ?? "Invalid data.";
    res.status(400).json({ success: false, message: first });
    return;
  }
  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({ success: false, message: `Invalid ${err.path}.` });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ success: false, message: "The request body is not valid JSON." });
    return;
  }
  if (err?.code === 11000) {
    res.status(409).json({ success: false, message: "This record already exists." });
    return;
  }
  console.error(err);
  res.status(500).json({ success: false, message: "Something went wrong on our side. Please try again." });
};
