# Uatu frontend

Uatu helps OSPOs and technology leaders understand their workforce's public
open-source contributions. One deployment represents one organization; the
people tracked by the [Uatu backend](https://github.com/project-uatu/backend)
form its employee roster.

The dashboard provides organization SSO, searchable and paginated
employees, individual contribution charts, recorded activity, contributed
projects, and collection coverage. Configured admins can onboard tracked
employees; other collection administration remains a backend operator task.

Profile projects and activity default to all recorded history and have independent
custom date filters. Activity initially includes all event types. Contribution
history defaults to the past year, with year-to-date and custom date-range options.
Custom ranges are inclusive UTC dates, limited to 366 days. Changing one section
does not reset another section's filters or pagination. The backend requires
activity timestamps, so the BFF translates omitted activity dates to its full
RFC3339 date domain while preserving cursor pagination.

The organization-wide **Projects** page lists projects across all tracked employees'
recorded history, with contributor profile links and project/contributor search.
It loads every employee and per-person project page using the existing read API,
with at most four employees loading concurrently. Large rosters can take longer;
failed loads show an error rather than a partial organization total. Event counts
sum per-person records and may overlap between employees; they are not unique
organization events or commit totals. Collection gaps still apply.

Employee directory rows show source coverage and all-recorded-history project
counts. Details load separately from the roster, for at most four employees at a
time, following every project page. Failed details remain explicitly unavailable,
not zero. Profile history groups period/metric controls above the daily heatmap;
the smaller daily trend and expandable data notes provide supporting detail.

## Architecture

React and Vite provide the browser application. An Express backend-for-frontend
(BFF) serves the built application and a deliberately limited `/api` surface
from the same origin. During development, that same server uses Vite middleware.
`yarn preview` only previews static assets; it is not the application server.

The BFF handles OIDC Authorization Code + PKCE and validates ID tokens through
`openid-client`. Only subjects explicitly authorized by `OIDC_ALLOWED_SUBJECTS`
can access the organization. PostgreSQL stores server-side sessions; browsers
receive only a signed, HttpOnly, SameSite=Lax session cookie. Sessions expire
after one hour, and logout destroys the stored session. Logout is local to Uatu,
not a global logout from the identity provider.

The backend operator key and OIDC client secret never enter the browser bundle.
The BFF injects the operator key only for allowlisted requests. Read routes are
available to approved users. The sole write route, `POST /api/persons`, requires
an admin subject, an exact same-origin request, a session CSRF token, and a
validated, size-limited body. Arbitrary upstream URLs and client-supplied
authorization headers are never forwarded. Session/API responses are not cacheable.

## Adding tracked employees

Set `OIDC_ADMIN_SUBJECTS` to comma-separated exact OIDC `sub` identifiers.
Every admin must also be in `OIDC_ALLOWED_SUBJECTS`. Leaving the admin list empty
disables onboarding for everyone; no user becomes an admin automatically.
Restart the BFF after changing these settings, then refresh the page.

Admins see **Add employee** in the employee directory. Enter a display name,
configured forge hostname (defaults to `github.com`), and account login.
The BFF calls the existing backend `POST /v1/persons` endpoint, which creates
the tracked person and queues initial collection. A collector worker must be
running; contributions do not appear immediately. The confirmation links to
the new profile. Duplicate identities and unsupported forges are reported.
If a request times out, check the directory before retrying: the backend may
already have created the person. Writes are never automatically retried.

This adds a **tracked contributor**, not an SSO account or dashboard authorization.
It does not link the contributor to the currently signed-in account.

## Local setup

Use **Node 24 LTS, at least 24.15.0**, and **Yarn Classic 1.22.22**. `.nvmrc`
selects Node 24. Engine checks are enabled; do not bypass them.

```sh
nvm use
yarn install --frozen-lockfile
cp .env.example .env
```

Run the backend separately, for example on port 8080. Its operator key must
match the BFF's `UATU_API_KEY`. Collection requires separate backend setup; the
frontend does not generate a roster or collect contributions itself.

Frontend sessions need their own PostgreSQL database and role. They can share a
PostgreSQL server with the backend, but not its database or credentials. For
local use, a standalone container is simplest:

```sh
docker run --detach --name uatu-frontend-sessions \
  --publish 127.0.0.1:5433:5432 \
  --env POSTGRES_USER=uatu --env POSTGRES_PASSWORD=local-only \
  --env POSTGRES_DB=uatu_sessions postgres:17
docker exec uatu-frontend-sessions pg_isready -U uatu -d uatu_sessions
docker exec -i uatu-frontend-sessions psql -U uatu -d uatu_sessions < server/session.sql
```

Wait for `pg_isready` to succeed before applying the schema. Provision
`server/session.sql` once before starting a new deployment. Serving checks the
table but does not create or migrate it.

Never point the frontend at the backend's database. The frontend reaches
contribution data only through the backend API, which enforces read access and
admin-only onboarding; direct database access would bypass that boundary.
Keeping the databases separate also means the backend's migrations own only its
schema, short-lived sessions get their own backup and retention policy, and
session load cannot affect collection.

On a shared server, create a dedicated database and a role that can only use it:

```sql
CREATE ROLE uatu_frontend LOGIN PASSWORD '<generated>';
CREATE DATABASE uatu_sessions OWNER uatu_frontend;
REVOKE CONNECT ON DATABASE uatu_sessions FROM PUBLIC;
-- Also ensure uatu_frontend has no CONNECT on the backend database.
```

Then apply `server/session.sql` to `uatu_sessions` as `uatu_frontend`.

Register a confidential OIDC web application with your provider:

- Enable Authorization Code, PKCE S256, and `openid profile` scopes.
- Register the exact redirect URI `http://127.0.0.1:3000/auth/callback` for local
  development, and `https://<your-host>/auth/callback` for production.
- Set `OIDC_ISSUER` to the provider's issuer URL (including its realm path, if
  applicable), and configure `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`. The
  client uses `client_secret_post` token-endpoint authentication.
