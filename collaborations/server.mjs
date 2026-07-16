#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import { Awareness } from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const host = process.env.LATEXDO_COLLAB_HOST || "127.0.0.1";
const port = numberEnv("LATEXDO_COLLAB_PORT", 8787);
const dataDir = path.resolve(
  process.env.LATEXDO_COLLAB_DATA_DIR || path.join(repoRoot, "collaborations-data"),
);
const publicOrigin = (process.env.LATEXDO_COLLAB_PUBLIC_ORIGIN || "").replace(
  /\/+$/,
  "",
);
const shareUrlBase =
  process.env.LATEXDO_COLLAB_SHARE_URL_BASE || "https://editor.latexdo.org/";
const allowedOrigins = parseCsv(process.env.LATEXDO_COLLAB_ALLOWED_ORIGINS || "*");
const maxJsonBytes = numberEnv("LATEXDO_COLLAB_MAX_JSON_BYTES", 1024 * 1024);
const maxFileBytes = numberEnv("LATEXDO_COLLAB_MAX_FILE_BYTES", 2 * 1024 * 1024);
const maxProjectBytes = numberEnv("LATEXDO_COLLAB_MAX_PROJECT_BYTES", 20 * 1024 * 1024);
const maxProjectFiles = numberEnv("LATEXDO_COLLAB_MAX_PROJECT_FILES", 500);
const maxWebSocketFrameBytes = numberEnv(
  "LATEXDO_COLLAB_MAX_WS_FRAME_BYTES",
  512 * 1024,
);
const presenceTtlMs = numberEnv("LATEXDO_COLLAB_PRESENCE_TTL_MS", 45_000);
const roomPersistDelayMs = numberEnv("LATEXDO_COLLAB_ROOM_PERSIST_DELAY_MS", 250);

const wsGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const messageSync = 0;
const messageAwareness = 1;
const messageProjectPresence = 4;
const syncMessageUpdate = 2;

const rooms = new Map();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseCsv(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function now() {
  return Date.now();
}

function randomId(prefix) {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function projectDir(projectId) {
  return path.join(dataDir, "projects", projectId);
}

function projectFilesDir(projectId) {
  return path.join(projectDir(projectId), "files");
}

function projectMetaPath(projectId) {
  return path.join(projectDir(projectId), "project.json");
}

function sharesIndexPath() {
  return path.join(dataDir, "shares.json");
}

async function atomicWriteJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function atomicWriteText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, value, "utf8");
  await rename(temporaryPath, filePath);
}

