import { commitOf } from "./git.js";
import type { Approvals } from "./signoff.js";
import { arrayOf, errorMessage, isRecord } from "./text.js";

export const GITHUB_API_URL = "https://api.github.com";

const PAGE_SIZE = 100;
const DECISIVE_STATES = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);

type GitHubRequest = { apiUrl: string; token: string; path: string };

export async function githubApprovals({
  projectDirectory,
  repository,
  pullRequest,
  token,
  apiUrl,
}: {
  projectDirectory: string;
  repository: string;
  pullRequest: number;
  token: string;
  apiUrl: string;
}): Promise<Approvals> {
  if (token.trim() === "") {
    return { status: "unavailable", reason: "GITHUB_TOKEN is not set" };
  }
  try {
    const pull = await getJson({ apiUrl, token, path: `/repos/${repository}/pulls/${pullRequest}` });
    const headSha = isRecord(pull) && isRecord(pull.head) && typeof pull.head.sha === "string" ? pull.head.sha : undefined;
    if (headSha === undefined) {
      return { status: "unavailable", reason: "pull request has no head commit" };
    }
    if (!(await checkoutIsHead({ projectDirectory, headSha }))) {
      return { status: "unavailable", reason: `checkout is not the pull request head ${headSha.slice(0, 7)}` };
    }
    const reviews = await allReviews({ apiUrl, token, path: `/repos/${repository}/pulls/${pullRequest}/reviews` });
    return { status: "available", approvers: approversOf({ reviews, headSha }) };
  } catch (error) {
    return { status: "unavailable", reason: errorMessage(error) };
  }
}

async function checkoutIsHead({ projectDirectory, headSha }: { projectDirectory: string; headSha: string }): Promise<boolean> {
  const head = await commitOf({ projectDirectory, ref: "HEAD" });
  const mergedHead = await commitOf({ projectDirectory, ref: "HEAD^2" });
  return head === headSha || mergedHead === headSha;
}

async function allReviews({ apiUrl, token, path }: GitHubRequest): Promise<unknown[]> {
  const reviews: unknown[] = [];
  for (let page = 1; ; page += 1) {
    const batch = arrayOf(await getJson({ apiUrl, token, path: `${path}?per_page=${PAGE_SIZE}&page=${page}` }));
    reviews.push(...batch);
    if (batch.length < PAGE_SIZE) {
      return reviews;
    }
  }
}

function approversOf({ reviews, headSha }: { reviews: unknown[]; headSha: string }): string[] {
  const latest = new Map<string, { state: string; commit: unknown }>();
  for (const review of reviews) {
    if (!isRecord(review) || !isRecord(review.user) || typeof review.user.login !== "string" || typeof review.state !== "string") {
      continue;
    }
    if (DECISIVE_STATES.has(review.state)) {
      latest.set(review.user.login, { state: review.state, commit: review.commit_id });
    }
  }
  return [...latest]
    .filter(([, review]) => review.state === "APPROVED" && review.commit === headSha)
    .map(([login]) => login);
}

async function getJson({ apiUrl, token, path }: GitHubRequest): Promise<unknown> {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub API returned HTTP ${response.status}`);
  }
  return response.json();
}
