import { Octokit } from "@octokit/rest";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    if (!process.env.GITHUB_TOKEN) {
      return Response.json({ error: "Missing GITHUB_TOKEN." }, { status: 500 });
    }

    const { owner, repo, branch } = await request.json();

    if (!owner || !repo || !branch) {
      return Response.json({ error: "Missing owner, repo or branch." }, { status: 400 });
    }

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    const repository = await octokit.repos.get({ owner, repo });
    const ref = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });

    return Response.json({
      ok: true,
      fullName: repository.data.full_name,
      private: repository.data.private,
      commitSha: ref.data.object.sha
    });
  } catch (error) {
    return Response.json({ error: error.message || "Repository check failed." }, { status: 500 });
  }
}