async function readSharesIndex() {
  const parsed = safeJsonParse(
    await readFile(sharesIndexPath(), "utf8").catch(() => "{}"),
    {},
  );
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

async function writeSharesIndex(index) {
  await atomicWriteJson(sharesIndexPath(), index);
}

async function readProjectMeta(projectId) {
  if (!/^[a-z0-9_]{10,80}$/i.test(projectId)) {
    throw new HttpError(400, "Invalid project id.");
  }
  const parsed = safeJsonParse(
    await readFile(projectMetaPath(projectId), "utf8").catch(() => ""),
    null,
  );
  if (!parsed || parsed.schemaVersion !== 1 || parsed.id !== projectId) {
    throw new HttpError(404, "Project not found.");
  }
  parsed.permissions =
    parsed.permissions && typeof parsed.permissions === "object"
      ? parsed.permissions
      : {};
  parsed.presence =
    parsed.presence && typeof parsed.presence === "object" ? parsed.presence : {};
  return parsed;
}

async function writeProjectMeta(meta) {
  meta.updatedAt = now();
  await atomicWriteJson(projectMetaPath(meta.id), meta);
}

async function createProject(identity, folderName) {
  const timestamp = now();
  const projectId = randomId("project");
  const name = cleanProjectName(folderName) || "LatexDo Shared Project";
  const meta = {
    schemaVersion: 1,
    id: projectId,
    name,
    ownerSession: identity.sessionId,
    createdAt: timestamp,
    updatedAt: timestamp,
    shareToken: null,
    permissions: {
      [identity.clientId]: {
        clientId: identity.clientId,
        name: identity.clientName,
        role: "admin",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
    presence: {},
  };
  await mkdir(projectFilesDir(projectId), { recursive: true });
  await writeProjectMeta(meta);
  return openProject(meta);
}

function cleanProjectName(value) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function openProject(meta) {
  return { id: meta.id, rootPath: "", name: meta.name };
}

function isAllowedOrigin(origin) {
  if (!origin || allowedOrigins.includes("*")) return true;
  return allowedOrigins.includes(origin);
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  const allowOrigin = isAllowedOrigin(origin) ? origin || "*" : "null";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers":
      "content-type,x-latexdo-session,x-latexdo-client,x-latexdo-client-name,x-latexdo-share-token,x-latexdo-project-id",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function sendJson(response, request, status, body) {
  const payload = body === undefined ? "" : `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    ...corsHeaders(request),
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function sendEmpty(response, request, status = 204) {
  response.writeHead(status, {
    ...corsHeaders(request),
    "cache-control": "no-store",
  });
  response.end();
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.byteLength;
    if (total > maxJsonBytes) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
}

function requestIdentity(request, url) {
  const sessionId = cleanHeader(
    request.headers["x-latexdo-session"] || url.searchParams.get("session"),
    160,
  );
  const clientId = cleanHeader(
    request.headers["x-latexdo-client"] || url.searchParams.get("clientId"),
    160,
  );
  if (!sessionId || !clientId) {
    throw new HttpError(400, "Missing LatexDo collaboration identity headers.");
  }
  return {
    sessionId,
    clientId,
    clientName:
      cleanHeader(
        request.headers["x-latexdo-client-name"] || url.searchParams.get("name"),
        80,
      ) || "Anonymous",
  };
}

function cleanHeader(value, maxLength) {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === "string" ? text.trim().slice(0, maxLength) : "";
}

function requestShareToken(request, url) {
  return cleanHeader(
    request.headers["x-latexdo-share-token"] || url.searchParams.get("share"),
    256,
  );
}

function roleRank(role) {
  return role === "admin" ? 3 : role === "editor" ? 2 : role === "viewer" ? 1 : 0;
}

function roleForProject(meta, identity, token) {
  const existing = meta.permissions[identity.clientId];
  if (existing?.role) return existing.role;
  if (meta.ownerSession === identity.sessionId) return "admin";
  if (token && token === meta.shareToken) return "editor";
  return null;
}

function ensureProjectPermission(meta, identity, role) {
  const existing = meta.permissions[identity.clientId];
  const nextRole = meta.ownerSession === identity.sessionId ? "admin" : role;
  if (existing && existing.name === identity.clientName && existing.role === nextRole) {
    return false;
  }
  meta.permissions[identity.clientId] = {
    clientId: identity.clientId,
    name: identity.clientName,
    role: nextRole,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  };
  return true;
}

async function authorizeProject(request, url, projectId, minimumRole = "viewer") {
  const identity = requestIdentity(request, url);
  const token = requestShareToken(request, url);
  const meta = await readProjectMeta(projectId);
  const role = roleForProject(meta, identity, token);
  if (!role || roleRank(role) < roleRank(minimumRole)) {
    throw new HttpError(403, "You do not have access to this project.");
  }
  const changed = ensureProjectPermission(meta, identity, role);
  if (changed) await writeProjectMeta(meta);
  return { meta, identity, token, role };
}

async function authorizeShare(request, url, token, minimumRole = "viewer") {
  const index = await readSharesIndex();
  const projectId = index[token];
  if (!projectId) {
    throw new HttpError(404, "Share token not found.");
  }
  url.searchParams.set("share", token);
  return authorizeProject(request, url, projectId, minimumRole);
}

async function ensureShare(meta) {
  if (meta.shareToken) return meta.shareToken;
  const token = randomToken();
  meta.shareToken = token;
  const index = await readSharesIndex();
  index[token] = meta.id;
  await writeSharesIndex(index);
  await writeProjectMeta(meta);
  return token;
}

function shareUrl(token) {
  try {
    const url = new URL(shareUrlBase);
    url.hash = new URLSearchParams({ share: token }).toString();
    return url.toString();
  } catch {
    return undefined;
  }
}

function permissionList(meta, currentClientId) {
  return Object.values(meta.permissions)
    .filter((permission) => permission && typeof permission.clientId === "string")
    .sort((left, right) => {
      const rankDelta = roleRank(right.role) - roleRank(left.role);
      if (rankDelta) return rankDelta;
      return String(left.name).localeCompare(String(right.name));
    })
    .map((permission) => ({
      clientId: permission.clientId,
      name: permission.name || "Anonymous",
      role: isRole(permission.role) ? permission.role : "viewer",
      isCurrent: permission.clientId === currentClientId || undefined,
    }));
}

function activePresence(meta) {
  const cutoff = now() - presenceTtlMs;
  return Object.values(meta.presence)
    .filter((user) => user && user.lastSeen >= cutoff)
    .slice(0, 50)
    .map((user) => ({
      clientId: user.clientId,
      name: user.name || "Anonymous",
      currentFile:
        typeof user.currentFile === "string" && user.currentFile
          ? user.currentFile
          : null,
      lastSeen: user.lastSeen,
      role: meta.permissions[user.clientId]?.role || "viewer",
    }));
}

function collaborationState(meta, identity, role) {
  const token = meta.shareToken || undefined;
  return {
    enabled: Boolean(token),
    ...(token ? { token, shareUrl: shareUrl(token) } : {}),
    projectId: meta.id,
    projectName: meta.name,
    users: activePresence(meta),
    currentUserRole: role,
    isAdmin: role === "admin",
  };
}

function isRole(value) {
  return value === "admin" || value === "editor" || value === "viewer";
}

function updatePresence(meta, identity, currentFile) {
  meta.presence[identity.clientId] = {
    clientId: identity.clientId,
    name: identity.clientName,
    currentFile: currentFile || null,
    lastSeen: now(),
  };
}

function normalizeRelativePath(value, { allowEmpty = false } = {}) {
  const raw = typeof value === "string" ? value.trim().replaceAll("\\", "/") : "";
  if (!raw && !allowEmpty) throw new HttpError(400, "Missing file path.");
  if (raw.length > 512) throw new HttpError(400, "File path is too long.");
  if (raw.startsWith("/") || raw.split("/").includes("..")) {
    throw new HttpError(400, "Invalid file path.");
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === ".") return allowEmpty ? "" : failPath();
  if (normalized.startsWith("../") || normalized === "..") failPath();
  return normalized;
}

function failPath() {
  throw new HttpError(400, "Invalid file path.");
}

function filePathFor(projectId, relativePath) {
  const root = projectFilesDir(projectId);
  const fullPath = path.resolve(root, relativePath);
  const resolvedRoot = path.resolve(root);
  if (fullPath !== resolvedRoot && !fullPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new HttpError(400, "Invalid file path.");
  }
  return fullPath;
}

async function readProjectFile(projectId, relativePath) {
  const fullPath = filePathFor(projectId, relativePath);
  let fileStat;
  try {
    fileStat = await stat(fullPath);
  } catch {
    throw new HttpError(404, "File not found.");
  }
  if (!fileStat.isFile()) throw new HttpError(400, "Path is not a file.");
  if (fileStat.size > maxFileBytes) throw new HttpError(413, "File is too large.");
  return readFile(fullPath, "utf8");
}

async function writeProjectFile(projectId, relativePath, content) {
  if (typeof content !== "string") {
    throw new HttpError(400, "File content must be a string.");
  }
  if (Buffer.byteLength(content, "utf8") > maxFileBytes) {
    throw new HttpError(413, "File is too large.");
  }
  await assertProjectQuota(projectId, relativePath, Buffer.byteLength(content, "utf8"));
  await atomicWriteText(filePathFor(projectId, relativePath), content);
  const room = rooms.get(roomKey(projectId, relativePath));
  if (room) {
    setRoomText(room, content, "http-write");
  }
}

async function assertProjectQuota(projectId, incomingPath, incomingBytes) {
  let fileCount = 0;
  let totalBytes = incomingBytes;
  const root = projectFilesDir(projectId);
  const incomingFullPath = filePathFor(projectId, incomingPath);
  const incomingExists = await exists(incomingFullPath);
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile()) {
        fileCount += 1;
        if (entryPath !== incomingFullPath) {
          totalBytes += (await stat(entryPath)).size;
        }
      }
    }
  }
  await walk(root);
  if (fileCount + (incomingExists ? 0 : 1) > maxProjectFiles) {
    throw new HttpError(413, "Project has too many files.");
  }
  if (totalBytes > maxProjectBytes) {
    throw new HttpError(413, "Project is too large.");
  }
}

async function listProjectFiles(projectId) {
  const root = projectFilesDir(projectId);
  await mkdir(root, { recursive: true });
  return listDirectory(root, "");
}

async function listDirectory(root, relativePath) {
  const directory = relativePath ? path.join(root, relativePath) : root;
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const result = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const childRelativePath = relativePath
      ? `${relativePath}/${entry.name}`
      : entry.name;
    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: childRelativePath,
        relativePath: childRelativePath,
        type: "directory",
        children: await listDirectory(root, childRelativePath),
      });
    } else if (entry.isFile()) {
      result.push({
        name: entry.name,
        path: childRelativePath,
        relativePath: childRelativePath,
        type: "file",
      });
    }
  }
  return result;
}

async function createEntry(projectId, relativePath, type) {
  const fullPath = filePathFor(projectId, relativePath);
  if (await exists(fullPath)) {
    throw new HttpError(409, `"${relativePath}" already exists.`);
  }
  if (type === "directory") {
    await mkdir(fullPath, { recursive: true });
    return relativePath;
  }
  if (type === "file") {
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeProjectFile(projectId, relativePath, "");
    return relativePath;
  }
  throw new HttpError(400, "Entry type must be file or directory.");
}

async function moveEntry(projectId, fromRelativePath, toRelativePath) {
  const fromPath = filePathFor(projectId, fromRelativePath);
  const toPath = filePathFor(projectId, toRelativePath);
  if (!(await exists(fromPath))) throw new HttpError(404, "Source path not found.");
  if (await exists(toPath)) throw new HttpError(409, "Destination already exists.");
  if (toRelativePath.startsWith(`${fromRelativePath}/`)) {
    throw new HttpError(400, "Cannot move a folder into itself.");
  }
  await mkdir(path.dirname(toPath), { recursive: true });
  await rename(fromPath, toPath);
  for (const [key, room] of rooms) {
    if (
      room.projectId === projectId &&
      (room.relativePath === fromRelativePath ||
        room.relativePath.startsWith(`${fromRelativePath}/`))
    ) {
      rooms.delete(key);
      room.closeAll(1012, "File moved");
    }
  }
  return toRelativePath;
}

async function exists(filePath) {
  return stat(filePath)
    .then(() => true)
    .catch(() => false);
}

async function handleHttp(request, response) {
  const url = new URL(
    request.url || "/",
    publicOrigin || `http://${request.headers.host}`,
  );
  if (!isAllowedOrigin(request.headers.origin)) {
    throw new HttpError(403, "Origin is not allowed.");
  }
  if (request.method === "OPTIONS") {
    sendEmpty(response, request);
    return;
  }

  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, request, 200, {
      ok: true,
      product: "LatexDo collaborations",
      version: 1,
      compilation: "client-local",
      websocket: true,
    });
    return;
  }

  if (parts[0] === "api" && parts[1] === "projects" && parts.length === 2) {
    if (request.method === "GET") {
      const identity = requestIdentity(request, url);
      const projects = await listOwnedProjects(identity.sessionId);
      sendJson(response, request, 200, { projects });
      return;
    }
    if (request.method === "POST") {
      const identity = requestIdentity(request, url);
      const body = await readJsonBody(request);
      const project = await createProject(identity, body.folderName || body.name);
      sendJson(response, request, 200, project);
      return;
    }
  }

  if (
    parts[0] === "api" &&
    parts[1] === "projects" &&
    parts[2] === "open" &&
    parts.length === 3 &&
    request.method === "POST"
  ) {
    const identity = requestIdentity(request, url);
    const projects = await listOwnedProjects(identity.sessionId);
    if (projects[0]) {
      sendJson(
        response,
        request,
        200,
        openProject(await readProjectMeta(projects[0].id)),
      );
      return;
    }
    sendJson(response, request, 200, await createProject(identity));
    return;
  }

  if (parts[0] === "api" && parts[1] === "projects" && parts.length >= 3) {
    await handleProjectRoute(request, response, url, parts);
    return;
  }

  if (parts[0] === "api" && parts[1] === "shares" && parts.length >= 3) {
    await handleShareRoute(request, response, url, parts);
    return;
  }

  if (
    parts[0] === "api" &&
    parts[1] === "import" &&
    (parts[2] === "docx" || parts[2] === "markdown")
  ) {
    throw new HttpError(
      501,
      "Hosted import conversion is not configured on this collaboration server.",
    );
  }

  throw new HttpError(404, "Route not found.");
}

async function listOwnedProjects(sessionId) {
  const root = path.join(dataDir, "projects");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const meta = await readProjectMeta(entry.name);
      if (meta.ownerSession === sessionId) {
        projects.push({ id: meta.id, name: meta.name, updatedAt: meta.updatedAt });
      }
    } catch {
      // Ignore malformed project directories.
    }
  }
  return projects.sort((left, right) => right.updatedAt - left.updatedAt);
}

