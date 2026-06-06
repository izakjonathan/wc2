import { Octokit } from "@octokit/rest";

export const runtime = "nodejs";

function cleanInput(value) {
  return String(value || "")
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^\/+|\/+$/g, "");
}

function githubError(error, context) {
  const status = error.status ? `GitHub status ${error.status}` : "GitHub request failed";
  const message = error.response?.data?.message || error.message || "Unknown error";
  const hint = error.status === 404
    ? "Check owner, repository, branch, and token repository access."
    : error.status === 401
      ? "Bad credentials. Check GITHUB_TOKEN in Vercel and redeploy."
      : error.status === 403
        ? "Token lacks permission or rate limit was reached."
        : "";
  return `${context}\n${status}: ${message}${hint ? `\n${hint}` : ""}`;
}

export async function POST(request) {
  try {
    if (!process.env.GITHUB_TOKEN) {
      return Response.json({ error: "Missing GITHUB_TOKEN." }, { status: 500 });
    }

    const body = await request.json();
    const owner = cleanInput(body.owner).split("/")[0];
    const repo = cleanInput(body.repo).split("/").filter(Boolean).at(-1);
    const branch = cleanInput(body.branch || "main");

    if (!owner || !repo || !branch) {
      return Response.json({ error: "Missing owner, repo or branch." }, { status: 400 });
    }

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    let repository;
    try {
      repository = await octokit.repos.get({ owner, repo });
    } catch (error) {
      return Response.json({ error: githubError(error, "Repository lookup failed.") }, { status: error.status || 500 });
    }

    let branchData;
    try {
      branchData = await octokit.repos.getBranch({ owner, repo, branch });
    } catch (error) {
      let branches = [];
      try {
        const list = await octokit.repos.listBranches({ owner, repo, per_page: 100 });
        branches = list.data.map((item) => item.name);
      } catch {}
      return Response.json({
        error: `${githubError(error, "Branch lookup failed.")}${branches.length ? `\nAvailable branches: ${branches.join(", ")}` : ""}`
      }, { status: error.status || 500 });
    }

    return Response.json({
      ok: true,
      fullName: repository.data.full_name,
      private: repository.data.private,
      defaultBranch: repository.data.default_branch,
      branch: branchData.data.name,
      commitSha: branchData.data.commit.sha
    });
  } catch (error) {
    return Response.json({ error: `Unexpected check error: ${error.message || error}` }, { status: 500 });
  }
}
