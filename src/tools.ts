/**
 * 4개 MCP tool 정의 + handler.
 *
 * - vibie_create_site: 새 사이트 생성 + .vibie/site.json 자동 생성
 * - vibie_update_site: 같은 폴더 재배포. slug 안 주면 .vibie/site.json 에서 읽음
 * - vibie_list_sites: 본인 사이트 목록
 * - vibie_get_site: 특정 slug 메타
 *
 * 인증 친화 — 미인증이면 AuthRequiredError catch 후 사용자에게 URL/코드 안내.
 */
import { resolve } from "node:path";
import { AuthRequiredError, getTokenOrInitiateFlow, clearCredentials } from "./auth.js";
import {
  ApiAuthError,
  ApiError,
  createSite,
  getSite,
  listSites,
  updateSite
} from "./api.js";
import { clearMarker, readMarker, writeMarker } from "./site-marker.js";

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
};

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

// ─── tool 정의들 (LLM 한테 보이는 description 이 가장 중요) ──────────────────

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "vibie_create_site",
    description:
      "Create a NEW Vibie site by uploading a local folder. Use this when the user wants to publish a brand new site, or when no .vibie/site.json marker exists in the folder. Vibie hosts static HTML/CSS/JS at a permanent URL like my-site-a3f9.vibie.page. Auto-creates a .vibie/site.json marker in the folder for future updates.",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description:
            "Absolute or relative path to the folder containing index.html (or a single HTML file). Required."
        },
        name: {
          type: "string",
          description: "Display name. Defaults to folder name."
        },
        category: {
          type: "string",
          description:
            "Category id (portfolio / wedding / landing / event / game / photo / linkbio / misc). Defaults to misc."
        },
        is_public: {
          type: "boolean",
          description:
            "Whether the site appears in the public gallery. Defaults to true."
        },
        note: {
          type: "string",
          description: "Optional deployment note (changelog-style)."
        }
      },
      required: ["folder"],
      additionalProperties: false
    }
  },
  {
    name: "vibie_update_site",
    description:
      "Update an existing Vibie site with new content from a local folder. Use this when the user wants to re-deploy or push changes to an already-published site. If .vibie/site.json marker exists in the folder, the slug is read automatically; otherwise pass slug explicitly. Same URL, new content.",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "Folder to upload. Required."
        },
        slug: {
          type: "string",
          description:
            "Site slug to update (e.g. my-site-a3f9). If omitted, read from .vibie/site.json in folder."
        },
        note: {
          type: "string",
          description: "Optional deployment note (changelog-style)."
        }
      },
      required: ["folder"],
      additionalProperties: false
    }
  },
  {
    name: "vibie_list_sites",
    description:
      "List all sites owned by the current Vibie user. Returns slug, display name, category, URL, visibility, and last update time. Use this to discover what sites the user already has, e.g. before update.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "vibie_get_site",
    description:
      "Get metadata for a single Vibie site by slug. Returns name, category, URL, visibility, like count, timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "Site slug, e.g. my-site-a3f9"
        }
      },
      required: ["slug"],
      additionalProperties: false
    }
  }
];

// ─── handler dispatcher ────────────────────────────────────────────────────

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const token = await getTokenOrInitiateFlow();
    switch (name) {
      case "vibie_create_site":
        return await handleCreate(token, args);
      case "vibie_update_site":
        return await handleUpdate(token, args);
      case "vibie_list_sites":
        return await handleList(token);
      case "vibie_get_site":
        return await handleGet(token, args);
      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return {
        content: [
          {
            type: "text",
            text:
              "Vibie 인증이 필요합니다. 사용자에게 다음 단계를 안내해 주세요:\n\n" +
              `1. 브라우저로 이 URL 을 여세요: ${err.verificationUriComplete}\n` +
              `2. Google 로 로그인하고 코드 ${err.userCode} 를 확인한 뒤 [권한 부여] 버튼을 누르세요.\n` +
              `3. 완료되면 다시 '배포해줘' 또는 원래 요청을 해주세요. 같은 도구 호출이 다시 들어오면 토큰을 가져와서 진행합니다.\n\n` +
              `(코드는 10분 안에 사용해야 합니다. 만료되면 새 코드가 발급됩니다.)`
          }
        ]
      };
    }
    if (err instanceof ApiAuthError) {
      // 토큰이 revoke 됐거나 invalid — credentials 폐기 + 재인증 안내
      await clearCredentials();
      return {
        content: [
          {
            type: "text",
            text:
              "Vibie 토큰이 더 이상 유효하지 않습니다 (revoke 됐거나 만료). " +
              "credentials 를 비웠습니다. 같은 도구를 다시 호출해주시면 새 인증 흐름을 시작합니다."
          }
        ],
        isError: true
      };
    }
    if (err instanceof ApiError) {
      return errorResult(
        `Vibie API ${err.status} ${err.code}: ${err.message}`
      );
    }
    return errorResult(
      err instanceof Error ? err.message : "Unknown error"
    );
  }
}

