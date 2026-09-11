import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useParams } from "react-router";
import { z } from "zod";
import { workflowApi } from "./api";

const calendarSchema = z.object({
  name: z.string().min(1),
  timezone: z.string().min(1),
});
type CalendarForm = z.infer<typeof calendarSchema>;
const documentSchema = z.object({
  name: z.string().min(1),
  code: z.string().regex(/^[A-Za-z0-9_-]{2,20}$/),
  businessCalendarId: z.uuid(),
  numberFormat: z
    .string()
    .min(1)
    .max(200)
    .refine(
      (value) =>
        [
          "{DEPARTMENT_CODE}",
          "{DOCUMENT_TYPE_CODE}",
          "{YEAR}",
          "{SEQUENCE}",
        ].every((token) => value.includes(token)),
      "Number format must include department, document type, year, and sequence tokens.",
    ),
  sequencePadding: z.number().int().min(1).max(12),
  approvedPdfRetentionYears: z.number().int().min(1).max(25),
  automaticApprovalEnabled: z.boolean(),
  automaticApprovalAfterValue: z.number().int().positive().max(10_000),
  automaticApprovalAfterUnit: z.enum(["BUSINESS_HOURS", "BUSINESS_DAYS"]),
});
type DocumentForm = z.infer<typeof documentSchema>;

