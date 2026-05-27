# GitHub ZIP Committer MVP

A mobile-first web app for replacing folders in a GitHub repository using a ZIP file.

Designed for an iPad/iPhone workflow:

ChatGPT ZIP → Upload ZIP → Preview files → Commit to GitHub → Vercel deploys

## Features

- Enter GitHub owner / repo / branch
- Upload a ZIP
- Preview files inside the ZIP
- Choose folders/files to delete first
- Create a single Git commit using GitHub's Git API
- Supports text and binary files
- Mobile-friendly UI

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add your token to `.env.local`:

```bash
GITHUB_TOKEN=github_pat_...
```

## Create a GitHub token

GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens

Repository access:
- Choose only the repo you want

Repository permissions:
- Contents: Read and write
- Metadata: Read

## Use

1. Open the app.
2. Enter owner, repo, branch.
3. Upload the ZIP.
4. Keep "Delete existing project folders" enabled for full project replacement.
5. Commit.

Default folders deleted first:

```text
app
components
data
public
```

## Important

This app is intentionally simple. It does not do merge conflict resolution. Use it on a branch or repo where you are comfortable replacing files.


## 404 get tree fix

This build handles GitHub's `GET /git/trees/:sha` 404 response by treating it as an empty existing tree during repository replacement. This avoids failures when the target repository is empty or has an empty tree.
