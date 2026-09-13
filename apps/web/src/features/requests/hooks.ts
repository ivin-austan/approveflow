import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { requestApi } from "./api";

const requestKeys = {
  all: (organizationId: string) => ["requests", organizationId] as const,
  form: (organizationId: string, workflowId: string) =>
    ["request-form", organizationId, workflowId] as const,
  timeline: (organizationId: string, requestId: string) =>
    ["request-timeline", organizationId, requestId] as const,
};
export const useRequests = (organizationId: string) =>
  useQuery({
    queryKey: requestKeys.all(organizationId),
    queryFn: () => requestApi.list(organizationId),
  });
export const useRequestForm = (organizationId: string, workflowId: string) =>
  useQuery({
    queryKey: requestKeys.form(organizationId, workflowId),
    queryFn: () => requestApi.form(organizationId, workflowId),
    enabled: workflowId.length > 0,
  });
export const useRequestTimeline = (organizationId: string, requestId: string) =>
  useQuery({
    queryKey: requestKeys.timeline(organizationId, requestId),
    queryFn: () => requestApi.timeline(organizationId, requestId),
    enabled: organizationId.length > 0 && requestId.length > 0,
  });
export function useCreateRequest(organizationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      workflowId: string;
      title: string;
      answers: Record<string, unknown>;
    }) => requestApi.create(organizationId, input),
    onSuccess: async () =>
      client.invalidateQueries({ queryKey: requestKeys.all(organizationId) }),
  });
}

export function useResubmitRequest(organizationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { requestId: string; expectedRevision: number }) =>
      requestApi.resubmit(
        organizationId,
        input.requestId,
        input.expectedRevision,
      ),
    onSuccess: async () =>
      client.invalidateQueries({ queryKey: requestKeys.all(organizationId) }),
  });
}
