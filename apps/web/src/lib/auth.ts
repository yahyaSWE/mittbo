import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import type { StoredUser, Store } from "./store";
import { withStore } from "./store";

export const sessionCookie = "mittbo_session";
const secretFile = path.join(process.env.MITTBO_DATA_DIR ? path.resolve(process.env.MITTBO_DATA_DIR) : path.resolve(process.cwd(), "../../data"), "session.key");

async function secret(): Promise<Buffer> {
  await mkdir(path.dirname(secretFile), { recursive: true });
  try {
    return Buffer.from(await readFile(secretFile, "utf8"), "hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const value = randomBytes(32).toString("hex");
    try { await writeFile(secretFile, value, { flag: "wx" }); }
    catch (writeError) { if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError; }
    return Buffer.from(await readFile(secretFile, "utf8"), "hex");
  }
}

export async function createSession(userId: string) {
  const payload = Buffer.from(JSON.stringify({ userId, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString("base64url");
  const signature = createHmac("sha256", await secret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

async function sessionUserId(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", await secret()).update(payload).digest();
  const provided = Buffer.from(signature, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof data.userId === "string" && typeof data.expiresAt === "number" && data.expiresAt > Date.now() ? data.userId : null;
  } catch { return null; }
}

export function publicUser(user: StoredUser) {
  const { passwordHash: _passwordHash, ...safe } = user;
  void _passwordHash;
  return safe;
}

export async function authenticated<T>(request: NextRequest, operation: (store: Store, user: StoredUser) => T | Promise<T>) {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : request.cookies.get(sessionCookie)?.value;
  const userId = await sessionUserId(token);
  if (!userId) return null;
  return withStore((store) => {
    const user = store.users.find((item) => item.id === userId);
    return user ? operation(store, user) : null;
  });
}

export async function sessionIdentity(request: NextRequest) {
  const header = request.headers.get("authorization");
  return sessionUserId(header?.startsWith("Bearer ") ? header.slice(7) : request.cookies.get(sessionCookie)?.value);
}