- Set `OIDC_ALLOWED_SUBJECTS` to comma-separated exact `sub` identifiers from
  this issuer. Successful authentication alone does not grant access. Do not
  substitute display names or email domains for subject identifiers.

Fill in `.env`; all required settings are listed in `.env.example`.
Generate `SESSION_SECRET` with `openssl rand -hex 32`. Use the backend's
configured operator key for `UATU_API_KEY`. Never prefix secrets with `VITE_`.
Loopback HTTP is allowed for the app and identity provider only in development.

```sh
yarn dev
```

Open `http://127.0.0.1:3000`. Missing configuration, an unavailable session
database, or OIDC discovery failures prevent startup rather than enabling an
unauthenticated fallback.

## Commands

| Command | Purpose |
| --- | --- |
| `yarn dev` | Same-origin BFF and Vite development server |
| `yarn dev:idp` | Standalone local test SSO for integration on port 3000 |
| `yarn dev:integration` | BFF + Vite using ignored `.env.integration` and a real backend |
| `yarn build` | Type-check browser, server, and tests; build browser assets |
| `yarn start` | Production BFF serving `dist/`; requires HTTPS configuration |
| `yarn lint` | Oxlint |
| `yarn test` | Client and server Vitest suites |
| `yarn vitest run src/history.test.ts -t "latest observation"` | Single named test |
| `yarn playwright install chromium` | Install the browser for end-to-end tests |
| `yarn build && yarn test:e2e` | Browser tests against the production UI bundle |

The browser suite starts isolated fixture services on loopback ports 4300-4302:
a signed-token OIDC provider, a backend contract fixture, and the real BFF.
Only the test fixture uses an in-memory session store. It exercises PKCE,
OIDC state validation, unauthorized identities, directory navigation, chart
rendering, coverage, activity pagination, expiry, backend failure, and logout.
It does not require real provider credentials or contribution data.

PostgreSQL persistence tests run when `UATU_TEST_SESSION_DATABASE_URL` points to
a dedicated test database; otherwise that test is skipped. They create and drop
a uniquely named session table. Never use a production database:

```sh
UATU_TEST_SESSION_DATABASE_URL='postgres://uatu:local-only@127.0.0.1:5433/uatu_frontend_test?sslmode=disable' yarn test
```

