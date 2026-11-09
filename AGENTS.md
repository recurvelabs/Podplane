# Podplane

Read `README.md` and `CODEX_HANDOFF.md` before changing the application.

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
