import type { NextFunction, Request, RequestHandler, Response } from "express";
import { errors as joseErrors, jwtVerify } from "jose";
import { isValidObjectId } from "mongoose";
import { JWT_AUDIENCE, JWT_ISSUER, env } from "../config/env.js";
import { User, type Role, type UserDoc } from "../models/User.js";
import { HttpError } from "../utils/http.js";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: Role;
  doc: UserDoc;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

function readBearer(req: Request) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}

async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, env.jwtSecret(), {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return payload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) throw new HttpError(401, "Unauthorized: your session token has expired.");
    throw new HttpError(401, "Unauthorized: invalid session token.");
  }
}

/**
 * Verifies the short-lived HS256 token the Next.js client signs after Better Auth confirms the
 * session. Only the user id is taken from the token: role and blocked state are read fresh from
 * the database on every request, so a block or role change applies at once.
 */
export const verifyJWT: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
  const token = readBearer(req);
  if (!token) throw new HttpError(401, "Unauthorized: please sign in first.");

  const payload = await verifyToken(token);
  if (!payload.sub || !isValidObjectId(payload.sub)) throw new HttpError(401, "Unauthorized: invalid session token.");

  const user = await User.findById(payload.sub).lean<UserDoc>();
  if (!user) throw new HttpError(401, "Unauthorized: this account no longer exists.");
  if (user.isBlocked) throw new HttpError(403, "Your account has been blocked. Please contact PizzaHub support.");

  req.user = {
    id: String(user._id),
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    role: (user.role as Role) ?? "customer",
    doc: user,
  };
  next();
};

/** Optional variant for public routes that show extra data (like favourites) to signed-in users. */
export const attachUserIfPresent: RequestHandler = async (req, _res, next) => {
  const token = readBearer(req);
  if (!token) return next();
  try {
    const payload = await verifyToken(token);
    if (payload.sub && isValidObjectId(payload.sub)) {
      const user = await User.findById(payload.sub).lean<UserDoc>();
      if (user && !user.isBlocked) {
        req.user = { id: String(user._id), name: user.name, email: user.email, image: user.image ?? null, role: user.role as Role, doc: user };
      }
    }
  } catch {
    // A bad token on a public route is simply ignored
  }
  next();
};

/** Use after verifyJWT. Returns 403 when the signed-in user's role is not allowed. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw new HttpError(401, "Unauthorized: please sign in first.");
    if (!roles.includes(req.user.role)) {
      throw new HttpError(403, `Forbidden: this action is only for ${roles.join(" or ")} accounts.`);
    }
    next();
  };
}

export const verifyAdmin = requireRole("admin");
export const verifyVendor = requireRole("vendor");
export const verifyCustomer = requireRole("customer");
