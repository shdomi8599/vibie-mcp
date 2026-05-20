/**
 * `vibie-mcp setup` — Claude Desktop / Cursor 의 MCP config 파일을 자동 탐지해서
 * `vibie` 항목을 추가/갱신한다.
 *
 * 지원 클라이언트:
 *   - Claude Desktop (Win Store + APPDATA, macOS, Linux)
 *   - Cursor (글로벌 ~/.cursor/mcp.json)
 *
 * 없는 client 는 조용히 skip. 이미 vibie 항목이 있으면 갱신.
 *
 * 사용법: npx vibie-mcp setup
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";

type ClientTarget = {
  id: "claude-desktop" | "cursor";
  label: string;
  configPath: string;
  exists: boolean;
};

const VIBIE_ENTRY = {
  command: "npx",
  args: ["-y", "vibie-mcp"]
};

function findClaudeDesktopConfig(): string | undefined {
  const home = homedir();
  const candidates: string[] = [];

  if (platform() === "win32") {
    // Microsoft Store 버전 — %LOCALAPPDATA%\Packages\Claude_xxx\LocalCache\Roaming\Claude\...
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const packages = join(localAppData, "Packages");
      try {
        if (existsSync(packages)) {
          for (const entry of readdirSync(packages)) {
            if (entry.startsWith("Claude_")) {
              candidates.push(
                join(
                  packages,
                  entry,
                  "LocalCache",
                  "Roaming",
                  "Claude",
                  "claude_desktop_config.json"
                )
              );
            }
          }
        }
      } catch {
        // ignore — best-effort scan
      }
    }
    // 일반 인스톨러 버전 — %APPDATA%\Claude\...
    if (process.env.APPDATA) {
      candidates.push(
        join(process.env.APPDATA, "Claude", "claude_desktop_config.json")
      );
    }
  } else if (platform() === "darwin") {
    candidates.push(
      join(
        home,
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json"
      )
    );
  } else {
    // linux 등
    candidates.push(join(home, ".config", "Claude", "claude_desktop_config.json"));
  }

  // 이미 존재하는 첫 후보. 없으면 첫 후보 경로를 새로 만들 자리로 반환.
  const existing = candidates.find((p) => existsSync(p));
  return existing ?? candidates[0];
}

function discoverClients(): ClientTarget[] {
  const home = homedir();
  const targets: ClientTarget[] = [];

  const claudePath = findClaudeDesktopConfig();
  if (claudePath) {
    targets.push({
      id: "claude-desktop",
      label: "Claude Desktop",
      configPath: claudePath,
      exists: existsSync(claudePath)
    });
  }

  const cursorPath = join(home, ".cursor", "mcp.json");
  targets.push({
    id: "cursor",
    label: "Cursor",
    configPath: cursorPath,
    exists: existsSync(cursorPath)
  });

  return targets;
}

type InstallResult = "added" | "updated";

function installToTarget(target: ClientTarget): InstallResult {
  let config: Record<string, unknown> = {};
  if (target.exists) {
    const raw = readFileSync(target.configPath, "utf8");
    if (raw.trim().length > 0) {
      config = JSON.parse(raw) as Record<string, unknown>;
    }
  } else {
    mkdirSync(dirname(target.configPath), { recursive: true });
  }

  const mcpServers =
    config.mcpServers && typeof config.mcpServers === "object"
      ? (config.mcpServers as Record<string, unknown>)
      : {};
  const alreadyExists = "vibie" in mcpServers;
  mcpServers.vibie = VIBIE_ENTRY;
  config.mcpServers = mcpServers;

  writeFileSync(
    target.configPath,
    JSON.stringify(config, null, 2) + "\n",
    "utf8"
  );
  return alreadyExists ? "updated" : "added";
}

export async function runSetup(): Promise<void> {
  console.log("🔵 Vibie MCP 설치를 시작합니다.\n");

  const targets = discoverClients();
  const installed: { label: string; result: InstallResult; path: string }[] = [];
  const failed: { label: string; error: string }[] = [];

  for (const target of targets) {
    try {
      const result = installToTarget(target);
      installed.push({ label: target.label, result, path: target.configPath });
    } catch (err) {
      failed.push({
        label: target.label,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  for (const item of installed) {
    const verb = item.result === "updated" ? "갱신" : "추가";
    console.log(`✓ ${item.label}: vibie 항목 ${verb}`);
    console.log(`    ${item.path}`);
  }
  for (const item of failed) {
    console.log(`✗ ${item.label}: ${item.error}`);
  }

  console.log("");
  if (installed.length === 0) {
    console.log(
      "설치할 수 있는 클라이언트를 찾지 못했어요. Claude Desktop 또는 Cursor 가 설치돼 있는지 확인해 주세요."
    );
    return;
  }

  console.log("📌 다음 단계");
  console.log(
    "  1. 클라이언트를 완전히 종료 후 다시 실행 (Claude Desktop 은 트레이에서 Quit 후 재시작)"
  );
  console.log(
    '  2. 대화창에서 "내 vibie 사이트 목록 보여줘" 같은 메시지로 시작'
  );
  console.log(
    "  3. 처음 호출 시 브라우저로 권한 부여 페이지가 안내됩니다 (Google 로그인)"
  );
  console.log("");
  console.log("문제가 있으면: https://www.npmjs.com/package/vibie-mcp");
}
