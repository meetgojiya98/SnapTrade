# Public journey monitor

Paste all of [`public-journey.spec.ts`](./public-journey.spec.ts) into a Checkly **Browser Check** using its current supported Playwright runtime, then run it in Checkly before saving. The script uses the runtime’s built-in `@playwright/test`; no Checkly dependency, CLI grant, environment variables, login, or stored browser state is needed. See [Checkly’s Browser Check documentation](https://www.checklyhq.com/docs/detect/synthetic-monitoring/browser-checks/overview/).

The anonymous journey verifies the production landing page, follows its demo entry, sees the fictional portfolio value, and opens a ready rebalance simulation with an account funding ledger and enabled CSV export. It blocks and fails on any attempted same-origin API call. It does not open a private workspace, connect a brokerage, save a plan, export a file, or send a support request. It does not verify authenticated OAuth, database persistence, or operator support availability.

Configure these settings in Checkly:

- **Cadence:** every 2 hours.
- **Locations:** one region, or Round Robin with one execution per interval. Do not run regions in parallel.
- **Retries:** at most one platform retry. The script disables Playwright retries to avoid multiplying attempts.
- **Timeout:** 45 seconds for this single test.
- **Alerts:** select the account owner’s existing verified alert channel and verify the integration through Checkly before relying on it.

At this cadence, a 31-day month uses 372 scheduled runs, or at most 744 if every run retries once. Checkly currently includes [1,000 Browser/Playwright runs per month on Hobby](https://www.checklyhq.com/pricing/) (checked October 14, 2026). Manual runs and other browser monitors share that allowance; keep the account total below the cap and review usage before adding monitors or increasing frequency.

The sample value, account count, and accessible labels intentionally match the maintained demo. When changing those product fixtures or labels, update this script, run the public E2E tests, and rerun the saved monitor in Checkly. A passing public journey alone does not establish that live brokerage connections work.