async function handleProjectRoute(request, response, url, parts) {
  const projectId = parts[2];
  const route = parts.slice(3).join("/");

  if (route === "files" && request.method === "GET") {
    await authorizeProject(request, url, projectId, "viewer");
    sendJson(response, request, 200, await listProjectFiles(projectId));
    return;
  }

  if (route === "files" && request.method === "POST") {
    await authorizeProject(request, url, projectId, "editor");
    const body = await readJsonBody(request);
    const relativePath = normalizeRelativePath(body.relativePath);
    const created = await createEntry(projectId, relativePath, body.type);
    sendJson(response, request, 200, { relativePath: created });
    return;
  }

  if (route === "files/content") {
    const relativePath = normalizeRelativePath(url.searchParams.get("path"));
    if (request.method === "GET") {
      await authorizeProject(request, url, projectId, "viewer");
      sendJson(response, request, 200, {
        content: await readProjectFile(projectId, relativePath),
      });
      return;
    }
    if (request.method === "PUT") {
      await authorizeProject(request, url, projectId, "editor");
      const body = await readJsonBody(request);
      await writeProjectFile(projectId, relativePath, body.content);
      sendEmpty(response, request);
      return;
    }
  }

  if (route === "files/exists" && request.method === "GET") {
    await authorizeProject(request, url, projectId, "viewer");
    const relativePath = normalizeRelativePath(url.searchParams.get("path"));
    sendJson(response, request, 200, {
      exists: await exists(filePathFor(projectId, relativePath)),
    });
    return;
  }

  if (route === "files/move" && request.method === "POST") {
    await authorizeProject(request, url, projectId, "editor");
    const body = await readJsonBody(request);
    const moved = await moveEntry(
      projectId,
      normalizeRelativePath(body.fromRelativePath),
      normalizeRelativePath(body.toRelativePath),
    );
    sendJson(response, request, 200, { relativePath: moved });
    return;
  }

  if (route === "share" && (request.method === "GET" || request.method === "POST")) {
    const { meta, identity, role } = await authorizeProject(
      request,
      url,
      projectId,
      request.method === "POST" ? "admin" : "viewer",
    );
    if (request.method === "POST") await ensureShare(meta);
    sendJson(response, request, 200, collaborationState(meta, identity, role));
    return;
  }

  if (route === "files/collaborate") {
    throw new HttpError(426, "Use WebSocket upgrade for collaboration.");
  }

  throw new HttpError(404, "Project route not found.");
}

