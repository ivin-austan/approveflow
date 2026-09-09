# Web application instructions

Follow the repository-root `AGENTS.md` in addition to these rules.

## Stack

- Use React 19, TypeScript and Vite.
- Use React Router for routing.
- Use Tailwind CSS and shadcn/ui.
- Use TanStack Query for server state.
- Use TanStack Table for data tables.
- Use React Hook Form with Zod for forms.
- Use dnd-kit for workflow and form-builder interactions.
- Use Zustand only for genuinely shared client-side state.
- Use Recharts for analytics.
- Use Lucide React icons.

Do not introduce another UI framework, form library, state-management
library or data-fetching library without approval.

## Architecture

Organize source code by business feature.

Preferred structure:

src/
├── app/
├── routes/
├── features/
├── components/
├── hooks/
├── lib/
├── api/
└── types/

Each product feature may contain:

- components
- pages
- hooks
- API functions
- schemas
- types
- tests

Keep route components thin. Move reusable behavior into feature modules.

Do not create one large global components or utilities folder containing
unrelated domain behavior.

## API access

- Do not call `fetch` or Axios directly inside presentation components.
- Keep HTTP calls in the API-client layer.
- Use typed request and response contracts.
- Use TanStack Query hooks for server state.
- Use query-key factories.
- Invalidate only relevant queries after mutations.
- Handle authentication expiration centrally.
- Do not duplicate backend business rules in the browser.
- Treat backend authorization responses as authoritative.

## Forms

- Use React Hook Form for form state.
- Use Zod for client-side validation.
- Render server validation errors near the relevant fields.
- Disable repeated submission while a mutation is pending.
- Warn before leaving forms with unsaved changes where appropriate.
- Use accessible labels, descriptions and error messages.
- Dynamic request forms must render from published workflow configuration.
- Never execute user-provided JavaScript for conditional form logic.

## Components

- Keep components focused and reasonably sized.
- Prefer composition over components with many boolean props.
- Use semantic HTML.
- Avoid unnecessary `useEffect`.
- Do not store derived values in state.
- Do not use array indexes as keys for reorderable builder elements.
- Memoize only when there is a demonstrated reason.
- Avoid unsafe type assertions.
- Do not use `any`.

## UI and accessibility

- Build a professional responsive B2B SaaS interface.
- Support desktop, tablet and mobile layouts.
- All interactive controls must be keyboard accessible.
- Provide visible focus styles.
- Use dialogs for confirmation of important actions.
- Use consistent status names and colors.
- Include loading, error, empty and permission-denied states.
- Use skeleton loaders where layout is predictable.
- Do not rely on color alone to communicate status.
- Ensure drag-and-drop builders have a usable keyboard alternative.
- Avoid excessive gradients, animations and decorative dashboard cards.

## Workflow builder

- Separate form-builder state from persisted workflow data.
- Use stable IDs for sections, fields and stages.
- Support adding, editing, reordering and deleting items.
- Clearly identify unsaved draft changes.
- Validate the workflow before allowing publication.
- Show validation errors at the relevant field or stage.
- Do not mutate published workflow versions.
- Use a preview mode driven by the same configuration used at runtime.

## Testing

Use Vitest and React Testing Library.

Test:

- User-visible behavior
- Permission-aware rendering
- Dynamic form rendering
- Form validation
- Condition-builder behavior
- Workflow-stage ordering
- Approval-action availability
- Loading and error states

Use Playwright for critical journeys such as:

- Organization onboarding
- Workflow publication
- Request submission
- Approval
- Return and resubmission

Avoid low-value snapshot tests.

## Verification

After web changes, run the applicable commands for:

- Formatting
- Linting
- Type checking
- Unit tests
- Production web build

Report any command that could not be run.
