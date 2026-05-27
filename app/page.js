"use client";

import { useMemo, useState } from "react";
import JSZip from "jszip";

const DEFAULT_DELETE = ["app", "components", "data", "public"];

function cleanInput(value) {
  return String(value || "")
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^\/+|\/+$/g, "");
}

function cleanPath(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
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

function getUploadPath(path, stripPrefix) {
  const clean = cleanPath(path);
  if (stripPrefix && clean.startsWith(stripPrefix + "/")) {
    return clean.slice(stripPrefix.length + 1);
  }
  return clean;
}

function detectWrapperFolder(paths) {
  const files = paths.filter(Boolean);
  const hasRootPackage = files.includes("package.json");
  if (hasRootPackage) return "";

  const firstSegments = files
    .map((p) => p.split("/")[0])
    .filter(Boolean);

  const unique = [...new Set(firstSegments)];
  if (unique.length !== 1) return "";

  const wrapper = unique[0];
  if (files.includes(`${wrapper}/package.json`)) return wrapper;
  return "";
}

function formatSize(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function Home() {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [message, setMessage] = useState("Replace project with latest ZIP build");
  const [zipFile, setZipFile] = useState(null);
  const [files, setFiles] = useState([]);
  const [stripPrefix, setStripPrefix] = useState("");
  const [replaceMode, setReplaceMode] = useState("full");
  const [confirmReplace, setConfirmReplace] = useState("");
  const [deletePaths, setDeletePaths] = useState(DEFAULT_DELETE.join("\n"));
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [repoStatus, setRepoStatus] = useState("");

  const normalizedOwner = cleanInput(owner).split("/")[0] || "";
  const normalizedRepo = cleanInput(repo).split("/").filter(Boolean).at(-1) || "";
  const normalizedBranch = cleanInput(branch);

  const summary = useMemo(() => {
    const total = files.reduce((sum, file) => sum + file.size, 0);
    const folders = new Set(files.map((file) => file.path.split("/")[0]).filter(Boolean));
    const hasPackageJson = files.some((file) => file.path === "package.json");
    return { total, folders: folders.size, hasPackageJson };
  }, [files]);

  async function handleZip(file) {
    setZipFile(file || null);
    setFiles([]);
    setStripPrefix("");
    setStatus("");

    if (!file) return;

    try {
      const zip = await JSZip.loadAsync(file);
      const rawFiles = [];

      zip.forEach((relativePath, entry) => {
        const path = cleanPath(relativePath);
        if (!entry.dir && !isNoise(path)) {
          rawFiles.push({
            rawPath: path,
            path,
            size: entry._data?.uncompressedSize || 0
          });
        }
      });

      const wrapper = detectWrapperFolder(rawFiles.map((file) => file.path));
      setStripPrefix(wrapper);

      const next = rawFiles
        .map((file) => ({
          ...file,
          path: getUploadPath(file.rawPath, wrapper)
        }))
        .filter((file) => file.path && !isNoise(file.path))
        .sort((a, b) => a.path.localeCompare(b.path));

      setFiles(next);
    } catch (error) {
      setStatus(`Could not read ZIP: ${error.message}`);
    }
  }

  async function checkRepo() {
    if (!normalizedOwner || !normalizedRepo || !normalizedBranch) {
      setRepoStatus("Enter owner, repo and branch first.");
      return;
    }

    setRepoStatus("Checking repository...");
    try {
      const res = await fetch("/api/check-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: normalizedOwner,
          repo: normalizedRepo,
          branch: normalizedBranch
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Check failed.");

      setRepoStatus(
        `OK\nRepository: ${data.fullName}\nBranch: ${data.branch}\nLatest commit: ${data.commitSha}\nDefault branch: ${data.defaultBranch}`
      );
    } catch (error) {
      setRepoStatus(`Error:\n${error.message}`);
    }
  }

  async function commitZip() {
    if (!normalizedOwner || !normalizedRepo || !normalizedBranch || !message || !zipFile) {
      setStatus("Missing owner, repo, branch, commit message or ZIP.");
      return;
    }

    if (replaceMode === "full" && confirmReplace !== "REPLACE") {
      setStatus("Type REPLACE to enable full repository replacement.");
      return;
    }

    if (replaceMode === "full" && !summary.hasPackageJson) {
      setStatus("Full Repository Replace requires package.json at the ZIP root. If your ZIP has a wrapper folder, this app tries to strip it automatically.");
      return;
    }

    const confirmText = replaceMode === "full"
      ? `WARNING: This will replace ALL files in ${normalizedOwner}/${normalizedRepo}:${normalizedBranch} with the ZIP contents.`
      : `This will delete selected paths first:\n${deletePaths}\n\nThen upload ${files.length} files to ${normalizedOwner}/${normalizedRepo}:${normalizedBranch}.`;

    if (!window.confirm(confirmText)) return;

    setBusy(true);
    setStatus("Uploading ZIP and creating GitHub commit...");

    try {
      const form = new FormData();
      form.append("owner", normalizedOwner);
      form.append("repo", normalizedRepo);
      form.append("branch", normalizedBranch);
      form.append("message", message.trim());
      form.append("replaceMode", replaceMode);
      form.append("stripPrefix", stripPrefix);
      form.append("deletePaths", deletePaths);
      form.append("zip", zipFile);

      const res = await fetch("/api/commit-zip", {
        method: "POST",
        body: form
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Commit failed.");

      setStatus(
        `SUCCESS\n\nRepository: ${normalizedOwner}/${normalizedRepo}\nBranch: ${normalizedBranch}\nCommit: ${data.commitSha}\nFiles uploaded: ${data.filesUploaded}\nMode: ${data.mode}\nStripped wrapper: ${data.stripPrefix || "none"}\n\nVercel should deploy automatically if connected.`
      );
    } catch (error) {
      setStatus(`ERROR\n\n${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <div className="kicker">ZIP → GitHub Commit</div>
      <h1>GitHub ZIP Committer</h1>
      <p>
        Upload a ZIP build from iPhone/iPad, replace repository files and commit directly to GitHub.
      </p>

      <section className="card">
        <h2>1. Repository</h2>
        <div className="grid">
          <div>
            <label>GitHub owner</label>
            <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="izakjonathan" autoCapitalize="none" />
          </div>
          <div>
            <label>Repository</label>
            <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="portfolio2" autoCapitalize="none" />
          </div>
          <div>
            <label>Branch</label>
            <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" autoCapitalize="none" />
          </div>
          <div>
            <label>Commit message</label>
            <input value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
        </div>
        <div className="actions">
          <button className="secondary" onClick={checkRepo}>Check repo</button>
        </div>
        {repoStatus && <pre className="status">{repoStatus}</pre>}
      </section>

      <section className="card">
        <h2>2. Upload ZIP</h2>
        <input type="file" accept=".zip,application/zip" onChange={(e) => handleZip(e.target.files?.[0])} />

        {stripPrefix && (
          <div className="warning" style={{ marginTop: 14 }}>
            Detected wrapper folder: <b>{stripPrefix}</b>. It will be stripped so files upload to repository root.
          </div>
        )}

        {!!files.length && (
          <>
            <div className="stat-grid" style={{ marginTop: 14 }}>
              <div className="stat"><b>{files.length}</b><span>Files</span></div>
              <div className="stat"><b>{formatSize(summary.total)}</b><span>Total size</span></div>
              <div className="stat"><b>{summary.hasPackageJson ? "Yes" : "No"}</b><span>package.json</span></div>
            </div>
            <div className="file-list" style={{ marginTop: 14 }}>
              {files.slice(0, 250).map((file) => (
                <div className="file-row" key={file.path}>
                  <span>{file.path}</span>
                  <span className="file-size">{formatSize(file.size)}</span>
                </div>
              ))}
              {files.length > 250 && <div className="file-row">...and {files.length - 250} more files</div>}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>3. Replace Mode</h2>

        <div className="mode-grid">
          <button className={replaceMode === "full" ? "mode active" : "mode"} onClick={() => setReplaceMode("full")} type="button">
            Full Repository Replace
            <small>Deletes everything by creating a new root tree from the ZIP.</small>
          </button>
          <button className={replaceMode === "selected" ? "mode active" : "mode"} onClick={() => setReplaceMode("selected")} type="button">
            Selected Folder Replace
            <small>Deletes listed paths first, then uploads ZIP files.</small>
          </button>
        </div>

        {replaceMode === "full" && (
          <div style={{ marginTop: 14 }}>
            <label>Type REPLACE to confirm full repository replacement</label>
            <input value={confirmReplace} onChange={(e) => setConfirmReplace(e.target.value)} placeholder="REPLACE" autoCapitalize="characters" />
          </div>
        )}

        {replaceMode === "selected" && (
          <div style={{ marginTop: 14 }}>
            <label>Delete these root paths first</label>
            <textarea value={deletePaths} onChange={(e) => setDeletePaths(e.target.value)} />
          </div>
        )}

        <div className="danger-note">
          Full Replace creates a new tree containing only your ZIP files. It avoids old files being left behind.
        </div>
      </section>

      <section className="card">
        <h2>4. Commit</h2>
        <p>The app creates Git blobs, a tree, a commit and updates your branch through the GitHub API.</p>
        <div className="actions">
          <button disabled={busy || !zipFile || (replaceMode === "full" && confirmReplace !== "REPLACE")} onClick={commitZip}>
            {busy ? "Committing..." : "Commit ZIP to GitHub"}
          </button>
          <button className="secondary" onClick={() => setStatus("")}>Clear status</button>
        </div>
      </section>

      {status && <section className="card"><pre className="status">{status}</pre></section>}

      <section className="warning">
        Keep your GitHub token private. Do not make this app public unless you add authentication.
      </section>
    </main>
  );
}
