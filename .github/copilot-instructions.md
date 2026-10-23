# Copilot instructions

## Stack

TypeScript, React 19, Vite, Apache ECharts (`echarts`, `echarts-for-react`), and an Express backend-for-frontend (BFF). Use **Yarn Classic 1.22.22** and **Node 24 LTS >=24.15.0**; do not bypass dependency engine checks.

## Commands

- Install: `yarn install`
- Dev server (BFF + Vite, requires `.env`, session PostgreSQL, backend, and OIDC): `yarn dev`
- Build (type-check client/server/tests + browser bundle): `yarn build`
- Production server: `yarn start` (requires a build and HTTPS app/issuer URLs)
- Lint (oxlint): `yarn lint`
- Tests: `yarn test` (Vitest client project uses jsdom and Testing Library; server project uses Node)
- Single test: `yarn vitest run src/history.test.ts -t "latest observation"`
- Browser tests: `yarn playwright install chromium`, then `yarn build && yarn test:e2e`
- Container image: `docker build -t uatu-frontend .` (BuildKit; the legacy builder fails on multi-stage copies under Colima)
- Persistence test: `UATU_TEST_SESSION_DATABASE_URL='<dedicated test database URL>' yarn test`; it is skipped without this setting.

## Architecture

- One deployment is one organization; the backend's tracked people are the employee roster. Approved users can read; only configured admins can onboard employees.
- `server/index.ts` serves built assets in production and mounts Vite middleware in development. `/auth` and `/api` share PostgreSQL-backed sessions, not browser-held bearer credentials. `server/session.sql` is provisioned explicitly before startup. Sessions use a dedicated database and role, which may share a server with the backend but never the backend's database.
- Keep Vite's development `configLoader: 'native'`: bundled temporary config imports cause Node's `--watch` to restart continuously when Vite removes them.
- `server/oidc.ts` uses OIDC code flow with PKCE, state, and nonce. Authorization requires an exact subject in `OIDC_ALLOWED_SUBJECTS`; authentication alone is insufficient.
- `server/api.ts` allowlists GET routes and query parameters for the existing backend. Keep operator keys and OIDC secrets server-side; never use `VITE_` variables for secrets. Preserve the same-origin boundary.
- `server/onboarding.ts` is the sole backend write route (`POST /api/persons`): require exact `OIDC_ADMIN_SUBJECTS` membership, Origin and CSRF checks, rate limiting and strict body validation. Admins must also be allowed subjects; default is no admins. Never retry uncertain writes or expose backend error bodies.
- `src/api.ts` validates response contracts with Zod. `useResource` handles aborts, retries, and session expiry. Ordinary links navigate between the directory and person routes, which the server resolves to the SPA.
- Charts are lazy-loaded from `src/HistoryChart.tsx`. Use the wrapper's ESM core entry with explicitly registered ECharts modules; the CommonJS core entry does not render correctly in the production bundle.
- Browser tests launch local OIDC and backend contract fixtures through `test/fixtures/server.ts`. Only tests may use the in-memory session store. Real startup has no authentication or persistence fallback.

## Data invariants

- UI date inputs are UTC and inclusive; explicit API ranges are `[from,to)` and bounded to 366 days. Projects/activity default to all history independently; history charts default to the past year. The BFF expands omitted activity dates to the backend's full RFC3339 date domain because that endpoint requires bounds.
- Contribution counts are observations: deduplicate by forge instance, UTC date, metric, and kind using the latest `observed_at`, never sum repeated observations. Keep forge instances and kinds separate and missing days unknown, not zero.
- Source-reported counts, verified commit activity, and project event counts are different measures. Activity and projects are cursor-paginated; one page is not a total.
- Show coverage gaps and missing coverage explicitly. Do not imply complete account-wide commit collection or invent employee aggregates/live job status.

## Conventions

- Test setup lives in `src/test-setup.ts`; Vitest globals are enabled.
- Releases use release-please (`release-please-config.json`, `.release-please-manifest.json`); never hand-edit the version or changelog. Released images go to `ghcr.io/project-uatu/frontend`.
- Conventional commits, all lowercase, no issue numbers in subjects or PR titles.
- Before every push, run all CI checks: `yarn lint`, `yarn build`, `yarn test` with a dedicated test PostgreSQL database, and `yarn test:e2e`.