async function handleShareRoute(request, response, url, parts) {
  const token = parts[2];
  const route = parts.slice(3).join("/");

  if (route === "open" && request.method === "POST") {
    const { meta, identity, role } = await authorizeShare(
      request,
      url,
      token,
      "viewer",
    );
    updatePresence(meta, identity, null);
    await writeProjectMeta(meta);
    broadcastProjectPresence(meta.id, activePresence(meta));
    sendJson(response, request, 200, {
      project: openProject(meta),
      collaboration: collaborationState(meta, identity, role),
    });
    return;
  }

  if (route === "presence" && request.method === "POST") {
    const { meta, identity, role } = await authorizeShare(
      request,
      url,
      token,
      "viewer",
    );
    const body = await readJsonBody(request);
    const currentFile =
      body.currentFile === null || body.currentFile === undefined
        ? null
        : normalizeRelativePath(body.currentFile);
    updatePresence(meta, identity, currentFile);
    await writeProjectMeta(meta);
    const users = activePresence(meta);
    broadcastProjectPresence(meta.id, users);
    sendJson(response, request, 200, {
      ...collaborationState(meta, identity, role),
      users,
    });
    return;
  }

  if (route === "permissions" && request.method === "GET") {
    const { meta, identity, role } = await authorizeShare(
      request,
      url,
      token,
      "viewer",
    );
    sendJson(response, request, 200, {
      permissions: permissionList(meta, identity.clientId),
      isAdmin: role === "admin",
      currentUserRole: role,
    });
    return;
  }

  if (route === "permissions" && request.method === "PUT") {
    const { meta, identity } = await authorizeShare(request, url, token, "admin");
    const body = await readJsonBody(request);
    if (!isRole(body.role) || typeof body.clientId !== "string") {
      throw new HttpError(400, "Invalid permission update.");
    }
    if (body.clientId === identity.clientId) {
      throw new HttpError(400, "You cannot change your own role.");
    }
    const existing = meta.permissions[body.clientId];
    if (!existing) throw new HttpError(404, "Collaborator not found.");
    existing.role = body.role;
    existing.updatedAt = now();
    await writeProjectMeta(meta);
    const updated = {
      clientId: existing.clientId,
      name: existing.name,
      role: existing.role,
    };
    sendJson(response, request, 200, updated);
    return;
  }

  if (route.startsWith("collaborators/") && request.method === "DELETE") {
    const { meta, identity } = await authorizeShare(request, url, token, "admin");
    const clientIdToRemove = parts[4];
    if (!clientIdToRemove || clientIdToRemove === identity.clientId) {
      throw new HttpError(400, "Invalid collaborator removal.");
    }
    if (!meta.permissions[clientIdToRemove]) {
      throw new HttpError(404, "Collaborator not found.");
    }
    const remainingAdmins = Object.values(meta.permissions).filter(
      (permission) =>
        permission.clientId !== clientIdToRemove && permission.role === "admin",
    );
    if (!remainingAdmins.length) {
      throw new HttpError(400, "A project must keep at least one admin.");
    }
    delete meta.permissions[clientIdToRemove];
    delete meta.presence[clientIdToRemove];
    await writeProjectMeta(meta);
    closeClientConnections(meta.id, clientIdToRemove, 1008, "Removed from project");
    broadcastProjectPresence(meta.id, activePresence(meta));
    sendEmpty(response, request);
    return;
  }

  throw new HttpError(404, "Share route not found.");
}

