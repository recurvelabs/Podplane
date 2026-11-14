# Podplane

Read `README.md` and `CODEX_HANDOFF.md` before changing the application.

## Git workflow

- Always work directly on `main`.
- Never create or use other branches or worktrees unless the user explicitly directs you to do so.
- Always integrate each task's changes with the existing work on `main`, preserving unrelated edits.
- Verify the result, deploy affected services to the configured environment, commit the task's changes, and push `main` to `origin` before finishing.
- Every staging or production deployment includes committing and pushing all changes shipped in that deployment, including required configuration and migrations. Do this automatically even when the request only says to deploy.
- After verifying the deployment, commit and push `main`, then confirm `origin/main` contains the commit before reporting completion. Include the commit and deployed version in the handoff. A successful deployment alone does not complete the task.
- This is standing authorization to integrate, deploy, commit and push; do not wait for a separate request. If a step is blocked, report the blocker and what remains unfinished.

## Setup and checks

Use Node.js 24 or later. Run `npm run setup:codex` for a clean setup and verification.

For subsequent changes:

```sh
npm run build:staging
npm test
npm run build
npm run validate
```

The staging build generates the passkey browser module that the tests import. Install dependencies with `npm ci --prefix processor` when the dependency inputs change.

## Application rules

- Catalog imports and browsing update metadata only. Audio processing requires an active user subscription. Preserve shared episode caching.
- Sign-in uses Podplane email codes delivered through the `EMAIL` binding and WebAuthn passkeys. Cloudflare Access is absent from this flow.
- Read account entitlements from D1. Client input and request identity headers must never grant unlimited access.
- Standard accounts have five shows and a shared processing allowance. Unlimited accounts bypass the product quotas and beta episode duration/size caps. Preserve the authentication checks, feed permissions, and MP3 format validation.
- Keep private feed tokens, session tokens, login codes, email credentials, and runtime secrets out of source, logs, and exports.
- Preserve `FEED_SECRET` and `INTERNAL_SECRET` on deployment. Replacing `FEED_SECRET` invalidates existing feed URLs.

## Deployment

The active application is `podplane-staging`, described in `processor/deployment-staging.json`. Its entrypoint is `processor/staging.js`, bundled to `processor/dist/staging.js`.

`processor/deployment.json` describes a separate legacy audio service. `.openai/hosting.json` identifies the legacy Sites redirect. Preserve these identities and their existing resources. Apply additive migrations to an existing database; the base schema is for an empty database.

Keep deployment and development credentials separate. Retrieve current Cloudflare documentation when changing runtime bindings or deployment configuration. Read the handoff's known issues before starting new work.
