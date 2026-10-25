import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { githubApprovals } from "../src/github.js";
import type { Approvals } from "../src/signoff.js";
import { commitAll, git } from "./support/git.js";
import { createProject, writeFiles } from "./support/project.js";

type Review = { user: string; state: string; commit: string };

async function githubServer({
  t,
  headSha,
  reviews = [],
  status = 200,
}: {
  t: TestContext;
  headSha: string;
  reviews?: Review[];
  status?: number;
}): Promise<{ apiUrl: string; requests: { url: string; headers: IncomingHttpHeaders }[] }> {
  const requests: { url: string; headers: IncomingHttpHeaders }[] = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url ?? "", headers: request.headers });
    const url = new URL(request.url ?? "", "http://localhost");
    response.setHeader("content-type", "application/json");
    if (status !== 200) {
      response.statusCode = status;
      response.end("{}");
      return;
    }
    if (url.pathname === "/repos/owner/repo/pulls/7") {
      response.end(JSON.stringify({ head: { sha: headSha } }));
      return;
    }
    if (url.pathname === "/repos/owner/repo/pulls/7/reviews") {
      const page = Number(url.searchParams.get("page"));
      const pageReviews = reviews.slice((page - 1) * 100, page * 100);
      response.end(JSON.stringify(pageReviews.map((review) => ({ user: { login: review.user }, state: review.state, commit_id: review.commit }))));
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return { apiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

async function repository(t: TestContext): Promise<{ projectDirectory: string; head: string; older: string }> {
  const projectDirectory = await createProject({ t, files: { "a.txt": "1\n" } });
  const older = commitAll({ projectDirectory, message: "older" });
  await writeFiles({ projectDirectory, files: { "a.txt": "2\n" } });
  const head = commitAll({ projectDirectory, message: "head" });
  return { projectDirectory, head, older };
}

async function approvalsFrom({
  projectDirectory,
  apiUrl,
  token = "secret",
}: {
  projectDirectory: string;
  apiUrl: string;
  token?: string;
}): Promise<Approvals> {
  return githubApprovals({ projectDirectory, repository: "owner/repo", pullRequest: 7, token, apiUrl });
}

test("only each reviewer's latest decisive review of the head commit counts as approval", async (t) => {
  const { projectDirectory, head, older } = await repository(t);
  const { apiUrl, requests } = await githubServer({
    t,
    headSha: head,
    reviews: [
      { user: "alice", state: "APPROVED", commit: head },
      { user: "alice", state: "COMMENTED", commit: head },
      { user: "bob", state: "APPROVED", commit: older },
      { user: "carol", state: "APPROVED", commit: head },
      { user: "carol", state: "CHANGES_REQUESTED", commit: head },
      { user: "dave", state: "APPROVED", commit: head },
      { user: "dave", state: "DISMISSED", commit: head },
    ],
  });

  const approvals = await approvalsFrom({ projectDirectory, apiUrl });

  assert.deepEqual(approvals, { status: "available", approvers: ["alice"] });
  assert.equal(requests[0]?.headers.authorization, "Bearer secret");
});

test("reviews on later pages are read", async (t) => {
  const { projectDirectory, head } = await repository(t);
  const comments = Array.from({ length: 100 }, (_, index) => ({ user: `user-${index}`, state: "COMMENTED", commit: head }));
  const { apiUrl } = await githubServer({ t, headSha: head, reviews: [...comments, { user: "alice", state: "APPROVED", commit: head }] });

  assert.deepEqual(await approvalsFrom({ projectDirectory, apiUrl }), { status: "available", approvers: ["alice"] });
});

test("a merge commit whose second parent is the head is accepted", async (t) => {
  const { projectDirectory, head } = await repository(t);
  git({ projectDirectory, args: ["checkout", "-q", "-b", "merge-ref", "HEAD~1"] });
  await writeFiles({ projectDirectory, files: { "b.txt": "base\n" } });
  commitAll({ projectDirectory, message: "base change" });
  git({ projectDirectory, args: ["-c", "user.email=premise@example.com", "-c", "user.name=Premise", "merge", "-q", "--no-edit", head] });
  const { apiUrl } = await githubServer({ t, headSha: head, reviews: [{ user: "alice", state: "APPROVED", commit: head }] });

  assert.deepEqual(await approvalsFrom({ projectDirectory, apiUrl }), { status: "available", approvers: ["alice"] });
});

test("a checkout that is not the pull request's head is unavailable", async (t) => {
  const { projectDirectory, older } = await repository(t);
  const { apiUrl } = await githubServer({ t, headSha: older, reviews: [{ user: "alice", state: "APPROVED", commit: older }] });

  const approvals = await approvalsFrom({ projectDirectory, apiUrl });

  assert.equal(approvals.status, "unavailable");
  assert.match(approvals.status === "unavailable" ? approvals.reason : "", /checkout is not the pull request head [0-9a-f]{7}/);
});

test("a GitHub API error is unavailable", async (t) => {
  const { projectDirectory, head } = await repository(t);
  const { apiUrl } = await githubServer({ t, headSha: head, status: 401 });

  assert.deepEqual(await approvalsFrom({ projectDirectory, apiUrl }), { status: "unavailable", reason: "GitHub API returned HTTP 401" });
});

test("a missing token is unavailable without a request", async (t) => {
  const { projectDirectory, head } = await repository(t);
  const { apiUrl, requests } = await githubServer({ t, headSha: head });

  assert.deepEqual(await approvalsFrom({ projectDirectory, apiUrl, token: "" }), { status: "unavailable", reason: "GITHUB_TOKEN is not set" });
  assert.equal(requests.length, 0);
});
