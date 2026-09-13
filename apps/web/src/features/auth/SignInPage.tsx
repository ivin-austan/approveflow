import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { authenticatedFetch, safeReturnPath, setAccessToken } from "./session";

interface OrganizationsEnvelope {
  data: {
    organizations: readonly { id: string }[];
  };
}

export function SignInPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  return (
    <main className="page flex min-h-screen items-center justify-center">
      <form
        className="panel w-full max-w-md space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(false);
          setSubmitting(true);
          const data = new FormData(event.currentTarget);
          void fetch("/api/v1/auth/login", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: data.get("email"),
              password: data.get("password"),
            }),
          })
            .then(async (response) => {
              if (!response.ok) throw new Error("Authentication failed");
              const body: unknown = await response.json();
              if (
                typeof body !== "object" ||
                body === null ||
                !("data" in body) ||
                typeof body.data !== "object" ||
                body.data === null ||
                !("accessToken" in body.data) ||
                typeof body.data.accessToken !== "string"
              )
                throw new Error("Authentication response is invalid");
              setAccessToken(body.data.accessToken);
              let destination = safeReturnPath(params.get("returnTo"));
              if (destination === "/") {
                const organizationsResponse = await authenticatedFetch(
                  "/api/v1/organizations",
                );
                if (organizationsResponse.ok) {
                  const organizations =
                    (await organizationsResponse.json()) as OrganizationsEnvelope;
                  const organization = organizations.data.organizations[0];
                  if (organization)
                    destination = `/organizations/${organization.id}/workflows`;
                }
              }
              void navigate(destination, {
                replace: true,
              });
            })
            .catch(() => {
              setError(true);
            })
            .finally(() => {
              setSubmitting(false);
            });
        }}
      >
        <div>
          <p className="eyebrow">ApproveFlow</p>
          <h1 className="text-3xl font-bold">Sign in</h1>
        </div>
        <label className="field-label">
          Email
          <input
            autoComplete="email"
            className="field-input"
            name="email"
            required
            type="email"
          />
        </label>
        <label className="field-label">
          Password
          <input
            autoComplete="current-password"
            className="field-input"
            minLength={8}
            name="password"
            required
            type="password"
          />
        </label>
        {error && (
          <div className="issue" role="alert">
            Invalid email or password.
          </div>
        )}
        <button className="button-primary w-full" disabled={submitting}>
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
