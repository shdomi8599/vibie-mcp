/**
 * Vibie 인증 — OAuth 2.0 Device Authorization Grant 클라이언트.
 *
 * 흐름:
 *   1. ~/.vibie/credentials.json 에 토큰 있으면 그대로 사용
 *   2. ~/.vibie/pending.json 에 in-flight device_code 있으면 한 번 poll
 *      - authorized 면 토큰 저장 + return
 *      - pending/slow_down 이면 AuthRequiredError 던짐 (사용자에게 URL 재안내)
 *      - expired/denied 면 pending 폐기 후 step 3
 *   3. 새 init 호출 → device_code 받음 → pending 저장 → AuthRequiredError 던짐
 *
 * AuthRequiredError 가 tool handler 에서 catch 돼서 사용자에게 URL/코드 보임.
 * 사용자가 브라우저 authorize 후 다음 tool 호출 시 step 2 가 토큰 회수.
 */
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const HOME = homedir();
const VIBIE_DIR = join(HOME, ".vibie");
const CREDENTIALS_PATH = join(VIBIE_DIR, "credentials.json");
const PENDING_PATH = join(VIBIE_DIR, "pending.json");

const DEFAULT_BASE = process.env.VIBIE_API_BASE ?? "https://vibie.io";

const CLIENT_NAME = "Vibie MCP";

type Credentials = {
  token: string;
  /** 저장 시각. 만료 정책 도입 시 확인용 */
  saved_at: string;
};

type PendingDeviceFlow = {
  device_code: string;
  user_code: string;
  verification_uri_complete: string;
  /** 만료 시각 (밀리초 epoch) */
  expires_at_ms: number;
};

export class AuthRequiredError extends Error {
  userCode: string;
  verificationUriComplete: string;

  constructor(userCode: string, verificationUriComplete: string) {
    super(`Authentication required: visit ${verificationUriComplete}`);
    this.name = "AuthRequiredError";
    this.userCode = userCode;
    this.verificationUriComplete = verificationUriComplete;
  }
}

/** 토큰 받기. 없으면 device flow 시작 후 AuthRequiredError 던짐. */
export async function getTokenOrInitiateFlow(): Promise<string> {
  // 1) 저장된 credentials
  const cred = await readJson<Credentials>(CREDENTIALS_PATH);
  if (cred?.token) {
    return cred.token;
  }

  // 2) 진행 중인 device flow 가 있으면 한 번 poll
  const pending = await readJson<PendingDeviceFlow>(PENDING_PATH);
  if (pending?.device_code) {
    if (Date.now() > pending.expires_at_ms) {
      // 만료됐으니 폐기 후 새로 init
      await removeFile(PENDING_PATH);
    } else {
      const result = await pollDevice(pending.device_code);
      if (result.status === "authorized" && result.access_token) {
        await saveCredentials({
          token: result.access_token,
          saved_at: new Date().toISOString()
        });
        await removeFile(PENDING_PATH);
        return result.access_token;
      }
      if (result.status === "pending" || result.status === "slow_down") {
        throw new AuthRequiredError(
          pending.user_code,
          pending.verification_uri_complete
        );
      }
      // expired/denied — pending 폐기 후 새로 init
      await removeFile(PENDING_PATH);
    }
  }

  // 3) 새 device flow init
  const init = await initDevice();
  await savePending({
    device_code: init.device_code,
    user_code: init.user_code,
    verification_uri_complete: init.verification_uri_complete,
    expires_at_ms: Date.now() + init.expires_in * 1000
  });
  throw new AuthRequiredError(init.user_code, init.verification_uri_complete);
}

/** 저장된 토큰 명시적 삭제 — 로그아웃. */
export async function clearCredentials(): Promise<void> {
  await removeFile(CREDENTIALS_PATH);
  await removeFile(PENDING_PATH);
}

// ─── Vibie API 호출 ────────────────────────────────────────────────────────

type InitResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};

type PollResponse = {
  status: "pending" | "slow_down" | "expired" | "denied" | "authorized";
  access_token?: string;
  token_type?: string;
};

async function initDevice(): Promise<InitResponse> {
  const res = await fetch(`${DEFAULT_BASE}/api/auth/device/init`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: CLIENT_NAME })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Vibie /init failed (${res.status}): ${text}`);
  }
  return (await res.json()) as InitResponse;
}

async function pollDevice(deviceCode: string): Promise<PollResponse> {
  const res = await fetch(`${DEFAULT_BASE}/api/auth/device/poll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_code: deviceCode })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Vibie /poll failed (${res.status}): ${text}`);
  }
  return (await res.json()) as PollResponse;
}

// ─── 파일 IO helpers ──────────────────────────────────────────────────────

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function ensureDir(path: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
}

async function saveCredentials(cred: Credentials): Promise<void> {
  await ensureDir(CREDENTIALS_PATH);
  await fs.writeFile(CREDENTIALS_PATH, JSON.stringify(cred, null, 2), {
    mode: 0o600
  });
}

async function savePending(p: PendingDeviceFlow): Promise<void> {
  await ensureDir(PENDING_PATH);
  await fs.writeFile(PENDING_PATH, JSON.stringify(p, null, 2), { mode: 0o600 });
}

async function removeFile(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch {
    // already missing
  }
}