function roomKey(projectId, relativePath) {
  return `${projectId}:${relativePath}`;
}

async function getRoom(projectId, relativePath) {
  const key = roomKey(projectId, relativePath);
  const existing = rooms.get(key);
  if (existing) return existing;

  const doc = new Y.Doc();
  const text = doc.getText("content");
  const initialContent = await readProjectFile(projectId, relativePath).catch(
    (error) => {
      if (error instanceof HttpError && error.status === 404) return "";
      throw error;
    },
  );
  doc.transact(() => text.insert(0, initialContent), "initial-load");
  const awareness = new Awareness(doc);
  const conns = new Set();
  const room = {
    projectId,
    relativePath,
    doc,
    text,
    awareness,
    conns,
    persistTimer: null,
    closeAll(code, reason) {
      for (const conn of Array.from(conns)) {
        conn.close(code, reason);
      }
      doc.destroy();
    },
  };

  doc.on("update", (update, origin) => {
    scheduleRoomPersist(room);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    broadcastRoom(room, encoding.toUint8Array(encoder), origin);
  });

  awareness.on("update", ({ added, updated, removed }, origin) => {
    if (origin?.controlledAwarenessIds) {
      for (const id of added.concat(updated)) origin.controlledAwarenessIds.add(id);
      for (const id of removed) origin.controlledAwarenessIds.delete(id);
    }
    const changed = added.concat(updated, removed);
    if (!changed.length) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
    );
    broadcastRoom(room, encoding.toUint8Array(encoder), origin);
  });

  rooms.set(key, room);
  return room;
}

