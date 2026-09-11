import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFieldArray, useForm } from "react-hook-form";
import { Link, useParams } from "react-router";
import { z } from "zod";
import { workflowApi } from "./api";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const calendarSchema = z
  .object({
    name: z.string().min(1),
    timezone: z.string().min(1),
    weekdays: z.array(z.enum(["1", "2", "3", "4", "5", "6", "7"])).min(1),
    localStartTime: timeSchema,
    localEndTime: timeSchema,
    holidays: z.array(
      z.object({
        localDate: z.iso.date(),
        name: z.string().min(1).max(120),
        isWorkingDayOverride: z.boolean(),
      }),
    ),
  })
  .refine((value) => value.localStartTime < value.localEndTime, {
    path: ["localEndTime"],
    message: "End time must be after start time.",
  });
type CalendarForm = z.infer<typeof calendarSchema>;
const holidayPath = <Key extends "localDate" | "name">(
  index: number,
  key: Key,
): `holidays.${number}.${Key}` =>
  ["holidays", index.toString(), key].join(".") as `holidays.${number}.${Key}`;
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
      weekdays: ["1", "2", "3", "4", "5"],
      localStartTime: "09:00",
      localEndTime: "17:00",
      holidays: [],
    },
  });
  const holidays = useFieldArray({
    control: calendarForm.control,
    name: "holidays",
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
              void calendarForm.handleSubmit((value) => {
                const { weekdays, localStartTime, localEndTime, ...calendar } =
                  value;
                void workflowApi
                  .createCalendar(organizationId, {
                    ...calendar,
                    isDefault: calendars.data?.length === 0,
                    workPeriods: weekdays.map((weekday) => ({
                      weekday: Number(weekday),
                      localStartTime,
                      localEndTime,
                    })),
                  })
                  .then(async () => {
                    calendarForm.reset();
                    await client.invalidateQueries({
                      queryKey: ["calendars", organizationId],
                    });
                  });
              })(event);
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
            <fieldset>
              <legend className="field-label">Working days</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {[
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                  "Sunday",
                ].map((day, index) => (
                  <label className="flex items-center gap-1 text-sm" key={day}>
                    <input
                      type="checkbox"
                      value={index + 1}
                      {...calendarForm.register("weekdays")}
                    />
                    {day.slice(0, 3)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <label className="field-label">
                Workday starts
                <input
                  className="field-input"
                  type="time"
                  {...calendarForm.register("localStartTime")}
                />
              </label>
              <label className="field-label">
                Workday ends
                <input
                  className="field-input"
                  type="time"
                  {...calendarForm.register("localEndTime")}
                />
              </label>
            </div>
            <fieldset className="rounded-md border border-slate-200 p-3">
              <legend className="px-1 text-sm font-semibold">Holidays</legend>
              <div className="space-y-2">
                {holidays.fields.map((holiday, index) => (
                  <div
                    className="grid items-end gap-2 md:grid-cols-[1fr_1fr_auto]"
                    key={holiday.id}
                  >
                    <label className="field-label">
                      Date
                      <input
                        className="field-input"
                        type="date"
                        {...calendarForm.register(
                          holidayPath(index, "localDate"),
                        )}
                      />
                    </label>
                    <label className="field-label">
                      Holiday name
                      <input
                        className="field-input"
                        {...calendarForm.register(holidayPath(index, "name"))}
                      />
                    </label>
                    <button
                      aria-label={`Remove holiday ${String(index + 1)}`}
                      className="icon-button danger"
                      onClick={() => {
                        holidays.remove(index);
                      }}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="button-secondary mt-3"
                onClick={() => {
                  holidays.append({
                    localDate: "",
                    name: "",
                    isWorkingDayOverride: false,
                  });
                }}
                type="button"
              >
                Add holiday
              </button>
            </fieldset>
            {Object.entries(calendarForm.formState.errors).map(
              ([key, error]) =>
                error.message ? (
                  <p className="issue" key={key}>
                    {error.message}
                  </p>
                ) : null,
            )}
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
            {Object.entries(documentForm.formState.errors).map(
              ([key, error]) =>
                error.message ? (
                  <p className="issue" key={key}>
                    {error.message}
                  </p>
                ) : null,
            )}
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