Create the isolated test database first. CI supplies its own PostgreSQL service
and runs lint, build, both Vitest suites, the persistence test, and Chromium
browser tests.

## Local integration with real contributions

Use the same BFF as development, but keep a local test identity provider rather
than configuring external SSO. This mode has no synthetic contribution backend
and uses PostgreSQL sessions. It is loopback-only and must not be deployed.

Configure `.env.integration` using `.env.example` as a starting point:

| Setting | Local integration value |
| --- | --- |
| `APP_URL` | `http://127.0.0.1:3000` |
| `PORT` | `3000` |
| `HOST` | `127.0.0.1` |
| `UATU_BACKEND_URL` | `http://127.0.0.1:4302` |
| `SESSION_DATABASE_URL` | URL of the dedicated session database and role (may share a server with the backend, never its database) |
| `OIDC_ISSUER` | `http://127.0.0.1:4301` |
| `OIDC_CLIENT_ID` | `fixture-client` |
| `OIDC_CLIENT_SECRET` | `fixture-client-secret` (test provider only) |
| `OIDC_ALLOWED_SUBJECTS` | `ospo-reader` |

Generate `UATU_API_KEY` and `SESSION_SECRET` separately with
`openssl rand -hex 32`, and restrict the file to its owner (`chmod 600`).
Configure the backend with the same operator key, run its migrations, and
publish its API only on `127.0.0.1:4302`. Provision the session schema as
described above. Neither the frontend nor the test IdP needs a GitHub token.

In separate terminals:

```sh
yarn dev:idp
yarn dev:integration
```

Open `http://127.0.0.1:3000` and select the OSPO member at the local identity
provider. Stop the all-fixture preview first: it also uses ports 4301 and 4302.

Follow the backend's collection instructions to populate public accounts.
Supply a dedicated token to the collector's environment, never the frontend
configuration. For an explicitly approved local test using existing GitHub CLI
credentials, pass it without printing it or writing it to a file:

```sh
GITHUB_TOKEN="$(gh auth token)"
export GITHUB_TOKEN
docker run --rm --network uatu-frontend-integration \
  --env UATU_DATABASE_URL='postgres://uatu:local-only@uatu-frontend-integration-db:5432/uatu?sslmode=disable' \
  --env UATU_FORGES=github.com --env GITHUB_TOKEN \
  uatu:frontend-local-v0.2.0 collect <github-login>
unset GITHUB_TOKEN
```

The network, database container, and image names above are those used by the
local integration environment; adjust them for your setup. The image can be
built from the backend's `v0.2.0` release when its GHCR package is inaccessible.
Container environment variables are visible to Docker administrators; remove
collector containers after use. Collection can take time or hit source limits.
Keep gaps visible and do not interpret incomplete data as no activity.

The initial backfill scans account history, not just the selected chart dates.
Recorded activity may appear before daily count observations and final coverage.
Use **All recorded activity** to inspect issues and pull requests while commit
scans are still pending. CLI-onboarded accounts may have no display name; the UI
falls back to their ID. Onboard through the backend's create-person API with a
`display_name` when human-readable roster entries are required.

For the running integration environment, the persistent database container is
`uatu-frontend-integration-db`, the API is `uatu-frontend-integration-api`, and
the resumable collector is `uatu-frontend-integration-worker`. Stop the collector
when finished testing to end GitHub API usage:

```sh
docker stop uatu-frontend-integration-worker
docker stop uatu-frontend-integration-api uatu-frontend-integration-db
```

The worker is removed automatically on stop; restarting collection requires
supplying its token again. The API and database containers can be restarted with
`docker start`. The named volume `uatu-frontend-integration-db` retains data.
Stop the frontend and standalone test SSO separately. Do not delete the volume
unless you intend to discard the collected history.

## Contribution data semantics

Dates in the UI are UTC and inclusive at both date inputs. Requests translate
the final day to the next midnight for the backend's half-open `[from,to)`
interval. Ranges are limited to 366 days.

