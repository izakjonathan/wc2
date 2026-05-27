"use client";

import { useMemo, useState } from "react";
import JSZip from "jszip";

const DEFAULT_DELETE = ["app", "components", "data", "public"];

function cleanPath(path) {
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
  const [deleteExisting, setDeleteExisting] = useState(true);
  const [nuclearMode, setNuclearMode] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState("");
  const [deletePaths, setDeletePaths] = useState(DEFAULT_DELETE.join("\n"));
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [repoStatus, setRepoStatus] = useState("");

  const summary = useMemo(() => {
    const total = files.reduce((sum, file) => sum + file.size, 0);
    const folders = new Set(files.map((file) => file.path.split("/")[0]).filter(Boolean));
    return { total, folders: folders.size };
  }, [files]);

  async function handleZip(file) {
    setZipFile(file || null);
    setFiles([]);
    setStatus("");

    if (!file) return;

    try {
      const zip = await JSZip.loadAsync(file);
      const next = [];

      zip.forEach((relativePath, entry) => {
        const path = cleanPath(relativePath);
        if (!entry.dir && !isNoise(path)) {
          next.push({
            path,
            size: entry._data?.uncompressedSize || 0
          });
        }
      });

      setFiles(next.sort((a, b) => a.path.localeCompare(b.path)));
    } catch (error) {
      setStatus(`Could not read ZIP: ${error.message}`);
    }
  }

  async function checkRepo() {
    if (!owner || !repo || !branch) {
      setRepoStatus("Enter owner, repo and branch first.");
      return;
    }

    setRepoStatus("Checking repository...");
    try {
      const res = await fetch("/api/check-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo, branch })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Check failed.");
      setRepoStatus(`OK: ${data.fullName} / ${branch}\nLatest commit: ${data.commitSha}`);
    } catch (error) {
      setRepoStatus(`Error: ${error.message}`);
    }
  }

  async function commitZip() {
    if (!owner || !repo || !branch || !message || !zipFile) {
      
      setStatus("Missing owner, repo, branch, commit message or ZIP.");
      return;
    }

    if (nuclearMode && confirmReplace !== "REPLACE") { setStatus("Type REPLACE to enable full repository replacement."); return; }
    if (!files.some(f => f.path === "package.json" || f.path.endsWith("/package.json"))) { setStatus("ZIP must contain package.json"); return; }

    const confirmText = nuclearMode ? `WARNING: This will delete ALL files in ${owner}/${repo}:${branch} and replace them with the ZIP.` : deleteExisting
      ? `This will delete matching paths first:\n${deletePaths}\n\nThen upload ${files.length} files and commit to ${owner}/${repo}:${branch}.`
      : `This will upload ${files.length} files and commit to ${owner}/${repo}:${branch}.`;

    if (!window.confirm(confirmText)) return;

    setBusy(true);
    setStatus("Uploading ZIP and creating GitHub commit...");

    try {
      const form = new FormData();
      form.append("owner", owner.trim());
      form.append("repo", repo.trim());
      form.append("branch", branch.trim());
      form.append("message", message.trim());
      form.append("deleteExisting", deleteExisting ? "true" : "false");
      form.append("nuclearMode", nuclearMode ? "true":"false");
      form.append("deletePaths", deletePaths);
      form.append("zip", zipFile);

      const res = await fetch("/api/commit-zip", {
        method: "POST",
        body: form
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Commit failed.");

      setStatus(
        `SUCCESS\n\nRepository: ${owner}/${repo}\nBranch: ${branch}\nCommit: ${data.commitSha}\nFiles uploaded: ${data.filesUploaded}\nDeleted first: ${data.deletedPaths?.join(", ") || "none"}\n\nVercel should deploy automatically if connected.`
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
        A mobile-friendly tool for uploading a ZIP build, replacing project folders and committing directly to GitHub.
      </p>

      <section className="card">
        <h2>1. Repository</h2>
        <div className="grid">
          <div>
            <label>GitHub owner</label>
            <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="username-or-org" />
          </div>
          <div>
            <label>Repository</label>
            <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="portfolio" />
          </div>
          <div>
            <label>Branch</label>
            <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
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

        {!!files.length && (
          <>
            <div className="stat-grid" style={{ marginTop: 14 }}>
              <div className="stat"><b>{files.length}</b><span>Files</span></div>
              <div className="stat"><b>{formatSize(summary.total)}</b><span>Total size</span></div>
              <div className="stat"><b>{summary.folders}</b><span>Root folders</span></div>
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
        <h2>3. Replacement Mode</h2>
        <div className="toggle">
          <input id="deleteExisting" type="checkbox" checked={deleteExisting} onChange={(e) => setDeleteExisting(e.target.checked)} />
          <label htmlFor="deleteExisting" style={{ margin: 0 }}>
            Delete existing folders/files before uploading
            <br />
            <small>Recommended when replacing an entire portfolio build.</small>
          </label>
        </div>

        <div style={{ marginTop: 14 }}>
          <label>Delete these root paths first</label>
          <textarea value={deletePaths} onChange={(e) => setDeletePaths(e.target.value)} />
        </div>

        <div className="toggle" style={{marginBottom:14}}><input type="checkbox" checked={nuclearMode} onChange={(e)=>setNuclearMode(e.target.checked)} /><label style={{margin:0}}>Full Repository Replace (delete EVERYTHING first)</label></div>{nuclearMode && <><label>Type REPLACE</label><input value={confirmReplace} onChange={(e)=>setConfirmReplace(e.target.value)} placeholder="REPLACE" /></>}<div className="danger-note">
          This app does not merge conflicts. Use it to replace known folders on a branch you control.
        </div>
      </section>

      <section className="card">
        <h2>4. Commit</h2>
        <p>
          The app creates a Git tree, commit and branch update using the GitHub API.
        </p>
        <div className="actions">
          <button disabled={busy || !zipFile} onClick={commitZip}>
            {busy ? "Committing..." : "Commit ZIP to GitHub"}
          </button>
          <button className="secondary" onClick={() => setStatus("")}>Clear status</button>
        </div>
      </section>

      {status && <section className="card"><pre className="status">{status}</pre></section>}

      <section className="warning">
        Keep your GitHub token private. Do not put this app online publicly unless you add proper authentication.
      </section>
    </main>
  );
}
