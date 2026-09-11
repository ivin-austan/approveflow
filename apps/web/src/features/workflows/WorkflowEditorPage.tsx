import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { workflowApi } from "./api";
import { useSaveWorkflow, useWorkflow } from "./hooks";
import type {
  ApproverOption,
  Assignment,
  FieldType,
  FormField,
  FormSection,
  Stage,
  ValidationIssue,
  WorkflowDraft,
} from "./types";

const uid = () => crypto.randomUUID();
const ordered = (items: Stage[]) =>
  items.map((item, index) => ({ ...item, position: index + 1 }));
const makeStage = (position: number): Stage => ({
  id: uid(),
  name: `Approval level ${String(position)}`,
  description: null,
  instructions: null,
  position,
  completionPolicy: "ANY",
  dueDuration: null,
  businessCalendarId: null,
  activationCondition: null,
  approvers: [
    { id: uid(), assignmentType: "REQUESTER_MANAGER", displayOrder: 1 },
  ],
  reminders: [],
  escalations: [],
});
const makeSection = (position: number): FormSection => ({
  id: uid(),
  stableKey: `section${String(position)}`,
  name: `Section ${String(position)}`,
  description: null,
  position,
  fields: [],
});
const makeField = (position: number): FormField => ({
  id: uid(),
  stableKey: `field${String(Date.now())}`,
  label: "New field",
  type: "SHORT_TEXT",
  description: null,
  required: false,
  position,
  config: {},
  options: [],
});

function assignment(
  type: Assignment["assignmentType"],
  draft: WorkflowDraft,
): Assignment | null {
  const base = { id: uid(), displayOrder: 1 };
  if (type === "REQUESTER_MANAGER") return { ...base, assignmentType: type };
  if (type === "MEMBERSHIP") return null;
  if (type === "ROLE") return null;
  if (type === "DEPARTMENT_ROLE") return null;
  const fieldId = draft.formSections
    .flatMap((s) => s.fields)
    .find((f) => f.type === "MEMBER_SELECTOR")?.id;
  return fieldId
    ? { ...base, assignmentType: type, formFieldId: fieldId }
    : null;
}

