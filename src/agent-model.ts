export type AgentBlocker = {
  kind: "premise" | "decision" | "history" | "evaluation" | "session";
  id?: string;
  state?: string;
  source?: { uri: string };
  message: string;
};

export type AgentAdvisory = {
  id: string;
  status: "supported" | "concern" | "uncertain" | "unavailable";
  message: string;
  probability?: number;
  model?: string;
};

export type AgentReport = {
  status: "ready" | "passed" | "blocked" | "inactive";
  blockers: AgentBlocker[];
  advisories: AgentAdvisory[];
  instructions?: string;
};

export type AgentSessionInput = {
  projectDirectory: string;
  sessionId: string;
};
