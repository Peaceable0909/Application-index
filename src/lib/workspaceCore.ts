// Pure helpers (no database, no cookies) so both auth.ts and workspace.ts can use them.
export const DEFAULT_WS = 'uk';
export const WS_COOKIE = 'ws';

type Who = { role: 'admin' | 'staff' | 'counselor'; workspaces?: string[] | null };

/** Admins open every workspace; everyone else only the ones they were given. */
export const mayOpen = (s: Who, ws: string) => s.role === 'admin' || (s.workspaces || [DEFAULT_WS]).includes(ws);
export const keysFor = (s: Who, all: string[]) => (s.role === 'admin' ? all : all.filter((k) => (s.workspaces || [DEFAULT_WS]).includes(k)));

/** A student_key for a non-default workspace is prefixed, so the same person in two countries is never merged. */
export const wsKey = (ws: string, key: string) => (ws === DEFAULT_WS ? key : `${ws}:${key}`);