function setRoomText(room, content, origin) {
  if (room.text.toString() === content) return;
  room.doc.transact(() => {
    room.text.delete(0, room.text.length);
    room.text.insert(0, content);
  }, origin);
}

function scheduleRoomPersist(room) {
  if (room.persistTimer) clearTimeout(room.persistTimer);
  room.persistTimer = setTimeout(() => {
    room.persistTimer = null;
    void atomicWriteText(
      filePathFor(room.projectId, room.relativePath),
      room.text.toString(),
    ).catch((error) => {
      console.error("Could not persist collaboration room", {
        projectId: room.projectId,
        relativePath: room.relativePath,
        error,
      });
    });
  }, roomPersistDelayMs);
}

function broadcastRoom(room, message, origin) {
  for (const conn of room.conns) {
    if (conn !== origin) conn.sendBinary(message);
  }
}

function encodeProjectPresence(users) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageProjectPresence);
  encoding.writeVarString(encoder, JSON.stringify({ version: 1, users }));
  return encoding.toUint8Array(encoder);
}

function broadcastProjectPresence(projectId, users) {
  const frame = encodeProjectPresence(users);
  for (const room of rooms.values()) {
    if (room.projectId === projectId) {
      broadcastRoom(room, frame, null);
    }
  }
}

function closeClientConnections(projectId, clientId, code, reason) {
  for (const room of rooms.values()) {
    if (room.projectId !== projectId) continue;
    for (const conn of Array.from(room.conns)) {
      if (conn.identity.clientId === clientId) conn.close(code, reason);
    }
  }
}

