/**
 * Vibie HTTP API 클라이언트 (sites CRUD).
 *
 * 모든 호출에 Authorization: Bearer <token> 헤더. 401 면 ApiAuthError 던짐
 * (handler 가 catch 해서 credentials 폐기 + 재인증 안내).
 */
import { promises as fs } from "node:fs";
import { join, relative, sep } from "node:path";

const DEFAULT_BASE = process.env.VIBIE_API_BASE ?? "https://vibie.io";

export class ApiAuthError extends Error {
  constructor(message = "Authentication failed (token revoked or invalid).") {
    super(message);
    this.name = "ApiAuthError";
  }
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export type SiteSummary = {
  id: string;
  slug: string;
  display_name: string;
  category: string;
  is_public: boolean;
  is_blocked: boolean;
  is_template: boolean;
  like_count: number;
  created_at: string;
  updated_at: string;
};

export type CreateSiteInput = {
  folder: string;
  name?: string;
  category?: string;
  isPublic?: boolean;
  note?: string;
};

export type CreateSiteResult = {
  url: string;
  site: SiteSummary;
};

export type UpdateSiteInput = {
  folder: string;
  slug: string;
  note?: string;
};

export type UpdateSiteResult = {
  url: string;
  deployment: { id: string; created_at: string };
};

/** /api/sites GET — 본인 사이트 목록 */
export async function listSites(token: string): Promise<SiteSummary[]> {
  const data = await jsonRequest<{ sites: SiteSummary[] }>(token, {
    path: "/api/sites",
    method: "GET"
  });
  return data.sites ?? [];
}

/** /api/sites/[slug] — 단일 site 메타. 우리 사용자 본인 / 공개 사이트만 응답. */
export async function getSite(token: string, slug: string): Promise<SiteSummary | null> {
  // 우리 API 에 GET /api/sites/[slug] 가 없음 (PATCH/DELETE 만).
  // list 에서 필터.
  const sites = await listSites(token);
  return sites.find((s) => s.slug === slug) ?? null;
}

/** /api/sites POST — multipart 로 폴더 전체 업로드, 새 사이트 생성 */
export async function createSite(
  token: string,
  input: CreateSiteInput
): Promise<CreateSiteResult> {
  const files = await collectFolderFiles(input.folder);
  const inferredName =
    input.name ?? folderBaseName(input.folder) ?? "site";

  const fd = new FormData();
  fd.append("name", inferredName);
  fd.append("slug", inferredName);
  fd.append("category", input.category ?? "misc");
  if (input.note) fd.append("note", input.note);
  fd.append("isPublic", input.isPublic === false ? "false" : "true");
  fd.append("paths", JSON.stringify(files.map((f) => f.relPath)));
  for (const f of files) {
    fd.append("files", new Blob([new Uint8Array(f.bytes)]), f.relPath);
  }

  const data = await jsonRequest<CreateSiteResult>(token, {
    path: "/api/sites",
    method: "POST",
    body: fd
  });
  return data;
}

/** /api/sites/[slug]/deployments POST — 기존 site 재배포 */
export async function updateSite(
  token: string,
  input: UpdateSiteInput
): Promise<UpdateSiteResult> {
  const files = await collectFolderFiles(input.folder);

  const fd = new FormData();
  if (input.note) fd.append("note", input.note);
  fd.append("paths", JSON.stringify(files.map((f) => f.relPath)));
  for (const f of files) {
    fd.append("files", new Blob([new Uint8Array(f.bytes)]), f.relPath);
  }

  const data = await jsonRequest<UpdateSiteResult>(token, {
    path: `/api/sites/${encodeURIComponent(input.slug)}/deployments`,
    method: "POST",
    body: fd
  });
  return data;
}

// ─── 내부 helpers ──────────────────────────────────────────────────────────

async function jsonRequest<T>(
  token: string,
  opts: { path: string; method: string; body?: BodyInit }
): Promise<T> {
  const res = await fetch(`${DEFAULT_BASE}${opts.path}`, {
    method: opts.method,
    headers: { Authorization: `Bearer ${token}` },
    body: opts.body
  });

  if (res.status === 401) {
    throw new ApiAuthError();
  }
  if (!res.ok) {
    let code = "UNKNOWN";
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: { code?: string; message?: string } };
      if (data?.error?.code) code = data.error.code;
      if (data?.error?.message) message = data.error.message;
    } catch {
      // body 가 JSON 아닐 수도
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

type LocalFile = { relPath: string; bytes: Buffer };

async function collectFolderFiles(folder: string): Promise<LocalFile[]> {
  const stat = await fs.stat(folder);
  if (stat.isFile()) {
    // 단일 파일 — 그대로 업로드
    const bytes = await fs.readFile(folder);
    const name = folder.split(sep).pop() ?? "index.html";
    return [{ relPath: name, bytes }];
  }
  if (!stat.isDirectory()) {
    throw new Error(`${folder} is neither a file nor a directory`);
  }

  const out: LocalFile[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      // hidden 디렉토리/파일 무시 (.git, .vibie, .DS_Store 등)
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const bytes = await fs.readFile(full);
        const rel = relative(folder, full).split(sep).join("/");
        out.push({ relPath: rel, bytes });
      }
    }
  }
  await walk(folder);

  if (out.length === 0) {
    throw new Error(`No files found in ${folder}`);
  }
  return out;
}

function folderBaseName(folder: string): string | undefined {
  const segs = folder.replace(/[\\/]+$/, "").split(/[\\/]/);
  const last = segs[segs.length - 1];
  if (!last || last === "." || last === "..") return undefined;
  return last;
}
