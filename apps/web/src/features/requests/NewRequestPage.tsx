import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { workflowApi } from "../workflows/api";
import { useCreateRequest, useRequestForm } from "./hooks";

interface Values {
  title: string;
  answers: Record<string, string | number | boolean | string[]>;
}
export function NewRequestPage() {
  const { organizationId = "" } = useParams();
  const navigate = useNavigate();
  const [workflowId, setWorkflowId] = useState("");
  const workflows = useQuery({
    queryKey: ["workflows", organizationId],
    queryFn: () => workflowApi.list(organizationId),
  });
  const formQuery = useRequestForm(organizationId, workflowId);
  const mutation = useCreateRequest(organizationId);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ defaultValues: { title: "", answers: {} } });
  const submit = handleSubmit(async (values) => {
    await mutation.mutateAsync({
      workflowId,
      title: values.title,
      answers: values.answers,
    });
    void navigate(`/organizations/${organizationId}/requests`);
  });
  return (
    <main className="page">
      <p className="eyebrow">Request</p>
      <h1 className="mb-6 text-3xl font-bold">New request</h1>
      <form
        className="panel space-y-5"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <label className="field-label">
          Workflow
          <select
            className="field-input"
            value={workflowId}
            onChange={(event) => {
              setWorkflowId(event.target.value);
            }}
            required
          >
            <option value="">Select a workflow</option>
            {workflows.data
              ?.filter((item) => item.currentPublishedVersionId)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field-label">
          Title
          <input
            className="field-input"
            {...register("title", { required: "Title is required" })}
          />
          {errors.title && (
            <span className="issue block">{errors.title.message}</span>
          )}
        </label>
        {formQuery.isLoading && (
          <div className="skeleton h-32" aria-label="Loading form" />
        )}
        {formQuery.data?.sections.map((section) => (
          <fieldset className="space-y-4 border-t pt-5" key={section.id}>
            <legend className="text-lg font-bold">{section.name}</legend>
            {section.description && (
              <p className="text-sm text-slate-600">{section.description}</p>
            )}
            {section.fields.map((field) => (
              <label className="field-label" key={field.id}>
                {field.label}
                {field.type === "BOOLEAN" ? (
                  <input
                    className="ml-3"
                    type="checkbox"
                    {...register(`answers.${field.id}`)}
                  />
                ) : field.type === "SINGLE_SELECT" ? (
                  <select
                    className="field-input"
                    {...register(`answers.${field.id}`, {
                      required: field.required,
                    })}
                  >
                    <option value="">Select</option>
                    {field.optionValues.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="field-input"
                    type={
                      field.type === "DATE"
                        ? "date"
                        : field.type === "NUMBER" || field.type === "MONEY"
                          ? "number"
                          : "text"
                    }
                    {...register(`answers.${field.id}`, {
                      required: field.required,
                      valueAsNumber:
                        field.type === "NUMBER" || field.type === "MONEY",
                    })}
                  />
                )}
              </label>
            ))}
          </fieldset>
        ))}
        {mutation.isError && (
          <div className="issue">
            The request could not be saved. Check the form and try again.
          </div>
        )}
        <button
          className="button-primary"
          disabled={!workflowId || mutation.isPending}
          type="submit"
        >
          {mutation.isPending ? "Saving…" : "Save draft"}
        </button>
      </form>
    </main>
  );
}