async function handleUpgrade(request, socket, head) {
  try {
    const url = new URL(
      request.url || "/",
      publicOrigin || `http://${request.headers.host}`,
    );
    if (!isAllowedOrigin(request.headers.origin)) {
      throw new HttpError(403, "Origin is not allowed.");
    }
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (
      parts[0] !== "api" ||
      parts[1] !== "projects" ||
      parts[3] !== "files" ||
      parts[4] !== "collaborate"
    ) {
      throw new HttpError(404, "WebSocket route not found.");
    }
    const projectId = parts[2];
    const relativePath = normalizeRelativePath(url.searchParams.get("path"));
    const auth = await authorizeProject(request, url, projectId, "viewer");
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") throw new HttpError(400, "Missing WebSocket key.");
    const accept = createHash("sha1").update(`${key}${wsGuid}`).digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "\r\n",
      ].join("\r\n"),
    );

    const room = await getRoom(projectId, relativePath);
    const conn = new CollaborationConnection(socket, room, auth.identity, auth.role);
    room.conns.add(conn);
    updatePresence(auth.meta, auth.identity, relativePath);
    await writeProjectMeta(auth.meta);
    broadcastProjectPresence(projectId, activePresence(auth.meta));
    conn.sendSyncStep1();
    conn.sendAwarenessStates();
    if (head?.byteLength) conn.receive(head);
  } catch (error) {
    socket.write(
      `HTTP/1.1 ${error.status || 500} ${http.STATUS_CODES[error.status || 500] || "Error"}\r\nConnection: close\r\n\r\n`,
    );
    socket.destroy();
  }
}

class CollaborationConnection {
  constructor(socket, room, identity, role) {
    this.socket = socket;
    this.room = room;
    this.identity = identity;
    this.role = role;
    this.buffer = Buffer.alloc(0);
    this.controlledAwarenessIds = new Set();
    this.closed = false;

    socket.on("data", (chunk) => this.receive(chunk));
    socket.on("close", () => void this.destroy());
    socket.on("error", () => void this.destroy());
  }

