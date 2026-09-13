import { expect, test } from "@playwright/test";

test("sign-in returns only to an allowlisted application route", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/login", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: { accessToken: "test-access-token" } }),
    });
  });
  await page.goto(
    "/sign-in?returnTo=https%3A%2F%2Fevil.example%2Fcollect-credentials",
  );
  await page.getByLabel("Email").fill("reviewer@example.com");
  await page.getByLabel("Password").fill("correct-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:4173/");
  await expect(
    page.getByRole("heading", {
      name: "Approval workflows, clearly managed.",
    }),
  ).toBeVisible();
});

test("sign-in form is keyboard operable on mobile", async ({ page }) => {
  await page.goto("/sign-in");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email")).toBeFocused();
  await page.keyboard.type("reviewer@example.com");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
});
