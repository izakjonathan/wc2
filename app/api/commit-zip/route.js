import { Octokit } from "@octokit/rest";
import JSZip from "jszip";

export const runtime = "nodejs";

function normalizePath(path) {
  return path.replace(/^\.\//, "").replace(/^\/+/, "");
}

function isNoise(path) {
  const p = path.toLowerCase();
  return (
    p.includes("__macosx/") ||
    p.endsWith(".ds_store") ||
    p.includes("node_modules/") ||
    p.includes(".git/") ||
    p.includes(".next/")
  );
}

function isBinaryPath(path) {
  return /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|woff|woff2|ttf|otf|mp4|mov|mp3|wav|avif|heic)$/i.test(path);
}

function shouldDeletePath(filePath, deletePaths) {
  return deletePaths.some((path) => {
    const clean = normalizePath(path).replace(/\/$/, "");
    return filePath === clean || filePath.startsWith(`${clean}/`);
  });
}

async function getRecursiveTree(octokit, owner, repo, treeSha) {
  const tree = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: treeSha,
    recursive: "true"
  });
  return tree.data.tree || [];
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
    const deleteExisting = String(form.get("deleteExisting") || "false") === "true";
    const nuclearMode = String(form.get("nuclearMode") || "false") === "true";
    const deletePaths = String(form.get("deletePaths") || "")
      .split(/\r?\n/)
      .map((x) => normalizePath(x.trim()))
      .filter(Boolean);

    const zipFile = form.get("zip");

    if (!owner || !repo || !branch || !message || !zipFile) {
      return Response.json({ error: "Missing owner, repo, branch, message or ZIP." }, { status: 400 });
    }

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    const ref = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`
    });

    const parentCommitSha = ref.data.object.sha;

    const parentCommit = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: parentCommitSha
    });

    const baseTreeSha = parentCommit.data.tree.sha;
    const existingTree = await getRecursiveTree(octokit, owner, repo, baseTreeSha);

    const zipBuffer = Buffer.from(await zipFile.arrayBuffer());
    const zip = await JSZip.loadAsync(zipBuffer);

    const treeItems = [];
    const uploadedPaths = [];

    for (const [relativePath, entry] of Object.entries(zip.files)) {
      const path = normalizePath(relativePath);

      if (entry.dir || isNoise(path)) continue;

      const buffer = Buffer.from(await entry.async("uint8array"));

      const blob = await octokit.git.createBlob({
        owner,
        repo,
        content: isBinaryPath(path) ? buffer.toString("base64") : buffer.toString("utf8"),
        encoding: isBinaryPath(path) ? "base64" : "utf-8"
      });

      treeItems.push({
        path,
        mode: "100644",
        type: "blob",
        sha: blob.data.sha
      });

      uploadedPaths.push(path);
    }

    if (!uploadedPaths.length) {
      return Response.json({ error: "ZIP contained no uploadable files." }, { status: 400 });
    }

    if (nuclearMode) {
      for (const item of existingTree) {
        if (item.type === "blob") {
          treeItems.push({ path:item.path, mode:"100644", type:"blob", sha:null });
        }
      }
    } else if (deleteExisting && deletePaths.length) {
      for (const item of existingTree) {
        if (item.type === "blob" && shouldDeletePath(item.path, deletePaths)) {
          treeItems.push({
            path: item.path,
            mode: "100644",
            type: "blob",
            sha: null
          });
        }
      }
    }

    const newTree = await octokit.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree: treeItems
    });

    const newCommit = await octokit.git.createCommit({
      owner,
      repo,
      message,
      tree: newTree.data.sha,
      parents: [parentCommitSha]
    });

    await octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: newCommit.data.sha
    });

    return Response.json({
      ok: true,
      commitSha: newCommit.data.sha,
      filesUploaded: uploadedPaths.length,
      deletedPaths: nuclearMode ? ["FULL_REPOSITORY"] : (deleteExisting ? deletePaths : [])
    });
  } catch (error) {
    return Response.json({
      error: error.message || "Unexpected commit error."
    }, { status: 500 });
  }
}