  receive(chunk) {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length) {
      let frame;
      try {
        frame = parseWebSocketFrame(this.buffer);
      } catch (error) {
        this.close(error.status === 1009 ? 1009 : 1003, error.message);
        return;
      }
      if (!frame) return;
      this.buffer = this.buffer.subarray(frame.bytesRead);
      void this.handleFrame(frame);
    }
  }

  async handleFrame(frame) {
    if (frame.opcode === 8) {
      this.close(1000, "closed");
      return;
    }
    if (frame.opcode === 9) {
      this.sendFrame(10, frame.payload);
      return;
    }
    if (frame.opcode !== 2) return;
    if (frame.payload.byteLength > maxWebSocketFrameBytes) {
      this.close(1009, "Collaboration frame is too large");
      return;
    }
    await this.handleBinary(new Uint8Array(frame.payload));
  }

  async handleBinary(payload) {
    let decoder;
    let messageType;
    try {
      decoder = decoding.createDecoder(payload);
      messageType = decoding.readVarUint(decoder);
    } catch {
      return;
    }

    if (messageType === messageSync) {
      if (
        this.role === "viewer" &&
        syncInnerMessageType(payload) === syncMessageUpdate
      ) {
        this.close(1008, "Viewer access is read-only");
        return;
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      try {
        syncProtocol.readSyncMessage(decoder, encoder, this.room.doc, this);
      } catch {
        return;
      }
      if (encoding.length(encoder) > 1) {
        this.sendBinary(encoding.toUint8Array(encoder));
      }
      return;
    }

    if (messageType === messageAwareness) {
      try {
        if (!decoding.hasContent(decoder)) return;
        const update = decoding.readVarUint8Array(decoder);
        if (!update.byteLength) return;
        awarenessProtocol.applyAwarenessUpdate(this.room.awareness, update, this);
      } catch {
        return;
      }
    }
  }

  sendSyncStep1() {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, this.room.doc);
    this.sendBinary(encoding.toUint8Array(encoder));
  }

  sendAwarenessStates() {
    const states = Array.from(this.room.awareness.getStates().keys());
    if (!states.length) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.room.awareness, states),
    );
    this.sendBinary(encoding.toUint8Array(encoder));
  }

  sendBinary(payload) {
    this.sendFrame(2, Buffer.from(payload));
  }

  sendFrame(opcode, payload = Buffer.alloc(0)) {
    if (this.closed || !this.socket.writable) return;
    this.socket.write(encodeWebSocketFrame(opcode, payload));
  }

  close(code = 1000, reason = "") {
    if (this.closed) return;
    const reasonBuffer = Buffer.from(reason.slice(0, 120));
    const payload = Buffer.alloc(2 + reasonBuffer.length);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);
    this.sendFrame(8, payload);
    this.socket.end();
    void this.destroy();
  }

  async destroy() {
    if (this.closed) return;
    this.closed = true;
    this.room.conns.delete(this);
    if (this.controlledAwarenessIds.size) {
      awarenessProtocol.removeAwarenessStates(
        this.room.awareness,
        Array.from(this.controlledAwarenessIds),
        this,
      );
    }
    try {
      const meta = await readProjectMeta(this.room.projectId);
      if (meta.presence[this.identity.clientId]) {
        meta.presence[this.identity.clientId].lastSeen = now();
        await writeProjectMeta(meta);
        broadcastProjectPresence(meta.id, activePresence(meta));
      }
    } catch {
      // Connection teardown should not throw.
    }
  }
}

function syncInnerMessageType(payload) {
  try {
    const decoder = decoding.createDecoder(payload);
    decoding.readVarUint(decoder);
    return decoding.readVarUint(decoder);
  } catch {
    return null;
  }
}

function parseWebSocketFrame(buffer) {
  if (buffer.length < 2) return null;
  const first = buffer[0];
  const second = buffer[1];
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (!fin) throw new HttpError(1003, "Fragmented frames are not supported.");
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    if (high !== 0) throw new HttpError(1009, "Frame is too large.");
    length = low;
    offset += 8;
  }
  if (length > maxWebSocketFrameBytes) {
    throw new HttpError(1009, "Frame is too large.");
  }
  let mask;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }
  return { opcode, payload, bytesRead: offset + length };
}

function encodeWebSocketFrame(opcode, payload) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(length, 6);
  }
  return Buffer.concat([header, payload]);
}

const server = http.createServer((request, response) => {
  handleHttp(request, response).catch((error) => {
    const status = error instanceof HttpError ? error.status : 500;
    const message =
      error instanceof HttpError ? error.message : "Internal collaboration error.";
    if (status >= 500) console.error(error);
    sendJson(response, request, status, { error: message });
  });
});

server.on("upgrade", (request, socket, head) => {
  void handleUpgrade(request, socket, head);
});

await mkdir(dataDir, { recursive: true });

server.listen(port, host, () => {
  console.log(
    `LatexDo collaborations listening on http://${host}:${port} with data ${dataDir}`,
  );
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
