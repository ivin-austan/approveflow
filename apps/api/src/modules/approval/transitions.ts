export type RequestState =
  "DRAFT" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "RETURNED" | "CANCELLED";
export type StageState = "PENDING" | "ACTIVE" | "COMPLETED" | "SKIPPED";
export type TaskState =
  | "PENDING"
  | "ACTIVE"
  | "APPROVED"
  | "REJECTED"
  | "RETURNED"
  | "SKIPPED"
  | "REASSIGNED";

const requestTransitions: Readonly<
  Record<RequestState, readonly RequestState[]>
> = {
  DRAFT: ["IN_REVIEW", "APPROVED", "CANCELLED"],
  IN_REVIEW: ["APPROVED", "REJECTED", "RETURNED", "CANCELLED"],
  APPROVED: [],
  REJECTED: [],
  RETURNED: ["IN_REVIEW", "APPROVED", "CANCELLED"],
  CANCELLED: [],
};
const stageTransitions: Readonly<Record<StageState, readonly StageState[]>> = {
  PENDING: ["ACTIVE", "SKIPPED"],
  ACTIVE: ["COMPLETED", "SKIPPED"],
  COMPLETED: [],
  SKIPPED: [],
};
const taskTransitions: Readonly<Record<TaskState, readonly TaskState[]>> = {
  PENDING: ["ACTIVE", "SKIPPED"],
  ACTIVE: ["APPROVED", "REJECTED", "RETURNED", "SKIPPED", "REASSIGNED"],
  APPROVED: [],
  REJECTED: [],
  RETURNED: [],
  SKIPPED: [],
  REASSIGNED: [],
};
export const canTransitionRequest = (from: RequestState, to: RequestState) =>
  requestTransitions[from].includes(to);
export const canTransitionStage = (from: StageState, to: StageState) =>
  stageTransitions[from].includes(to);
export const canTransitionTask = (from: TaskState, to: TaskState) =>
  taskTransitions[from].includes(to);
