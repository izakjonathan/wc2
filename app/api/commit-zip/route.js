import { Octokit } from "@octokit/rest";
import JSZip from "jszip";

export const runtime = "nodejs";

const PRESERVE_PATHS = [".github", ".gitignore", "vercel.json", "docs", "README.md"];

function isPreservedPath(path) {
  return PRESERVE_PATHS.some((preserve) => path === preserve || path.startsWith(`${preserve}/`));
}

function normalizeZipPath(path) {
  if (!path) return null;

  const normalized = path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .trim();

  if (!normalized) return null;
  if (normalized.startsWith("__MACOSX/")) return null;
  if (normalized.endsWith(".DS_Store")) return null;
  if (normalized.includes("/.DS_Store")) return null;
  if (normalized === "." || normalized === "/") return null;

  return normalized;
}

function stripSingleRootFolder(paths) {
  const valid = paths.filter(Boolean);
  const roots = [...new Set(valid.map((p) => p.split("/")[0]))];

  if (roots.length !== 1) return new Map(valid.map((p) => [p, p]));

  const root = roots[0];

  if (["app", "components", "data", "public", "src"].includes(root)) {
    return new Map(valid.map((p) => [p, p]));
  }

  return new Map(
    valid.map((p) => {
      const stripped = p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p;
      return [p, stripped || null];
    })
  );
}

function isBinaryPath(path) {
  return /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|woff|woff2|ttf|otf|mp4|mov|mp3|wav|avif|heic)$/i.test(path);
}

export async function POST(request) {
  try {
    if (!process.env.GITHUB_TOKEN) {
      return Response.json({ error: "Missing GITHUB_TOKEN." }, { status: 500 });
    }

    const form = await request.formData();

    const owner = String(form.get("owner") || "").trim();
    const repo = String(form.get("repo") || "").trim();
    const branch = String(form.get("branch") || "main").trim();
    const message = String(form.get("message") || "").trim();
    const fullRepositoryReplace = String(form.get("fullRepositoryReplace") || "false") === "true";
    const zipFile = form.get("zip");

    if (!owner || !repo || !branch || !message || !zipFile) {
      return Response.json({ error: "Missing owner, repo, branch, message or ZIP." }, { status: 400 });
    }

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    const branchData = await octokit.repos.getBranch({ owner, repo, branch });
    const parentCommitSha = branchData.data.commit.sha;

    const parentCommit = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: parentCommitSha,
    });

    const baseTreeSha = parentCommit.data.tree.sha;

    const zip = await JSZip.loadAsync(await zipFile.arrayBuffer());

    const originalPaths = [];
    for (const [relativePath, entry] of Object.entries(zip.files)) {
      const normalized = normalizeZipPath(relativePath);
      if (!entry.dir && normalized) originalPaths.push(normalized);
    }

    const stripMap = stripSingleRootFolder(originalPaths);

    const finalPaths = [...stripMap.values()].filter(Boolean);

    if (fullRepositoryReplace && !finalPaths.includes("package.json")) {
      return Response.json(
        { error: "Full Repository Replace requires package.json at the ZIP root." },
        { status: 400 }
      );
    }

    const treeItems = [];
    const uploadedPaths = [];

    for (const [relativePath, entry] of Object.entries(zip.files)) {
      const normalizedOriginal = normalizeZipPath(relativePath);
      if (entry.dir || !normalizedOriginal) continue;

      const finalPath = stripMap.get(normalizedOriginal);
      if (!finalPath) continue;

      const buffer = Buffer.from(await entry.async("uint8array"));

      const blob = await octokit.git.createBlob({
        owner,
        repo,
        content: isBinaryPath(finalPath) ? buffer.toString("base64") : buffer.toString("utf8"),
        encoding: isBinaryPath(finalPath) ? "base64" : "utf-8",
      });

      treeItems.push({
        path: finalPath,
        mode: "100644",
        type: "blob",
        sha: blob.data.sha,
      });

      uploadedPaths.push(finalPath);
    }

    if (!uploadedPaths.length) {
      return Response.json({ error: "ZIP contained no uploadable files." }, { status: 400 });
    }

    const newTree = await octokit.git.createTree({
      owner,
      repo,
      base_tree: fullRepositoryReplace ? undefined : baseTreeSha,
      tree: treeItems,
    });

    const newCommit = await octokit.git.createCommit({
      owner,
      repo,
      message,
      tree: newTree.data.sha,
      parents: [parentCommitSha],
    });

    await octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: newCommit.data.sha,
    });

    return Response.json({
      ok: true,
      commitSha: newCommit.data.sha,
      filesUploaded: uploadedPaths.length,
      deletedPaths: fullRepositoryReplace ? ["FULL_REPOSITORY_EXCEPT_PROTECTED_PATHS"] : [],
      preservedPaths: PRESERVE_PATHS,
    });
  } catch (error) {
    return Response.json(
      {
        error: error.message || "Unexpected commit error.",
        status: error.status || null,
        details: error.response?.data || null,
      },
      { status: 500 }
    );
  }
}
