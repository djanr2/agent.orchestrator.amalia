import type { Request, Response, NextFunction } from "express";
import type { DatabaseSync } from "node:sqlite";
import { identifyByToken, AuthIdentity } from "../auth.js";

declare global {
  namespace Express {
    interface Request {
      identity?: AuthIdentity;
    }
  }
}

export function authMiddleware(db: DatabaseSync) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Token requerido" });
      return;
    }
    const token = header.slice(7);
    const identity = identifyByToken(db, token);
    if (!identity) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Token inválido" });
      return;
    }
    req.identity = identity;
    next();
  };
}

export function requireOperator(req: Request, res: Response, next: NextFunction): void {
  if (!req.identity?.isOperator) {
    res.status(403).json({ error: "FORBIDDEN", message: "Se requiere rol operador" });
    return;
  }
  next();
}