function FormBuilder({
  draft,
  change,
  issues,
}: {
  draft: WorkflowDraft;
  change: (value: WorkflowDraft) => void;
  issues: ValidationIssue[];
}) {
  const updateSection = (
    id: string,
    update: (section: FormSection) => FormSection,
  ) => {
    change({
      ...draft,
      formSections: draft.formSections.map((s) =>
        s.id === id ? update(s) : s,
      ),
    });
  };
  return (
    <section aria-labelledby="form-builder-title" className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h2 id="form-builder-title" className="text-2xl font-bold">
            Request Form
          </h2>
          <p className="text-sm text-slate-600">
            Build the fields requesters complete. Member selectors are
            tenant-validated before use as approvers.
          </p>
        </div>
        <button
          className="button-secondary"
          onClick={() => {
            change({
              ...draft,
              formSections: [
                ...draft.formSections,
                makeSection(draft.formSections.length + 1),
              ],
            });
          }}
        >
          <Plus size={18} /> Add section
        </button>
      </div>
      {draft.formSections.length === 0 && (
        <div className="empty-state">
          No form sections yet. Add one to collect request information.
        </div>
      )}
      {draft.formSections.map((section) => (
        <article key={section.id} className="panel">
          <div className="flex items-start gap-3">
            <div className="grid flex-1 gap-2">
              <label className="field-label">
                Section name
                <input
                  className="field-input"
                  value={section.name}
                  onChange={(e) => {
                    updateSection(section.id, (s) => ({
                      ...s,
                      name: e.target.value,
                    }));
                  }}
                />
              </label>
              <label className="field-label">
                Stable key
                <input
                  className="field-input"
                  value={section.stableKey}
                  onChange={(e) => {
                    updateSection(section.id, (s) => ({
                      ...s,
                      stableKey: e.target.value,
                    }));
                  }}
                />
              </label>
            </div>
            <button
              aria-label={`Delete ${section.name}`}
              className="icon-button danger"
              onClick={() => {
                if (confirm(`Delete ${section.name}?`))
                  change({
                    ...draft,
                    formSections: draft.formSections
                      .filter((s) => s.id !== section.id)
                      .map((s, i) => ({ ...s, position: i + 1 })),
                  });
              }}
            >
              <Trash2 />
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {section.fields.map((field) => (
              <div key={field.id} className="rounded-lg border bg-slate-50 p-3">
                <div className="grid gap-3 md:grid-cols-4">
                  <label className="field-label md:col-span-2">
                    Label
                    <input
                      className="field-input"
                      value={field.label}
                      onChange={(e) => {
                        updateSection(section.id, (s) => ({
                          ...s,
                          fields: s.fields.map((f) =>
                            f.id === field.id
                              ? { ...f, label: e.target.value }
                              : f,
                          ),
                        }));
                      }}
                    />
                  </label>
                  <label className="field-label">
                    Type
                    <select
                      className="field-input"
                      value={field.type}
                      onChange={(e) => {
                        updateSection(section.id, (s) => ({
                          ...s,
                          fields: s.fields.map((f) =>
                            f.id === field.id
                              ? {
                                  ...f,
                                  type: e.target.value as FieldType,
                                  options: [
                                    "SINGLE_SELECT",
                                    "MULTI_SELECT",
                                  ].includes(e.target.value)
                                    ? f.options.length
                                      ? f.options
                                      : [
                                          {
                                            id: uid(),
                                            stableValue: "option1",
                                            label: "Option 1",
                                            position: 1,
                                          },
                                        ]
                                    : [],
                                }
                              : f,
                          ),
                        }));
                      }}
                    >
                      {[
                        "SHORT_TEXT",
                        "LONG_TEXT",
                        "NUMBER",
                        "MONEY",
                        "DATE",
                        "BOOLEAN",
                        "SINGLE_SELECT",
                        "MULTI_SELECT",
                        "MEMBER_SELECTOR",
                      ].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <div className="flex items-end gap-2">
                    <label className="mb-2 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => {
                          updateSection(section.id, (s) => ({
                            ...s,
                            fields: s.fields.map((f) =>
                              f.id === field.id
                                ? { ...f, required: e.target.checked }
                                : f,
                            ),
                          }));
                        }}
                      />
                      Required
                    </label>
                    <button
                      aria-label={`Delete ${field.label}`}
                      className="icon-button danger"
                      onClick={() => {
                        updateSection(section.id, (s) => ({
                          ...s,
                          fields: s.fields
                            .filter((f) => f.id !== field.id)
                            .map((f, i) => ({ ...f, position: i + 1 })),
                        }));
                      }}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
                {issues
                  .filter((i) => i.entityId === field.id)
                  .map((i) => (
                    <p className="issue" key={i.code}>
                      {i.message}
                    </p>
                  ))}
              </div>
            ))}
            <button
              className="button-secondary"
              onClick={() => {
                updateSection(section.id, (s) => ({
                  ...s,
                  fields: [...s.fields, makeField(s.fields.length + 1)],
                }));
              }}
            >
              <Plus size={18} /> Add field
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}

function RepresentativeAnswers({
  draft,
  memberships,
  answers,
  change,
}: {
  draft: WorkflowDraft;
  memberships: ApproverOption[];
  answers: Readonly<Record<string, unknown>>;
  change: (fieldId: string, value: unknown) => void;
}) {
  const fields = draft.formSections.flatMap((section) => section.fields);
  if (fields.length === 0) return null;
  return (
    <details className="panel mb-6">
      <summary className="cursor-pointer font-semibold">
        Representative preview answers
      </summary>
      <p className="mt-2 text-sm text-slate-600">
        Supply example answers to evaluate conditional approval stages.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {fields.map((field) => {
          const value = answers[field.id];
          if (field.type === "BOOLEAN")
            return (
              <label
                className="field-label flex items-center gap-2"
                key={field.id}
              >
                <input
                  type="checkbox"
                  checked={value === true}
                  onChange={(event) => {
                    change(field.id, event.target.checked);
                  }}
                />
                {field.label}
              </label>
            );
          if (field.type === "SINGLE_SELECT" || field.type === "MULTI_SELECT")
            return (
              <label className="field-label" key={field.id}>
                {field.label}
                <select
                  className="field-input"
                  multiple={field.type === "MULTI_SELECT"}
                  value={
                    field.type === "MULTI_SELECT"
                      ? Array.isArray(value)
                        ? value.map(String)
                        : []
                      : typeof value === "string"
                        ? value
                        : ""
                  }
                  onChange={(event) => {
                    change(
                      field.id,
                      field.type === "MULTI_SELECT"
                        ? [...event.target.selectedOptions].map(
                            (option) => option.value,
                          )
                        : event.target.value,
                    );
                  }}
                >
                  {field.type === "SINGLE_SELECT" && (
                    <option value="">Select…</option>
                  )}
                  {field.options.map((option) => (
                    <option key={option.id} value={option.stableValue}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          if (field.type === "MEMBER_SELECTOR")
            return (
              <OptionSelect
                key={field.id}
                label={field.label}
                options={memberships}
                value={typeof value === "string" ? value : undefined}
                onChange={(membershipId) => {
                  change(field.id, membershipId);
                }}
              />
            );
          return (
            <label className="field-label" key={field.id}>
              {field.label}
              <input
                className="field-input"
                type={
                  field.type === "NUMBER" || field.type === "MONEY"
                    ? "number"
                    : field.type === "DATE"
                      ? "date"
                      : "text"
                }
                value={
                  typeof value === "string" || typeof value === "number"
                    ? value
                    : ""
                }
                onChange={(event) => {
                  change(
                    field.id,
                    field.type === "NUMBER" || field.type === "MONEY"
                      ? event.target.value === ""
                        ? undefined
                        : Number(event.target.value)
                      : event.target.value,
                  );
                }}
              />
            </label>
          );
        })}
      </div>
    </details>
  );
}

function OptionSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ApproverOption[];
  value?: string | undefined;
  onChange: (id: string) => void;
}) {
  return (
    <label className="field-label">
      {label}
      <select
        className="field-input"
        value={value ?? ""}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      >
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.fullName ?? o.name}
            {o.email ? ` — ${o.email}` : ""}
            {o.roles?.length
              ? ` — ${o.roles.map((role) => role.name).join(", ")}`
              : ""}
            {o.departments?.length
              ? ` — ${o.departments.map((department) => department.name).join(", ")}`
              : ""}
            {o.status ? ` (${o.status})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function SortableStage({
  item,
  index,
  draft,
  options,
  issues,
  update,
  move,
  remove,
  duplicate,
}: {
  item: Stage;
  index: number;
  draft: WorkflowDraft;
  options: {
    memberships: ApproverOption[];
    roles: ApproverOption[];
    departments: ApproverOption[];
    calendars: ApproverOption[];
  };
  issues: ValidationIssue[];
  update: (stage: Stage) => void;
  move: (from: number, to: number) => void;
  remove: () => void;
  duplicate: () => void;
}) {
  const sortable = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  const setApprovers = (values: Assignment[]) => {
    update({
      ...item,
      approvers: values.map((a, i) => ({ ...a, displayOrder: i + 1 })),
    });
  };
  const addApprover = (type: Assignment["assignmentType"]) => {
    const value = assignment(type, draft);
    if (value) setApprovers([...item.approvers, value]);
  };
  return (
    <li
      ref={sortable.setNodeRef}
      style={style}
      className="panel"
      aria-label={`Approval level ${String(item.position)}`}
    >
      <div className="flex gap-3">
        <button
          className="drag-handle"
          aria-label={`Drag ${item.name}`}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <GripVertical />
        </button>
        <div className="min-w-0 flex-1">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="field-label">
              Level {item.position} name
              <input
                className="field-input text-lg font-semibold"
                value={item.name}
                onChange={(e) => {
                  update({ ...item, name: e.target.value });
                }}
              />
            </label>
            <label className="field-label">
              Completion policy
              <select
                className="field-input"
                value={item.completionPolicy}
                onChange={(e) => {
                  update({
                    ...item,
                    completionPolicy: e.target.value as "ANY" | "ALL",
                  });
                }}
              >
                <option value="ANY">Any approver</option>
                <option value="ALL">All approvers</option>
              </select>
            </label>
            <label className="field-label">
              Description
              <input
                className="field-input"
                value={item.description ?? ""}
                onChange={(e) => {
                  update({ ...item, description: e.target.value || null });
                }}
              />
            </label>
            <label className="field-label">
              Approver instructions
              <input
                className="field-input"
                value={item.instructions ?? ""}
                onChange={(e) => {
                  update({ ...item, instructions: e.target.value || null });
                }}
              />
            </label>
          </div>
          <fieldset className="mt-4 rounded-lg border p-3">
            <legend className="px-1 font-semibold">Approvers</legend>
            {item.approvers.map((a) => (
              <div
                key={a.id}
                className="mb-2 grid items-end gap-2 md:grid-cols-[180px_1fr_auto]"
              >
                <label className="field-label">
                  Assignment
                  <select
                    className="field-input"
                    value={a.assignmentType}
                    onChange={(e) => {
                      const next = assignment(
                        e.target.value as Assignment["assignmentType"],
                        draft,
                      );
                      if (next)
                        setApprovers(
                          item.approvers.map((old) =>
                            old.id === a.id ? { ...next, id: old.id } : old,
                          ),
                        );
                    }}
                  >
                    <option value="REQUESTER_MANAGER">Requester manager</option>
                    <option value="MEMBERSHIP">Specific member</option>
                    <option value="ROLE">Role</option>
                    <option value="DEPARTMENT_ROLE">Department + role</option>
                    <option value="FORM_FIELD_USER">Member form field</option>
                  </select>
                </label>
                {a.assignmentType === "REQUESTER_MANAGER" && (
                  <p className="pb-2 text-sm text-slate-600">
                    Resolved from the requester’s active reporting manager.
                  </p>
                )}
                {a.assignmentType === "MEMBERSHIP" && (
                  <OptionSelect
                    label="Member"
                    options={options.memberships}
                    value={a.membershipId}
                    onChange={(membershipId) => {
                      setApprovers(
                        item.approvers.map((old) =>
                          old.id === a.id
                            ? {
                                id: a.id,
                                assignmentType: "MEMBERSHIP",
                                membershipId,
                                displayOrder: a.displayOrder,
                              }
                            : old,
                        ),
                      );
                    }}
                  />
                )}
                {a.assignmentType === "ROLE" && (
                  <OptionSelect
                    label="Role (all active members)"
                    options={options.roles}
                    value={a.roleId}
                    onChange={(roleId) => {
                      setApprovers(
                        item.approvers.map((old) =>
                          old.id === a.id ? { ...a, roleId } : old,
                        ),
                      );
                    }}
                  />
                )}
                {a.assignmentType === "DEPARTMENT_ROLE" && (
                  <div className="grid grid-cols-2 gap-2">
                    <OptionSelect
                      label="Department"
                      options={options.departments}
                      value={a.departmentId}
                      onChange={(departmentId) => {
                        setApprovers(
                          item.approvers.map((old) =>
                            old.id === a.id ? { ...a, departmentId } : old,
                          ),
                        );
                      }}
                    />
                    <OptionSelect
                      label="Role"
                      options={options.roles}
                      value={a.roleId}
                      onChange={(roleId) => {
                        setApprovers(
                          item.approvers.map((old) =>
                            old.id === a.id ? { ...a, roleId } : old,
                          ),
                        );
                      }}
                    />
                  </div>
                )}
                {a.assignmentType === "FORM_FIELD_USER" && (
                  <label className="field-label">
                    Member-selector field
                    <select
                      className="field-input"
                      value={a.formFieldId}
                      onChange={(e) => {
                        setApprovers(
                          item.approvers.map((old) =>
                            old.id === a.id
                              ? { ...a, formFieldId: e.target.value }
                              : old,
                          ),
                        );
                      }}
                    >
                      {draft.formSections
                        .flatMap((s) => s.fields)
                        .filter((f) => f.type === "MEMBER_SELECTOR")
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <button
                  className="icon-button danger"
                  aria-label="Remove approver"
                  disabled={item.approvers.length === 1}
                  onClick={() => {
                    setApprovers(
                      item.approvers.filter((old) => old.id !== a.id),
                    );
                  }}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {(
                [
                  "REQUESTER_MANAGER",
                  "MEMBERSHIP",
                  "ROLE",
                  "DEPARTMENT_ROLE",
                  "FORM_FIELD_USER",
                ] as const
              ).map((type) => (
                <button
                  key={type}
                  className="chip"
                  onClick={() => {
                    addApprover(type);
                  }}
                >
                  + {type.replaceAll("_", " ")}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="mt-4 rounded-lg border p-3">
            <legend className="px-1 font-semibold">Stage condition</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(item.activationCondition)}
                onChange={(e) => {
                  const first = draft.formSections.flatMap((s) => s.fields)[0];
                  update({
                    ...item,
                    activationCondition:
                      e.target.checked && first
                        ? { kind: "isEmpty", fieldId: first.id, empty: false }
                        : null,
                  });
                }}
              />
              Only include this stage when a form answer matches
            </label>
            {item.activationCondition &&
              "fieldId" in item.activationCondition && (
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <label className="field-label">
                    Field
                    <select
                      className="field-input"
                      value={item.activationCondition.fieldId}
                      onChange={(e) => {
                        const condition = item.activationCondition;
                        if (condition && "fieldId" in condition)
                          update({
                            ...item,
                            activationCondition: {
                              ...condition,
                              fieldId: e.target.value,
                            },
                          });
                      }}
                    >
                      {draft.formSections
                        .flatMap((s) => s.fields)
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="field-label">
                    Rule
                    <select
                      className="field-input"
                      value={
                        item.activationCondition.kind === "isEmpty"
                          ? item.activationCondition.empty
                            ? "empty"
                            : "not-empty"
                          : "equals"
                      }
                      onChange={(e) => {
                        const active = item.activationCondition;
                        if (!active || !("fieldId" in active)) return;
                        const fieldId = active.fieldId;
                        update({
                          ...item,
                          activationCondition:
                            e.target.value === "equals"
                              ? {
                                  kind: "comparison",
                                  fieldId,
                                  operator: "eq",
                                  value: true,
                                }
                              : {
                                  kind: "isEmpty",
                                  fieldId,
                                  empty: e.target.value === "empty",
                                },
                        });
                      }}
                    >
                      <option value="not-empty">Is not empty</option>
                      <option value="empty">Is empty</option>
                      <option value="equals">Equals true</option>
                    </select>
                  </label>
                </div>
              )}
          </fieldset>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <OptionSelect
              label="Business calendar (optional override)"
              options={options.calendars}
              value={item.businessCalendarId ?? undefined}
              onChange={(businessCalendarId) => {
                update({
                  ...item,
                  businessCalendarId: businessCalendarId || null,
                });
              }}
            />
            <label className="field-label">
              Due value
              <input
                className="field-input"
                type="number"
                min="1"
                value={item.dueDuration?.value ?? ""}
                onChange={(e) => {
                  update({
                    ...item,
                    dueDuration: e.target.value
                      ? {
                          value: Number(e.target.value),
                          unit: item.dueDuration?.unit ?? "BUSINESS_HOURS",
                        }
                      : null,
                  });
                }}
              />
            </label>
            <label className="field-label">
              Business-time unit
              <select
                className="field-input"
                value={item.dueDuration?.unit ?? "BUSINESS_HOURS"}
                disabled={!item.dueDuration}
                onChange={(e) => {
                  if (item.dueDuration)
                    update({
                      ...item,
                      dueDuration: {
                        ...item.dueDuration,
                        unit: e.target.value as
                          "BUSINESS_HOURS" | "BUSINESS_DAYS",
                      },
                    });
                }}
              >
                <option value="BUSINESS_HOURS">Hours</option>
                <option value="BUSINESS_DAYS">Days</option>
              </select>
            </label>
            <div className="pt-6 text-sm text-slate-600">
              {item.reminders.length} reminders · {item.escalations.length}{" "}
              escalations
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="chip"
              disabled={!item.dueDuration}
              onClick={() => {
                update({
                  ...item,
                  reminders: [
                    ...item.reminders,
                    {
                      id: uid(),
                      sequence: item.reminders.length + 1,
                      offset: { value: 1, unit: "BUSINESS_HOURS" },
                      offsetAnchor: "ACTIVATION",
                      recipientPolicy: { type: "STAGE_APPROVERS" },
                    },
                  ],
                });
              }}
            >
              + Reminder
            </button>
            <button
              className="chip"
              disabled={!item.dueDuration}
              onClick={() => {
                update({
                  ...item,
                  escalations: [
                    ...item.escalations,
                    {
                      id: uid(),
                      sequence: item.escalations.length + 1,
                      offset: { value: 1, unit: "BUSINESS_HOURS" },
                      offsetAnchor: "DUE_TIME",
                      action: "RETURN_TO_INITIATOR",
                    },
                  ],
                });
              }}
            >
              + Escalation return
            </button>
            {(item.reminders.length > 0 || item.escalations.length > 0) && (
              <button
                className="chip"
                onClick={() => {
                  update({ ...item, reminders: [], escalations: [] });
                }}
              >
                Clear timing rules
              </button>
            )}
          </div>
          {issues
            .filter(
              (issue) =>
                issue.entityId === item.id ||
                item.approvers.some((a) => a.id === issue.entityId),
            )
            .map((issue) => (
              <p className="issue" key={`${issue.code}-${issue.entityId}`}>
                {issue.message}
              </p>
            ))}
        </div>
        <div className="flex flex-col gap-1">
          <button
            className="icon-button"
            aria-label={`Move ${item.name} up`}
            disabled={index === 0}
            onClick={() => {
              move(index, index - 1);
            }}
          >
            <ArrowUp />
          </button>
          <button
            className="icon-button"
            aria-label={`Move ${item.name} down`}
            disabled={index === draft.stages.length - 1}
            onClick={() => {
              move(index, index + 1);
            }}
          >
            <ArrowDown />
          </button>
          <button
            className="icon-button"
            aria-label={`Duplicate ${item.name}`}
            onClick={duplicate}
          >
            <Copy />
          </button>
          <button
            className="icon-button danger"
            aria-label={`Delete ${item.name}`}
            onClick={remove}
          >
            <Trash2 />
          </button>
        </div>
      </div>
    </li>
  );
}

export function WorkflowEditorPage() {
  const { organizationId = "", workflowId = "", versionId = "" } = useParams();
  const query = useWorkflow(organizationId, workflowId, versionId);
  const save = useSaveWorkflow(organizationId, workflowId, versionId);
  const memberships = useQuery({
    queryKey: ["approver-members", organizationId],
    queryFn: () => workflowApi.memberships(organizationId),
  });
  const roles = useQuery({
    queryKey: ["approver-roles", organizationId],
    queryFn: () => workflowApi.roles(organizationId),
  });
  const departments = useQuery({
    queryKey: ["approver-departments", organizationId],
    queryFn: () => workflowApi.departments(organizationId),
  });
  const calendars = useQuery({
    queryKey: ["calendars", organizationId],
    queryFn: () => workflowApi.calendars(organizationId),
  });
  const [draft, setDraft] = useState<WorkflowDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<
    { id: string; name: string; result: string }[]
  >([]);
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, unknown>>(
    {},
  );
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  useEffect(() => {
    if (query.data && !dirty)
      setDraft({
        ...query.data,
        formSections: query.data.formSections,
        fieldConditions: query.data.fieldConditions,
        stages: query.data.stages.map((s) => ({
          ...s,
          reminders: s.reminders,
          escalations: s.escalations,
        })),
      });
  }, [query.data, dirty]);
  useEffect(() => {
    const warning = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warning);
    return () => {
      window.removeEventListener("beforeunload", warning);
    };
  }, [dirty]);
  const options = useMemo(
    () => ({
      memberships: memberships.data ?? [],
      roles: roles.data ?? [],
      departments: departments.data ?? [],
      calendars: calendars.data ?? [],
    }),
    [memberships.data, roles.data, departments.data, calendars.data],
  );
  if (query.isLoading)
    return (
      <main className="page" aria-busy="true">
        <div className="skeleton h-10 w-80" />
        <div className="skeleton mt-5 h-64" />
      </main>
    );
  if (!draft)
    return (
      <main className="page">
        <h1 className="text-2xl font-bold">Workflow unavailable</h1>
        <p className="mt-2 text-slate-600">
          You may not have access, or the draft no longer exists.
        </p>
        <button
          className="button-primary mt-4"
          onClick={() => void query.refetch()}
        >
          Try again
        </button>
      </main>
    );
  const change = (next: WorkflowDraft) => {
    setDraft(next);
    setDirty(true);
    setIssues([]);
  };
  const updateStages = (stages: Stage[]) => {
    change({ ...draft, stages: ordered(stages) });
  };
  const move = (from: number, to: number) => {
    if (to >= 0 && to < draft.stages.length)
      updateStages(arrayMove(draft.stages, from, to));
  };
  const dragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id)
      move(
        draft.stages.findIndex((s) => s.id === active.id),
        draft.stages.findIndex((s) => s.id === over.id),
      );
  };
  const showError = (error: unknown) => {
    const text = error instanceof Error ? error.message : "Request failed";
    try {
      const parsed = JSON.parse(text) as {
        error?: { details?: { issues?: ValidationIssue[] }; message?: string };
      };
      setIssues(parsed.error?.details?.issues ?? []);
      setNotice(parsed.error?.message ?? "Request failed.");
    } catch {
      setNotice("Request failed. Please retry.");
    }
  };
  return (
    <main className="page">
      <header className="mb-8 flex flex-wrap justify-between gap-4">
        <div>
          <p className="eyebrow">Workflow editor</p>
          <h1 className="text-3xl font-bold">Design approval workflow</h1>
          <p className="text-slate-600">
            {dirty
              ? "Unsaved changes"
              : `Draft revision ${String(draft.revision)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="button-secondary"
            onClick={() =>
              void workflowApi
                .preview(organizationId, workflowId, versionId, previewAnswers)
                .then((value) => {
                  setPreview(value.stages);
                  setNotice(
                    value.finalStageId
                      ? "Preview path ready."
                      : "No approval stage applies.",
                  );
                })
                .catch(showError)
            }
          >
            Preview
          </button>
          <button
            className="button-secondary"
            onClick={() =>
              void workflowApi
                .validate(organizationId, workflowId, versionId)
                .then((value) => {
                  setIssues(value.issues);
                  setNotice(
                    value.valid
                      ? "Workflow is valid."
                      : "Resolve validation issues.",
                  );
                })
                .catch(showError)
            }
          >
            Validate
          </button>
          <button
            className="button-primary"
            disabled={!dirty || save.isPending}
            onClick={() =>
              void save
                .mutateAsync(draft)
                .then((value) => {
                  setDraft({ ...draft, revision: value.revision });
                  setDirty(false);
                  setNotice("Draft saved.");
                })
                .catch(showError)
            }
          >
            Save draft
          </button>
          <button
            className="button-success"
            disabled={dirty}
            title={dirty ? "Save the draft before publishing" : undefined}
            onClick={() =>
              void workflowApi
                .publish(organizationId, workflowId, versionId, draft.revision)
                .then(() => {
                  setNotice("Workflow published and is now immutable.");
                })
                .catch(showError)
            }
          >
            Publish
          </button>
        </div>
      </header>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {issues
        .filter((i) => i.entityType === "WORKFLOW")
        .map((i) => (
          <p className="issue" key={i.code}>
            {i.message}
          </p>
        ))}
      <RepresentativeAnswers
        draft={draft}
        memberships={options.memberships}
        answers={previewAnswers}
        change={(fieldId, value) => {
          setPreviewAnswers((current) => {
            if (value === undefined || value === "")
              return Object.fromEntries(
                Object.entries(current).filter(([id]) => id !== fieldId),
              );
            return { ...current, [fieldId]: value };
          });
          setPreview([]);
        }}
      />
      <FormBuilder draft={draft} change={change} issues={issues} />
      <section className="mt-10" aria-labelledby="stages-title">
        <div className="mb-4">
          <h2 id="stages-title" className="text-2xl font-bold">
            Approval Stages
          </h2>
          <p className="text-sm text-slate-600">
            Stages run sequentially. Drag the handle or use the
            keyboard-accessible arrow controls to reorder.
          </p>
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={dragEnd}
        >
          <SortableContext
            items={draft.stages.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol className="space-y-4">
              {draft.stages.map((item, index) => (
                <SortableStage
                  key={item.id}
                  item={item}
                  index={index}
                  draft={draft}
                  options={options}
                  issues={issues}
                  move={move}
                  update={(next) => {
                    updateStages(
                      draft.stages.map((s) => (s.id === item.id ? next : s)),
                    );
                  }}
                  remove={() => {
                    if (confirm(`Delete ${item.name}?`))
                      updateStages(
                        draft.stages.filter((s) => s.id !== item.id),
                      );
                  }}
                  duplicate={() => {
                    updateStages([
                      ...draft.stages.slice(0, index + 1),
                      {
                        ...item,
                        id: uid(),
                        name: `${item.name} copy`,
                        approvers: item.approvers.map((a) => ({
                          ...a,
                          id: uid(),
                        })),
                        reminders: item.reminders.map((r) => ({
                          ...r,
                          id: uid(),
                        })),
                        escalations: item.escalations.map((e) => ({
                          ...e,
                          id: uid(),
                        })),
                      },
                      ...draft.stages.slice(index + 1),
                    ]);
                  }}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
        <button
          className="button-dashed mt-5"
          onClick={() => {
            updateStages([...draft.stages, makeStage(draft.stages.length + 1)]);
          }}
        >
          <Plus /> Add Approval Level
        </button>
      </section>
      {preview.length > 0 && (
        <aside className="panel mt-8">
          <h2 className="text-xl font-bold">Representative path preview</h2>
          <ol className="mt-3 space-y-2">
            {preview.map((s, i) => (
              <li
                key={s.id}
                className="flex justify-between rounded bg-slate-50 p-3"
              >
                <span>
                  {String(i + 1)}. {s.name}
                </span>
                <strong>
                  {s.result}
                  {i === preview.length - 1 && s.result === "MATCHED"
                    ? " · Final"
                    : ""}
                </strong>
              </li>
            ))}
          </ol>
        </aside>
      )}
    </main>
  );
}
