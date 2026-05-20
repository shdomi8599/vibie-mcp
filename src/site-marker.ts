/**
 * `.vibie/site.json` 폴더 마커 — 한 폴더가 어떤 vibie 사이트에 매핑되는지 추적.
 *
 * Vercel CLI 의 `.vercel/project.json` 같은 패턴. update 시 "어떤 사이트?" 물을 필요 X.
 *
 * 파일 위치: {folder}/.vibie/site.json
 * 함께 자동 생성: {folder}/.vibie/.gitignore — 폴더 전체 git ignore (사용자 site 와 분리)
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";

const MARKER_DIRNAME = ".vibie";
const MARKER_FILENAME = "site.json";
const GITIGNORE_CONTENT = "# vibie cli local state\n*\n!.gitignore\n";

export type SiteMarker = {
  slug: string;
  siteId: string;
  url: string;
  lastDeployed: string;
};

export async function readMarker(folder: string): Promise<SiteMarker | null> {
  try {
    const raw = await fs.readFile(
      join(folder, MARKER_DIRNAME, MARKER_FILENAME),
      "utf8"
    );
    return JSON.parse(raw) as SiteMarker;
  } catch {
    return null;
  }
}

export async function writeMarker(folder: string, marker: SiteMarker): Promise<void> {
  const dir = join(folder, MARKER_DIRNAME);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, MARKER_FILENAME),
    JSON.stringify(marker, null, 2),
    "utf8"
  );
  // .gitignore 자동 — 사용자가 vibie 마커를 자기 git 에 안 넣게
  const gitignorePath = join(dir, ".gitignore");
  try {
    await fs.access(gitignorePath);
    // 이미 있으면 손대지 않음
  } catch {
    await fs.writeFile(gitignorePath, GITIGNORE_CONTENT, "utf8");
  }
}

export async function clearMarker(folder: string): Promise<void> {
  try {
    await fs.unlink(join(folder, MARKER_DIRNAME, MARKER_FILENAME));
  } catch {
    // 없으면 그만
  }
}
