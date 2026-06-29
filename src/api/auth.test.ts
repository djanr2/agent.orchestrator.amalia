import { test, expect } from "vitest";
import { generateToken, hashToken } from "./auth.js";

test("genera token de 64 hex y su hash es estable", () => {
  const t = generateToken();
  expect(t).toMatch(/^[0-9a-f]{64}$/);
  expect(hashToken(t)).toBe(hashToken(t));
  expect(hashToken(t)).not.toBe(t);
});