// ─── 개별 handler ──────────────────────────────────────────────────────────

async function handleCreate(
  token: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const folder = requireStr(args, "folder");
  const absFolder = resolve(folder);

  const result = await createSite(token, {
    folder: absFolder,
    name: optStr(args, "name"),
    category: optStr(args, "category"),
    isPublic: optBool(args, "is_public"),
    note: optStr(args, "note")
  });

  // .vibie/site.json 자동 생성 — 다음 배포 시 update_site 가 slug 자동 인지
  await writeMarker(absFolder, {
    slug: result.site.slug,
    siteId: result.site.id,
    url: result.url,
    lastDeployed: new Date().toISOString()
  });

  return successResult(
    `✓ 새 Vibie 사이트가 배포됐습니다.\n` +
      `  URL: ${result.url}\n` +
      `  Slug: ${result.site.slug}\n` +
      `  Name: ${result.site.display_name}\n` +
      `  Public: ${result.site.is_public}\n\n` +
      `다음에 같은 폴더에서 vibie_update_site 를 호출하면 같은 사이트가 갱신됩니다 (.vibie/site.json 자동 인식).`
  );
}

async function handleUpdate(
  token: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const folder = requireStr(args, "folder");
  const absFolder = resolve(folder);

  let slug = optStr(args, "slug");
  if (!slug) {
    const marker = await readMarker(absFolder);
    if (!marker) {
      return errorResult(
        `slug 를 알 수 없습니다. ${absFolder}/.vibie/site.json 마커가 없고 인자로도 slug 가 전달되지 않았습니다.\n` +
          `옵션:\n` +
          `1. 새 사이트로 만들려면 vibie_create_site 호출\n` +
          `2. 기존 사이트로 업데이트하려면 slug 인자를 명시 (예: my-site-a3f9). vibie_list_sites 로 본인 사이트 목록 확인 가능.`
      );
    }
    slug = marker.slug;
  }

  const result = await updateSite(token, {
    folder: absFolder,
    slug,
    note: optStr(args, "note")
  });

  // marker 의 lastDeployed 갱신
  const marker = await readMarker(absFolder);
  if (marker) {
    await writeMarker(absFolder, {
      ...marker,
      lastDeployed: new Date().toISOString()
    });
  }

  return successResult(
    `✓ Vibie 사이트가 업데이트됐습니다.\n` +
      `  URL: ${result.url}\n` +
      `  Slug: ${slug}\n` +
      `  Deployment: ${result.deployment.id}\n`
  );
}

async function handleList(token: string): Promise<ToolResult> {
  const sites = await listSites(token);
  if (sites.length === 0) {
    return successResult(
      "본인 명의로 배포된 사이트가 없습니다. vibie_create_site 로 첫 사이트를 만들어 보세요."
    );
  }
  const lines = sites.map((s) => {
    const flag = s.is_blocked ? " [차단]" : s.is_public ? "" : " [비공개]";
    const tpl = s.is_template ? " [TEMPLATE]" : "";
    return `· ${s.slug}.vibie.page  —  ${s.display_name} (${s.category})${flag}${tpl}, ♥${s.like_count}, updated ${s.updated_at}`;
  });
  return successResult(
    `본인 Vibie 사이트 (${sites.length}개):\n${lines.join("\n")}`
  );
}

async function handleGet(
  token: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const slug = requireStr(args, "slug");
  const site = await getSite(token, slug);
  if (!site) {
    return errorResult(`사이트 '${slug}' 를 본인 계정에서 찾을 수 없습니다.`);
  }
  return successResult(
    `${site.display_name} (${site.slug}.vibie.page)\n` +
      `  Category: ${site.category}\n` +
      `  Public: ${site.is_public}\n` +
      `  Template: ${site.is_template}\n` +
      `  Likes: ${site.like_count}\n` +
      `  Created: ${site.created_at}\n` +
      `  Updated: ${site.updated_at}`
  );
}

// ─── small helpers ────────────────────────────────────────────────────────

function requireStr(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Argument '${key}' is required and must be a non-empty string.`);
  }
  return v;
}

function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function optBool(args: Record<string, unknown>, key: string): boolean | undefined {
  const v = args[key];
  return typeof v === "boolean" ? v : undefined;
}

function successResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}