export function WorkflowSettingsPage() {
  const { organizationId = "" } = useParams();
  const client = useQueryClient();
  const calendars = useQuery({
    queryKey: ["calendars", organizationId],
    queryFn: () => workflowApi.calendars(organizationId),
  });
  const types = useQuery({
    queryKey: ["document-types", organizationId],
    queryFn: () => workflowApi.documentTypes(organizationId),
  });
  const calendarForm = useForm<CalendarForm>({
    resolver: zodResolver(calendarSchema),
    defaultValues: {
      name: "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });
  const documentForm = useForm<DocumentForm>({
    resolver: zodResolver(documentSchema),
    defaultValues: {
      name: "",
      code: "",
      businessCalendarId: "",
      numberFormat: "{DEPARTMENT_CODE}-{DOCUMENT_TYPE_CODE}-{YEAR}-{SEQUENCE}",
      sequencePadding: 5,
      approvedPdfRetentionYears: 7,
      automaticApprovalEnabled: false,
      automaticApprovalAfterValue: 1,
      automaticApprovalAfterUnit: "BUSINESS_DAYS",
    },
  });
  const automaticApprovalEnabled = documentForm.watch(
    "automaticApprovalEnabled",
  );
  return (
    <main className="page">
      <header className="mb-8">
        <Link
          className="text-blue-700 underline"
          to={`/organizations/${organizationId}/workflows`}
        >
          ← Workflows
        </Link>
        <p className="eyebrow mt-4">Administration</p>
        <h1 className="text-3xl font-bold">Workflow settings</h1>
        <p className="text-slate-600">
          Manage business time and document numbering inputs used by workflow
          versions.
        </p>
      </header>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel">
          <h2 className="text-xl font-bold">Business calendars</h2>
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              void calendarForm.handleSubmit(
                (value) =>
                  void workflowApi
                    .createCalendar(organizationId, {
                      ...value,
                      isDefault: calendars.data?.length === 0,
                      workPeriods: [1, 2, 3, 4, 5].map((weekday) => ({
                        weekday,
                        localStartTime: "09:00",
                        localEndTime: "17:00",
                      })),
                      holidays: [],
                    })
                    .then(async () => {
                      calendarForm.reset();
                      await client.invalidateQueries({
                        queryKey: ["calendars", organizationId],
                      });
                    }),
              )(event);
            }}
          >
            <label className="field-label">
              Name
              <input
                className="field-input"
                {...calendarForm.register("name")}
              />
            </label>
            <label className="field-label">
              IANA timezone
              <input
                className="field-input"
                {...calendarForm.register("timezone")}
              />
            </label>
            {Object.values(calendarForm.formState.errors).map((e) => (
              <p className="issue" key={e.message}>
                {e.message}
              </p>
            ))}
            <button className="button-primary" type="submit">
              Add calendar
            </button>
          </form>
          <ul className="mt-5 space-y-2">
            {calendars.data?.map((c) => (
              <li className="rounded bg-slate-50 p-3" key={c.id}>
                <strong>{c.name}</strong>
                <span className="ml-2 text-sm text-slate-600">
                  {c.timezone}
                  {c.isDefault ? " · Default" : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h2 className="text-xl font-bold">Document types</h2>
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              void documentForm.handleSubmit((value) => {
                const {
                  automaticApprovalEnabled: enabled,
                  automaticApprovalAfterValue,
                  automaticApprovalAfterUnit,
                  ...definition
                } = value;
                void workflowApi
                  .createDocumentType(organizationId, {
                    ...definition,
                    approvedPdfFieldPolicy: {
                      includeAllSubmittedFields: true,
                      excludedFieldIds: [],
                    },
                    automaticApproval: enabled
                      ? {
                          enabled: true,
                          after: {
                            value: automaticApprovalAfterValue,
                            unit: automaticApprovalAfterUnit,
                          },
                        }
                      : { enabled: false },
                  })
                  .then(async () => {
                    documentForm.reset();
                    await client.invalidateQueries({
                      queryKey: ["document-types", organizationId],
                    });
                  });
              })(event);
            }}
          >
            <label className="field-label">
              Name
              <input
                className="field-input"
                {...documentForm.register("name")}
              />
            </label>
            <label className="field-label">
              Code
              <input
                className="field-input uppercase"
                {...documentForm.register("code")}
              />
            </label>
            <label className="field-label">
              Business calendar
              <select
                className="field-input"
                {...documentForm.register("businessCalendarId")}
              >
                <option value="">Select…</option>
                {calendars.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Number format
              <input
                className="field-input font-mono text-sm"
                {...documentForm.register("numberFormat")}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="field-label">
                Sequence digits
                <input
                  className="field-input"
                  type="number"
                  min="1"
                  max="12"
                  {...documentForm.register("sequencePadding", {
                    valueAsNumber: true,
                  })}
                />
              </label>
              <label className="field-label">
                PDF retention years
                <input
                  className="field-input"
                  type="number"
                  min="1"
                  max="25"
                  {...documentForm.register("approvedPdfRetentionYears", {
                    valueAsNumber: true,
                  })}
                />
              </label>
            </div>
            <label className="flex items-center gap-2 font-semibold text-slate-700">
              <input
                type="checkbox"
                {...documentForm.register("automaticApprovalEnabled")}
              />
              Automatically approve incomplete stages after a threshold
            </label>
            {automaticApprovalEnabled && (
              <div className="grid grid-cols-2 gap-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                <label className="field-label">
                  Approval threshold
                  <input
                    className="field-input"
                    type="number"
                    min="1"
                    max="10000"
                    {...documentForm.register("automaticApprovalAfterValue", {
                      valueAsNumber: true,
                    })}
                  />
                </label>
                <label className="field-label">
                  Business-time unit
                  <select
                    className="field-input"
                    {...documentForm.register("automaticApprovalAfterUnit")}
                  >
                    <option value="BUSINESS_HOURS">Business hours</option>
                    <option value="BUSINESS_DAYS">Business days</option>
                  </select>
                </label>
              </div>
            )}
            {Object.values(documentForm.formState.errors).map((e) => (
              <p className="issue" key={e.message}>
                {e.message}
              </p>
            ))}
            <button className="button-primary" type="submit">
              Add document type
            </button>
          </form>
          <ul className="mt-5 space-y-2">
            {types.data?.map((t) => (
              <li className="rounded bg-slate-50 p-3" key={t.id}>
                <strong>{t.name}</strong>
                <span className="ml-2 text-sm text-slate-600">{t.code}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