Charts show source-reported daily observations, not verified commit totals.
For each forge instance, UTC date, metric, and optional kind, only the latest
observation is retained; repeated collection runs are not additive. Forge
instances and kinds remain separate series. The API supplies forge instance IDs, which
are resolved to readable forge names using coverage metadata. Unknown sources
receive numbered labels rather than guessed host names. Unknown days remain
unknown; observed zeroes remain zeroes. An expandable table exposes chart data.

The daily heatmap uses the same deduplicated observations, with one grid per
forge instance and kind. Weeks start on Monday (UTC). Hatched cells are unknown;
white cells are observed zeroes. Intensity scales to each series' maximum in the
selected range, not across people or sources.

Project bars rank up to ten projects by recorded events from the current page.
The projects section defaults to all recorded history, independent of history
chart dates; its own date filter can restrict results to a custom date range.
Pagination makes every recorded project reachable in either scope.
When results span pages, the chart explicitly labels its page-local scope; it
does not claim an overall top-project ranking. The table retains every project
on the page and exposes exact values and full names.

Recorded authored commits are a separate, paginated activity view. They cover
bounded scans of known public repositories, not complete account-wide history.
Project counts represent recorded events, not commits alone. Coverage gaps and
missing data remain visible rather than being presented as inactivity.

Browser response schemas follow the backend
[OpenAPI contract](https://github.com/project-uatu/backend/blob/5eb8dbc908c994ba2cd9d8fb050210d19fcda509/docs/openapi/v1.yaml).
No inline employee totals or live sync indicators are inferred from endpoints
that do not expose them.

## Production deployment

Build with development dependencies installed, then run `yarn start` under
Node 24 with `dist/`, `server/`, `package.json`, and runtime dependencies present.
The server executes erasable TypeScript directly using Node's native support.
Both `yarn dev` and `yarn start` read `.env` if present; deployment-provided
environment variables take precedence.

Use HTTPS for `APP_URL` and `OIDC_ISSUER`; production startup enforces this.
Use verified TLS for remote PostgreSQL and HTTPS or an explicitly trusted
private transport for the backend. Configure `HOST=0.0.0.0` in containers.
Session storage must be durable and shared by replicas, and all replicas must
share the same session secret, issuer, client configuration, and subject
allowlist.

If TLS terminates at a reverse proxy, set `TRUST_PROXY=true` only when exactly
one trusted proxy overwrites forwarded headers and direct BFF access is blocked.
Forward the public host and scheme and support WebSockets in development.
Otherwise leave it false. Secure cookies require the browser to use HTTPS.

`/healthz` is liveness; `/readyz` checks the session table. OIDC discovery and
the session database are required at startup. Backend contribution failures
are surfaced per request, not hidden by the readiness probe. SIGINT/SIGTERM
drain requests and close Vite and database resources with a ten-second deadline.

Do not log authorization headers, cookies, callback query strings, or token
responses at the proxy. The application's request errors use generated request
IDs and redact upstream details. Browser failure traces may contain synthetic
test sessions; CI retains them briefly.

### Container image

Releases publish a multi-architecture (`linux/amd64`, `linux/arm64`) image to
`ghcr.io/project-uatu/frontend`, tagged `X.Y.Z`, `X.Y`, `X`, and `latest`, with
build provenance attestations. The image runs `node server/index.ts` as the
non-root `node` user with `NODE_ENV=production`, `HOST=0.0.0.0`, and
`PORT=3000`, and its health check probes `/healthz`. It contains no `.env`;
supply configuration as environment variables or secrets.

```sh
docker build -t uatu-frontend .
docker run --rm -p 3000:3000 --env-file /path/to/production.env uatu-frontend
```

Provision `server/session.sql` before the first start; the image includes it
under `/app/server/session.sql` but never applies it.

## Releases

[release-please](https://github.com/googleapis/release-please) runs on every
push to `main` and maintains a release pull request from conventional commits.
Merging it updates `package.json`, `CHANGELOG.md`, and the manifest, tags
`vX.Y.Z`, creates the GitHub release, and publishes the container image.
Before 1.0, breaking changes bump the minor version. The workflow authenticates
with a GitHub App configured by the `RELEASE_APP_CLIENT_ID` variable and the
`RELEASE_APP_PRIVATE_KEY` secret.

## License

[Apache License 2.0](LICENSE).
