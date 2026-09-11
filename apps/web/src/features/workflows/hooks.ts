import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workflowApi } from "./api";
import type { WorkflowDraft } from "./types";
const key = (o: string, w: string, v: string) => ["workflow", o, w, v] as const;
export const useWorkflow = (o: string, w: string, v: string) =>
  useQuery({ queryKey: key(o, w, v), queryFn: () => workflowApi.get(o, w, v) });
export function useSaveWorkflow(o: string, w: string, v: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: WorkflowDraft) => workflowApi.save(o, w, v, draft),
    onSuccess: async () => client.invalidateQueries({ queryKey: key(o, w, v) }),
  });
}
