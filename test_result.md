#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## user_problem_statement:
User reported 3 issues:
1. Google login redirects back to Get Started instead of into the app (web).
2. Mock/fictional numbers, investments, and figures shown throughout the app should be removed.
3. "Scheduling" and "Payment" buttons don't work — need real implementations.

## backend:
  - task: "Stripe hosted checkout (one-time payment mode) for coaching + membership"
    implemented: true
    working: "NA"
    file: "/app/backend/payments_service.py, /app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Added POST /api/payments/checkout, GET /api/payments/status/{session_id},
          POST /api/coaching/book (via checkout), GET /api/coaching/bookings,
          GET /api/user/membership, GET /api/payments/products. Uses emergentintegrations
          StripeCheckout with sk_test_emergent (routes through Emergent proxy). Backend was
          manually smoke-tested with curl — coaching + membership sessions were created and
          real Stripe Checkout URLs returned. Booking documents persist in
          coaching_bookings collection.

## frontend:
  - task: "Google web sign-in: consume session_id fragment on return"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/AuthContext.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          On web, AuthProvider now checks for `session_id` in the URL hash/search on mount
          BEFORE trying to restore a stored token. If found, it POSTs to
          /api/auth/emergent/session and persists the user, then cleans the URL so refresh
          doesn't reprocess. This fixes the reported issue where users were being bounced
          back to the Welcome screen after Google auth.

  - task: "Remove mock/seeded numbers throughout the app"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Zeroed all initialCategories.budgeted, initialIncome.budgeted, initialAssets.value,
          initialLiabilities.value. Emptied initialTx. Set openingCash = 0. Removed the
          hardcoded "5050 committed" cash-protection number, the fake "+4.8% this quarter"
          growth line, the fake "7-day stewardship streak" banner, and the fake budget-alert
          copy. Budget alert now only shows when budgetUsage >= 80. Kept the 4-category
          Give/Steward/Grow/Enjoy structure but with $0 defaults so users set their own.

  - task: "Real Coaching booking + Stripe payment flow"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          CoachingScreen now shows upcoming business-day time slots (10 AM / 2 PM / 4 PM),
          user picks one and taps "Book & Pay $50". Frontend calls /api/payments/checkout,
          opens Stripe Checkout via WebBrowser.openAuthSessionAsync (native) or navigates
          window.location (web), then polls /api/payments/status until paid.
          Confirmed bookings are listed at the top of the screen.

  - task: "Real Membership subscribe flow (Paywall + Membership screens)"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Paywall "Continue to secure checkout" now creates a real $75 Stripe session.
          MembershipScreen shows active/expiry state via /api/user/membership and lets user
          subscribe or renew (extends by 365 days on payment). Membership stored per-user in
          `users.premium_expires_at`.

## metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 10
  run_ui: false

## test_plan:
  current_focus:
    - "Stripe hosted checkout (one-time payment mode) for coaching + membership"
    - "Google web sign-in: consume session_id fragment on return"
    - "Real Coaching booking + Stripe payment flow"
    - "Real Membership subscribe flow (Paywall + Membership screens)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

## agent_communication:
  - agent: "main"
    message: |
      Please validate:
      BACKEND (call directly with curl/httpx):
        1. POST /api/payments/checkout with {product:"coaching_session", platform:"mobile", scheduled_at:"<future ISO>"}
           and with {product:"jaleter_premium", platform:"mobile"}. Expect {session_id, url, txn_id, amount, currency, product_name}.
        2. GET /api/payments/status/{session_id} for a real session — expect status/payment_status; unpaid before user completes on Stripe.
        3. GET /api/payments/products — expect 2 products.
        4. GET /api/coaching/bookings — expect pending booking after creating coaching checkout.
        5. GET /api/user/membership — expect {active:false} for a fresh user.
        6. All endpoints require Bearer token. Reject with 401 without/invalid token.
        7. Regression: make sure existing auth, forgot/reset password, SimpleFIN link/list/sync, and file/support/snaptrade endpoints still work.

      FRONTEND (do NOT test actual Stripe redirect — impossible without a real card; validate that
      "Book & Pay $50" and "Subscribe — $75 / year" open Stripe checkout URLs; validate the coaching
      slot picker; and validate that mock data is gone from Budget/NetWorth/Home for a fresh user):
        1. Sign in as alex+test1@jaleter.app / password123.
        2. Home: Net Worth should read $0, budget% = 0%, no "7-day streak" banner, no fake alert.
        3. Budget screen: category budgets all read $0.
        4. Net Worth: cash/assets/liabilities all $0; hero shows $0 not a fake positive figure; growth-percentage text says "Updates with your linked accounts".
        5. More → Book Coaching: shows a list of upcoming slots; picking one and tapping "Book & Pay $50" opens a Stripe checkout URL (validate the returned URL contains "checkout.stripe.com").
        6. More → Membership: shows "Not active"; tapping "Subscribe — $75 / year" opens a Stripe checkout URL.

      Test credentials in /app/memory/test_credentials.md.

## user_problem_statement (Batch A):
Client escalation — 5 CRITICAL data-integrity issues:
1. Budget category rows are read-only at $0 — need tap-to-edit budget amount per subcategory
2. Transactions banner says "SimpleFIN sync is current" even when no accounts linked — misleading, must reflect real state
3. Net Worth "Cash" and "Investments" labels show source "Manual" — should auto-aggregate from linked SimpleFIN accounts
4. Confirm Stripe payments actually work end-to-end
5. Forgot-password flow must be tested (dev-fallback mode)

## backend:
  - task: "Existing endpoints (regression) — /api/auth/*, /api/accounts/*, /api/payments/*"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "No backend changes in this batch — verify no regressions. Auth, forgot-password (dev-fallback), SimpleFIN, payments should all still respond as before."

## frontend:
  - task: "Editable Budget subcategories — tap row → sheet → save amount"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          BudgetScreen now lifts categories to editable state (persisted to jaleter-state-v2).
          Each subcategory row is pressable → opens a Sheet with monthly-amount input.
          Save updates categories state, closes sheet, chevron appears on every row.
          Empty amount shows "tap to set" hint in champagne-gold. Header caption changed
          from "Budget vs. actual" to "Tap any row to set an amount".

  - task: "Transactions sync banner reflects real state, not fake copy"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Banner queries /api/accounts/all on mount and switches copy:
          - No links yet → orange "No accounts linked yet · Link a bank via Settings…"
          - Errored links → amber "N account(s) need attention"
          - OK links → green "N account(s) synced · Last sync Xm ago" with real timestamp
          Empty state also added to the transaction list itself (icon + "No transactions yet").

  - task: "Net Worth: Cash + Investments auto-aggregate from linked accounts"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Introduced isInvestmentAccount() heuristic (SnapTrade → investments; SimpleFIN
          account name matching invest/brokerage/IRA/401k/roth/hsa/etc → investments;
          everything else → cash). Cash and Investments rows now sum manual + linked and
          show source label "SimpleFIN · <org name>" or "SimpleFIN · N accounts". Real
          Estate and Vehicles rows stay Manual. Removed the previous "append linked rows
          as separate items on top of manual rows" that was double-counting. Hero net worth
          now also includes linkedAssetsTotal so Home + Net Worth agree.

  - task: "Home netWorth reads from same live linked source"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          MainApp now fetches /api/accounts/all on token change and includes
          linkedAssetsTotal in the netWorth calc used by HomeScreen. Single source of truth
          across Home + Net Worth. If no linked accounts, both show $0 for a fresh user.

## metadata:
  test_sequence: 13
  run_ui: false

## test_plan:
  current_focus:
    - "Editable Budget subcategories — tap row → sheet → save amount"
    - "Transactions sync banner reflects real state, not fake copy"
    - "Net Worth: Cash + Investments auto-aggregate from linked accounts"
    - "Home netWorth reads from same live linked source"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

## agent_communication:
  - agent: "main"
    message: |
      Batch A of the client escalation. FIVE fixes (all P0):

      FRONTEND TESTS (do all via Playwright web preview http://localhost:3000):
      Login as alex+test1@jaleter.app / password123 (see /app/memory/test_credentials.md).

      1) BUDGET EDITABLE — /Budget tab:
         - Expand any group (e.g. Give). Each subcategory should be a Pressable with a chevron and (when budgeted=0) "tap to set" hint in gold.
         - Tap Tithe → a bottom sheet opens titled "Set budget · Tithe".
         - Enter 500 and press "Save amount". Sheet closes. Row now shows "$500 budgeted".
         - Total Income cell should now read "of $0" for July (budget cell is expense-side). But the "Give" group card should show "of $500" and any bar/% math still works.
         - Reload the page — the 500 must PERSIST (stored in jaleter-state-v2).

      2) SYNC BANNER — /Transactions tab, freshly-empty account:
         - Banner must NOT say "SimpleFIN sync is current".
         - Should show "No accounts linked yet · Link a bank via Settings → Linked Accounts, or import a CSV." (amber-ish tint, chevron).
         - Transaction list empty state should also read "No transactions yet."
         - Simulate a link error (if easy, otherwise skip): banner should say "1 account needs attention".
         - After a successful SimpleFIN demo link (POST /api/accounts/simplefin/link with demo token; see test_credentials.md instructions if needed) banner should switch to green "1 account synced · Last sync just now."

      3) NET WORTH AGGREGATION — /Net Worth tab, freshly-empty account:
         - Hero must read $0.
         - Assets card must have exactly 4 rows: Cash, Investments, Real Estate, Vehicles.
         - Cash and Investments source column must read "Manual" (not append individual linked accounts).
         - Now link a demo SimpleFIN account (POST /api/accounts/simplefin/link). Refresh Net Worth.
         - Cash row VALUE must equal the sum of linked bank-type accounts.
         - Cash row SOURCE must show "SimpleFIN · <org name>" or "SimpleFIN · N accounts".
         - There should NOT be extra per-account rows appended to the Assets list.
         - Hero net worth must reflect this new balance.

      4) HOME MATCHES NET WORTH:
         - After linking, go to /Home. The Net Worth snapshot card must equal the Net Worth hero exactly.

      5) PERSISTENCE:
         - After editing a Budget amount and linking an account, tap Settings → "Reset App Data" → confirm.
         - Budget amounts should return to $0. Linked accounts on the server remain (server-side); local UI cache is cleared. Verify no crash.

      BACKEND SMOKE TESTS (only verifying regressions):
      - POST /api/auth/login, GET /api/auth/me
      - POST /api/auth/forgot-password (dev-fallback should still return reset_token in JSON since SENDGRID_API_KEY is empty)
      - POST /api/auth/reset-password with that reset_token → new token issued, user logs in with new password
      - POST /api/accounts/simplefin/link with demo token (get one from https://beta-bridge.simplefin.org/info/developers — refresh page each time)
      - GET /api/accounts/all
      - POST /api/payments/checkout for coaching_session and jaleter_premium — should still return real checkout.stripe.com URLs
      - GET /api/payments/status/{sid}

      STRIPE E2E is optional for this run (already verified in iteration 12). But if you have time, please re-run one $50 coaching purchase with 4242 4242 4242 4242 to confirm the CONFIRMED booking still appears.

      Credentials in /app/memory/test_credentials.md. If test_credentials.md is empty, alert me and I'll rewrite it.

## user_problem_statement (Batch B):
Client Batch B — 7 structural items:
6. Legacy needs to be its own bottom-nav tab (not buried under More)
7. Home + Net Worth + Legacy read from ONE data source
8. Legacy "+ hypothetical amount" what-if input
9. Legacy 1yr/2yr/3yr/5yr timeframes computed as cash + investments + monthly-net × months
10. Rename "Income" → "Earn" + editable Earn categories + add-new-source
11. Restricted Cash single manual field on Net Worth (subtracts from Available)
20. Real user initials in profile pill (no more "AW" placeholder)

## frontend:
  - task: "Legacy as bottom-nav tab"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Bottom nav is now [Home, Budget, Transactions, Net Worth, Legacy].
          Removed 'More' from the tab bar. The More screen is still routable via a new
          profile-pill button in the Home header (top right, shows real initials).
          More screen now has a back button that returns to Home.

  - task: "Single source of truth: Home + Net Worth + Legacy"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          MainApp computes linkedCashTotal, linkedInvestmentTotal, investmentTotal,
          totalCash, monthlyBudgetIncome, monthlyBudgetExpense, monthlyNet — passed
          to HomeScreen, NetWorthScreen, and LegacyScreen. Legacy no longer receives
          startingNetWorth as a black-box prop.

  - task: "Legacy hypothetical amount modeling"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Tapping "Hypothetical Amount" opens a Sheet with a $ input. The amount is
          stored in local screen state, added to investmentTotal for the projection,
          and shown as a distinct "+ Hypothetical amount" row (champagne-gold) in
          the "What we're projecting from" card — clearly separated from synced.

  - task: "Legacy 1-5yr short-horizon timeframes"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Period pills now: 1yr/2yr/3yr/5yr/10yr/20yr/Retirement.
          Short horizons (1-5yr) use: totalCash + totalInvestments + hypo + monthlyNet × 12 × years.
          Long horizons (10yr+/Retirement) use compounding at 8% + optional monthly contribution.
          Liabilities are NOT subtracted in short horizons (already baked into monthlyNet — per client spec).

  - task: "Rename Income to Earn + editable Earn"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          BudgetScreen now shows an "Earn" group at the top (green E badge), mirroring
          Give/Steward/Grow/Enjoy. Each income source is tappable → sheet to set monthly
          expected amount. "+ Add Earn source" opens a Sheet to add a new named source.
          Delete option in the edit sheet. Persisted to jaleter-state-v2.

  - task: "Restricted Cash on Net Worth"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Cash Protection strip replaced the "COMMITTED" static $0 with a pressable
          "RESTRICTED" cell. Tap → sheet with numeric input. Available =
          max(0, cash − restricted). Persisted to jaleter-state-v2.

  - task: "Real user initials in profile pill"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          initialsOf(name, email) helper: "Alex Ward" → "AW"; single-word name →
          first 2 chars; falls back to email prefix. Home header pill shows these
          initials. Settings header also uses the same computed initials.

## metadata:
  test_sequence: 14
  run_ui: false

## test_plan:
  current_focus:
    - "Legacy as bottom-nav tab"
    - "Single source of truth: Home + Net Worth + Legacy"
    - "Legacy hypothetical amount modeling"
    - "Legacy 1-5yr short-horizon timeframes"
    - "Rename Income to Earn + editable Earn"
    - "Restricted Cash on Net Worth"
    - "Real user initials in profile pill"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

## agent_communication:
  - agent: "main"
    message: |
      Batch B (7 structural items). Frontend-only changes — NO backend touched, expect no regressions.
      Test credentials: alex+test1@jaleter.app / password123 (may need Mongo cleanup — see prior iteration notes).
      ALWAYS clear localStorage first: page.evaluate("() => localStorage.clear()").

      TESTS (all frontend, Playwright, mobile 390x844):

      1) BOTTOM NAV
      - Log in. Bottom nav must be exactly [Home, Budget, Transactions, Net Worth, Legacy].
      - "More" must NOT be in the bottom nav.
      - Home header top-right must have a profile pill showing "AW" (initials of Alex Ward). Tap it → routes to More screen.
      - More screen must have a back button that returns to Home.

      2) SINGLE SOURCE OF TRUTH
      - As a fresh user: Home Net Worth $0 = Net Worth hero $0.
      - Link a demo SimpleFIN account (POST /api/accounts/simplefin/link). Refresh.
      - Home Net Worth = Net Worth hero = SUM of linked balances.
      - Net Worth Cash row source reads "SimpleFIN · N accounts" and value equals sum of non-investment linked accounts.

      3) LEGACY (Legacy tab)
      - Period pills must be exactly: 1yr, 2yr, 3yr, 5yr, 10yr, 20yr, Retirement.
      - Retirement tab: "WHAT WE'RE PROJECTING FROM" shows "Current investments (synced) $X" where X matches Net Worth Investments row exactly.
      - "Hypothetical Amount" card shows "+ Add". Tap → Sheet opens. Enter 50000 → Save. Card now shows $50,000. Projection increases.
      - Switch to 3yr pill: card now also shows "Current cash (synced)" and "Monthly net (from Budget)".
      - 3yr projection = totalCash + totalInvestments + hypothetical + monthlyNet × 36.
      - Monthly Contribution card visible on 10yr/20yr/Retirement but HIDDEN on 1-5yr tabs.

      4) BUDGET → EARN
      - Budget tab: "Earn" section appears at top (green E icon), above "Plan by Purpose".
      - Row W-2 Income shows "$0 · tap to set". Tap → sheet → enter 5000 → Save. Row now shows "$5,000 · expected". Total Income "of $X" updates.
      - "+ Add Earn source" opens sheet. Enter name "Consulting" and amount 1500 → Save. New row appears.
      - Tap it again → sheet has "Delete this source" (red) at bottom. Tap Delete → source disappears.
      - Reload page → login again → new Earn source persists (unless deleted).

      5) NET WORTH → RESTRICTED CASH
      - Net Worth tab: Cash Protection strip should show TOTAL CASH − RESTRICTED = AVAILABLE.
      - "RESTRICTED" cell shows $0 with "tap to set" hint. Tap → sheet → enter 200 → Save.
      - RESTRICTED now shows $200. AVAILABLE = max(0, cash - 200).
      - Persists across reload.

      6) INITIALS
      - Change alex's user record to name="Sarah" (via Mongo: db.users.update_one({email:"alex+test1@jaleter.app"}, {"$set": {"name": "Sarah"}})). Log out, log back in.
      - Home pill should show "SA" (single word → first 2 chars uppercased).
      - Change name back to "Alex Ward" — pill shows "AW".

      NO backend changes were made. Please run existing backend regression tests to confirm nothing broke.

## user_problem_statement (Batch C + D):
Client Batch C + D — 9 items:
12. Budget: 12 months + annual auto-split with per-month override
13. Face ID + PIN app lock (biometric-optional)
14. Coaching: calendar-style booking view (not slot list)
15. Per-category alerts at 50 / 80 / exceeded (three toggle chips per subcategory)
16. Budgeted + actual side-by-side (no more tap-in-to-see)
17. Add Category + Export to Excel buttons
18. Redesign Budget cards (less repetitive, scannable)
19. Grid / Annual spreadsheet view (categories × 12 months)

## frontend:
  - task: "Budget 12-month tabs + annual auto-split with override"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          MONTHS is now all 12 months. Period pill scrolls horizontally. Data model:
          each sub has `budgeted` (monthly default) + optional `months: {[mIdx]: number}` for
          per-month overrides. `monthlyAmount(sub, mIdx) = months?.[mIdx] ?? budgeted`;
          `annualAmount = sum(monthly, 0..11)`. Edit modal aware of period:
          - Year selected → sets `budgeted = annual/12`, clears all overrides
          - Specific month → writes to `months[mIdx]` only
          - Override shown with • marker, includes "Reset {month} to auto-split" button.

  - task: "Budget: Add Category + Export to Excel + Add Subcategory + delete via long-press"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Two action buttons under summary: "Add Category" and "Export to Excel".
          - Add Category → sheet with name + tagline
          - Add Subcategory → per-category "+ Add subcategory" row inside expanded group
          - Export to Excel → generates CSV, downloads on web via Blob URL, on native saves
            to cache + opens share sheet via expo-file-system + expo-sharing.
          Long-press a category or subcategory to delete.

  - task: "Budget: Cards redesign — budgeted + actual side by side"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Row layout now shows "actual / budgeted" together on the right side of each row.
          Category-level shows "actual / total" plus % used inline. Removed the separate
          "% used / remaining" meta row for cleaner scanning.

  - task: "Budget Grid view (annual spreadsheet)"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          View toggle in header (Cards / Grid). Grid: fixed left column (subcategory name),
          horizontal scroll for Jan..Dec + Year column. Each cell shows monthly amount and,
          if there's an actual, secondary line. Over-budget cells highlighted amber. Tap
          any cell to open edit sheet for that subcategory.

  - task: "Per-category alerts at 50 / 80 / exceeded"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Data model: alerts.perCategory = { [subId]: { p50, p80, exceeded } }.
          Settings screen shows a "Budget Alerts" section: master toggle + per-subcategory
          row with three toggle chips (50%, 80%, 100%+). Enabled chips are champagne-gold.
          In Budget Cards view, when actual crosses an enabled threshold for a sub, a
          coloured badge ("50%", "80%", "OVER") appears next to its name.

  - task: "Face ID + PIN app lock"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          expo-local-authentication + expo-secure-store. Settings section "App Lock" —
          tapping opens configure sheet: enter PIN twice, optional biometrics toggle
          (only shown if hasHardware + isEnrolled). PIN stored in SecureStore under
          `jaleter_app_lock_pin`.
          On MainApp mount, loads lock state; if pin exists → `locked: true`. Renders
          `<AppLockGate />` full-screen instead of app content until unlocked.
          Gate: 6-dot indicator + numeric pad; supports 4-6 digit PINs; auto-attempts
          biometrics on mount if enabled; wrong-PIN shake + reset.
          NOTE: biometrics only work in a native build — not in Expo Go/web preview.

  - task: "Coaching: calendar-style booking view"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Replaced slot list with a proper month calendar (7-col grid). Header shows
          month/year with prev/next arrows. Days: past/weekends disabled, today
          highlighted, selected day filled bronze. Selecting a day reveals time chips
          (10am / 2pm / 4pm) — user picks a time, then Book & Pay $50 opens Stripe.
          Existing payment + confirmation flow untouched.

## metadata:
  test_sequence: 15
  run_ui: false

## test_plan:
  current_focus:
    - "Budget 12-month tabs + annual auto-split with override"
    - "Budget: Add Category + Export to Excel + Add Subcategory + delete via long-press"
    - "Budget: Cards redesign — budgeted + actual side by side"
    - "Budget Grid view (annual spreadsheet)"
    - "Per-category alerts at 50 / 80 / exceeded"
    - "Face ID + PIN app lock"
    - "Coaching: calendar-style booking view"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

## agent_communication:
  - agent: "main"
    message: |
      Batch C + D (9 items). ALL frontend. Backend untouched — expect no regressions.
      Cleanup + login flow same as prior iterations.

      T1 — 12-MONTH BUDGET + ANNUAL AUTO-SPLIT (item 12):
      - Budget tab: PeriodPills horizontally scroll through Jan..Dec + Year.
      - Default period = the CURRENT month name (Jul at present).
      - Expand Give. Tap Tithe. Sheet says "Set Jul · Tithe" or similar. Enter 500. Save.
        Row shows $500 (actual) / $500 (budgeted) — actually just $0 actual since no transactions.
      - Switch to Year pill. Tap Tithe. Sheet now says "Set annual · Tithe". Enter 6000 → Save.
      - Switch to Jan pill. Tithe should now show $500 (=6000/12) auto-split.
      - Tap Tithe in Jan → enter 900 → Save. Jan now shows $900, small • marker next to name (override).
        Sheet has "Reset Jan to auto-split" button — tap → row returns to $500.

      T2 — ADD CATEGORY / SUBCATEGORY / EXPORT (item 17):
      - Under summary strip, verify buttons "Add Category" + "Export to Excel".
      - Add Category → sheet → name "Health" + tagline "Care for the body" → Create.
      - New "Health" category appears at the bottom of the list.
      - Expand it → "+ Add subcategory" row.
      - Tap → sheet → name "Gym" + amount 45 → Add. Row appears.
      - Long-press Gym → subcategory deletes (toast).
      - Long-press "Health" card → whole category deletes.
      - Tap "Export to Excel" → on web, a CSV file with today's date must download. Check
        headers: Type, Category, Subcategory, Jan..Dec, Annual Total. Check that Give/Tithe
        row's July value = $500 (or whatever you set).

      T3 — GRID VIEW (item 19):
      - Top right: two icon pills (Cards / Grid). Tap Grid.
      - Grid view: fixed Category column on left, Jan..Dec header scrolls horizontally.
      - Give/Tithe row: Jan $500, Feb $500, ..., Jul $900 (the override), rest $500.
        Year column shows sum = $6,400 approx.
      - Tap a cell → same edit sheet opens.
      - Toggle back to Cards.

      T4 — PER-CATEGORY ALERTS (item 15):
      - Settings tab: "Budget Alerts" section. Master toggle ON.
      - Per subcategory: three chips 50% / 80% / 100%+. Default: 80 + exceeded ON, 50 OFF.
      - Turn on 50% for Tithe.
      - Add a manual expense transaction: $300 tithe (Category Give / Detail Tithe / July).
      - Go to Budget → expand Give → Tithe. Since $300/$900 = 33%, no badge.
      - Add another $300 tithe → $600/$900 = 66% → badge "50%" (champagne-gold) appears next to Tithe name.
      - Add $400 more → over $900 → badge "OVER" (red).

      T5 — APP LOCK (item 13):
      - Settings tab: "App Lock" section. Row says "Not set · Tap to set a PIN".
      - Tap → sheet "Set a PIN". Type 1 2 3 4 → dots fill → Tap Continue.
      - "Enter your PIN again to confirm". Type 1 2 3 4 → tap Save PIN.
      - Sheet closes. Row now says "Enabled · PIN only" with a lock icon.
      - Fully reload the browser page (page.reload()). App re-mounts.
      - AppLockGate must appear: black gate with "Jaleter" logo + "Enter your PIN to unlock" + PIN pad.
      - Type 1 2 3 4 → gate dismisses → normal Home shown.
      - Type wrong PIN 9 9 9 9 → "Incorrect PIN" flashes red, resets to 0 dots.
      - Reopen Settings → tap App Lock row → sheet → "Turn off App Lock" button at bottom. Tap it.
      - Reload page again — no gate; Home loads directly.
      - Biometrics: only test if `LocalAuthentication.hasHardwareAsync()` returns true in the browser
        (it won't in web) — skip that assertion on web.

      T6 — CALENDAR BOOKING (item 14):
      - Home profile pill → More → Book Coaching.
      - Verify a proper month calendar view (not a slot list).
        Header shows current month/year, prev/next arrows, weekday labels S M T W T F S.
      - Past days must be visually dimmed (opacity ~30%).
      - Weekends dimmed too. Weekdays enabled (bold + full opacity).
      - Tap next arrow → month advances to Aug.
      - Tap prev arrow → back to current month.
      - Tap a future weekday (e.g. next Tuesday). Day becomes bronze/selected.
      - Below calendar, "PICK A TIME · [day]" heading + time chips (10:00 AM, 2:00 PM, 4:00 PM).
      - Tap 2:00 PM → chip becomes bronze/selected.
      - Tap Book & Pay $50 → POST /api/payments/checkout → opens checkout.stripe.com URL. Do NOT complete the payment.

      T7 — CROSS-SCREEN REGRESSIONS:
      - Home netWorth still == Net Worth hero (linked accounts).
      - Legacy still works, 1-5yr / 10yr / Retirement pills still there.
      - Earn section still editable.
      - Restricted Cash still works.
      - Profile initials still correct.
      - No JS errors in console.

      BACKEND — run smoke check on /api/auth/*, /api/accounts/*, /api/payments/*, /api/coaching/bookings.

      Please write results to /app/test_reports/iteration_15.json.
      DO NOT modify payments_service.py or checkout logic.

## user_problem_statement (Apple Sign-In):
Add Apple Sign-In to Login + Signup screens.

## backend:
  - task: "POST /api/auth/apple — verify Apple identity token via JWKS + issue our JWT"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          New endpoint POST /api/auth/apple. Verifies the Apple identity_token:
          - Fetches Apple JWKS from https://appleid.apple.com/auth/keys (cached 1h)
          - Selects the key by 'kid' header, retries once after cache bust if unknown
          - Verifies RS256 signature via python-jose (jwk.construct + to_pem)
          - Validates issuer == https://appleid.apple.com and audience in APPLE_AUDIENCES
            (from backend/.env — currently ["com.emergent.nochangesmobile.fl0fmc", "host.exp.Exponent"])
          - Extracts 'sub' as apple_sub; email may be private-relay (still accepted)
          - Links to existing user by apple_sub OR falls back to email match
          - Creates a new user with provider='apple' on first sign-in, preserving name/email from
            the initial credential payload (Apple only sends those ONCE)
          - Returns AuthResponse (user + JWT) — same shape as /auth/login and /auth/emergent/session
          Rejects malformed / unsigned / wrong-audience tokens with 401.

## frontend:
  - task: "Apple Sign-In button on Login + Signup"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/index.tsx, /app/frontend/src/AuthContext.tsx, /app/frontend/app.json"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          - expo-apple-authentication@8.0.8 installed
          - app.json: expo.ios.usesAppleSignIn = true
          - AuthContext exposes loginWithApple({ identity_token, name, email }) →
            POSTs to /api/auth/apple, persists JWT via existing secure storage
          - New AppleSignInButton component: hidden on non-iOS AND on iOS when
            AppleAuthentication.isAvailableAsync() returns false. Uses Apple's
            official CONTINUE button style (black).
          - Rendered directly below the Google button on Login + Signup screens.
          - On web the button is INTENTIONALLY hidden (Apple restricts native flow to iOS).
          - Hint copy updated to include Apple only when Platform.OS === 'ios'.

## metadata:
  test_sequence: 17
  run_ui: false

## test_plan:
  current_focus:
    - "POST /api/auth/apple — verify Apple identity token via JWKS + issue our JWT"
    - "Apple Sign-In button on Login + Signup"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

## agent_communication:
  - agent: "main"
    message: |
      Please test the Apple Sign-In backend endpoint. The native iOS button flow CANNOT be
      tested from Playwright/web preview — Apple only issues valid identity tokens through
      the AppleAuthentication.signInAsync call on a real iOS device.

      BACKEND (all against http://localhost:8001):
      1. POST /api/auth/apple with body {} → expect 422 (validation) or 400.
      2. POST /api/auth/apple {"identity_token":""} → expect 401 with detail containing "Invalid Apple identity token".
      3. POST /api/auth/apple {"identity_token":"aaa.bbb.ccc"} → expect 401 with detail containing "Invalid Apple identity token (malformed header)".
      4. POST /api/auth/apple with a JWT that has correct 3-segment shape but wrong signature
         (e.g., an HS256 token signed with a random secret) → expect 401 "Apple identity token signed with unknown key" OR verification failed.
         You can craft one via:
            python3 -c "from jose import jwt; print(jwt.encode({'sub':'abc','iss':'https://appleid.apple.com','aud':'com.emergent.nochangesmobile.fl0fmc'}, 'wrong-secret', algorithm='HS256', headers={'kid':'zzzzzzzz'}))"
      5. Confirm AUTH REGRESSION endpoints still work exactly as before:
         POST /api/auth/register with a new email
         POST /api/auth/login with alex+test1@jaleter.app / password123
         GET /api/auth/me with the returned token
         POST /api/auth/forgot-password (should return reset_token in dev-fallback since SENDGRID_API_KEY is empty)
         POST /api/auth/emergent/session {"session_id":"anything"} — should return 401 or similar
      6. Confirm /api/payments/products, /api/coaching/bookings, /api/user/membership still work.

      FRONTEND (Playwright web preview — Apple button will be HIDDEN on web, that's correct):
      1. Log-out state → tap Log in link. Verify Google button visible, Apple button NOT visible.
      2. Log-out state → tap Sign up. Verify Google button visible, Apple button NOT visible.
      3. No red console errors from the AppleSignInButton mounting.
      4. Existing Google/email/JWT flows all still work exactly as before.

      NOTE for tester: on iOS build the Apple button IS shown and works. Not testable in Expo Go/web/Playwright — this is a platform restriction, not a bug.

      Report to /app/test_reports/iteration_17.json.

  - agent: "main"
    message: |
      PRE-LAUNCH PUNCH-LIST — Option #1 (all 6 items) implemented in a single turn.
      All changes are FRONTEND-ONLY in /app/frontend/app/index.tsx. No backend schema
      or endpoint changes were required — all new state persists via existing
      storage.setItem STORAGE_KEY payload.

      TESTING SCOPE (frontend only via Playwright web preview at localhost:3000):

      1. HOME LEGACY SNAPSHOT (fix) — /app/frontend/app/index.tsx `HomeScreen`.
         - Log in as alex+test1@jaleter.app / password123 (or register a new account).
         - On Home tab, scroll to the "LEGACY SNAPSHOT" card (only visible when the
           user has any assets/investments/monthly-surplus data).
         - Expected: TWO clearly-labeled rows —
             CASH · GROWS FROM SURPLUS  → Y1 / Y5 / Y10 (cash only)
             INVESTMENTS · COMPOUND @ 7%  → Y10 / Y20 / Y30 (compound)
         - Confirm the numbers are DIFFERENT for cash vs investments (previously
           bug: both rows mixed cash + invest + hypo).

      2. LEGACY MATH TRANSPARENCY — LegacyScreen.
         - Navigate to Legacy tab (bottom nav).
         - Confirm the projection card is followed by a "YOUR ASSUMPTIONS" chip strip
           showing tap-editable chips: RETURN (%), CONTRIB/MO, CASH (BUILD only),
           INVESTMENTS, HYPOTHETICAL, YEARS (Retirement only).
         - Tap "RETURN" chip → sheet opens ("Expected annual return"). Change to 8,
           save, confirm projection recalculates.
         - Confirm a "How this is calculated" collapsible card appears below the
           assumptions strip. Tap to expand — verify it shows step-by-step math with
           the actual dollar amounts, and the note explaining cash vs investments.

      3. HYPOTHETICAL FREQUENCY PICKER — LegacyScreen.
         - Tap "HYPOTHETICAL" chip (or the Hypothetical Amount card below).
         - Sheet should show:
           * Frequency segmented control: One-time / Monthly / Annual
           * Amount input (label changes based on frequency)
           * Duration in years field (visible only for Monthly/Annual, optional)
         - Set: Monthly $500 for 5 years, save.
         - Verify the projection recalculates and the chip now reads "$500/mo for 5yrs".

      4. SET ASIDE REDESIGN — NetWorthScreen.
         - Navigate to Net Worth tab.
         - Confirm the Total Cash − Set Aside = Available strip. When Set Aside > Cash,
           AVAILABLE should render in red with "Over-allocated" label (not clamped to 0).
         - Tap SET ASIDE. Sheet should show:
           * "QUICK ADD" preset chips: Emergency Fund, Taxes, Vacation / Travel, Home,
             Auto, Medical, Education, Gifts / Holidays, Business, Other.
           * Tap "Vacation / Travel" preset — inline form opens with name pre-filled.
             Add Amount $1000, Target $5000, Target date "Dec 2026", save.
           * Bucket appears with progress bar (20%).
         - Tap the "Add" button on the bucket → sheet opens → add $500 → bucket now $1500.
         - Tap "Use" button → sheet opens → use $2000 → bucket clamps to $0 (never negative).
         - Tap archive icon → bucket moves to "ARCHIVED (n)" section.
         - Expand archived → un-archive button restores; delete button confirms + removes.

      5. BUDGET SUBCATEGORY REASSIGNMENT — BudgetScreen.
         - Navigate to Budget tab.
         - Expand "Steward" category. Add a subcategory "Test Delete" with $10.
         - Log a manual transaction in Transactions tab against "Test Delete" — $50 expense.
         - Return to Budget, tap the trash/close icon on "Test Delete".
         - EXPECTED: A "Reassign" sheet opens with:
           * Warning: "1 transaction affected"
           * Radio list of every other subcategory grouped by category
           * "Create new subcategory" option with name field
         - Pick another subcategory (e.g. "Groceries"), tap "Move & delete Test Delete".
         - Verify: (a) toast shows "Moved 1 transaction · deleted..." (b) transaction still
           exists in Transactions, now assigned to Groceries; (c) financial totals unchanged.
         - Repeat with a subcategory that has ZERO transactions — plain confirm dialog
           should appear (no reassignment sheet).

      6. RETIREMENT ASSUMPTION INPUTS — LegacyScreen.
         - On Legacy tab, tap the "Retirement" pill under GROW.
         - Confirm the Retirement Age card renders with Current age / Retirement age
           inputs.
         - Tap the RETURN chip in the assumptions strip — should still open the return-rate
           sheet.
         - Verify chip strip shows: RETURN, CONTRIB/MO, INVESTMENTS, HYPOTHETICAL, YEARS.

      REGRESSION CHECKS:
      - Home budget/networth cards still render.
      - Transactions tab still lists all transactions.
      - Adding / editing categories, subcategories, and earn sources still works.
      - Legacy BUILD vs GROW toggle still works (1yr/2yr/.../30yr/Retirement).
      - Reset App Data still clears everything (including new legacy state).
      - Persistence: reload the page — new frequency, duration, return rate,
        bucket data must all survive.

      NO BACKEND changes. Skip backend tests unless the frontend calls surface an
      unrelated regression.

      Report to /app/test_reports/iteration_next.json (next available number).

  - agent: "main"
    message: |
      PHASE 1 OF 3 — Data model + Wealth + Sync labels — implementation complete.

      SCOPE:
      1. Transaction TYPE now supports 'transfer' as a first-class type.
         - Manual Transfer via TxForm PeriodPills — 3 options: Income / Expense / Transfer.
         - Auto-classified from Plaid: system_category ∈ {transfer, credit_card_payment, loan_payment}
           → Tx.type = 'transfer' at reshape time. Never counted as income or expense.
         - isSystemTransaction now returns true when t.type === 'transfer' too.
      2. `merchant` field added to Tx type + backend Plaid mapper (uses txn.merchant_name).
         - New TextInput "Merchant" in the TxForm sheet.
      3. `splits` array added to Tx type. Split allocations UI in TxForm:
         - '+ Split this' button appends 2 rows (each with category/sub + amount).
         - Allocated / Remaining summary + "Balanced" indicator.
         - Save disabled until splits sum equals the total transaction amount.
      4. Wealth de-dedupe by (link_id, account_id) — no more double-counting from repeat items.
      5. Wealth zero-value insurance filter — term life / disability with $0 balance excluded.
      6. New collapsible "WEALTH BY CATEGORY" card on NetWorthScreen:
         - Assets: Cash / Investments / Real Estate / Vehicles / Other Assets.
         - Liabilities: Credit Cards / Mortgage / Auto Loans / Student Loans / Other.
         - Each row shows category total; expanding reveals every underlying
           account (name, bank, last-sync, balance). Category totals = sum of rows.
      7. Real "Last synced …" timestamp displayed atop the Wealth categories card
         plus a Sync button that fires plaid/sync + accounts/sync.
      8. Activity filters now include "Transfers" pill.
      9. Activity rows display merchant (when different from description) + "Transfer"
         badge + "Split (N)" badge for split transactions.

      FILES CHANGED:
      - /app/frontend/app/index.tsx (Tx type, isSystemTransaction, TxForm redesign,
        Activity filter+rows, NetWorthScreen dedupe+collapsible categories)
      - /app/backend/plaid_service.py (map_plaid_transaction now sets `merchant`)

      NO backend schema changes required — merchant lands in existing bank_transactions
      docs via the mapper; frontend Tx state persists via existing STORAGE_KEY.

      TESTING TO PERFORM (frontend, both preview + code review acceptable):
      - Add a manual Expense with a Merchant "Starbucks" and $10 — save, verify row
        shows " · Starbucks" and $10 expense count updates.
      - Add a manual Transfer $200 — verify:
        * Doesn't show up in Income or Expense totals on Reports/Home.
        * Activity row shows the swap icon and " · Transfer" tag.
        * Activity Transfers pill filters to just this row.
      - Add an Expense $180, tap "+ Split this", split $100/$80 across two subs.
        Save disabled until amounts balance. Once balanced, save.
      - Wealth tab: scroll to "WEALTH BY CATEGORY" card, verify:
        * Last synced timestamp shown.
        * Category totals collapsed by default; tap expands to show accounts.
        * Category total == sum of expanded accounts.

      NO backend changes required. Report to next iteration file.

  - agent: "main"
    message: |
      PHASE 2 OF 3 — Budget + Activity + Chase Plaid — implementation complete.

      CHANGES:
      1. Budget Earn row now shows Actual / Budget / Left columns (matching expense rows).
         Includes column headers and clickable Actual for drill-down.
      2. Splits-aware & year-aware Budget accounting:
         - New helpers spentForSubInMonth / receivedForIncomeInMonth / transactionsForSubInMonth (~L353).
         - Handles split transactions by iterating splits and attributing amounts.
         - BudgetScreen actualIncome/actualExpenses/spentInSub/spentInGroup all refactored (~L1697).
      3. July → July fix: Plaid transactions now parse YYYY-MM directly from the date string
         (was using `new Date().getMonth()` which could TZ-shift Jul 1 → Jun 30).
      4. Tap any Actual amount → drill-down sheet shows contributing transactions.
         Tap a transaction → opens TxForm to edit/reclassify/delete.
         Works for both expense subcategories and Earn sources.
      5. Activity screen: added two secondary filter rows —
         - Date range: All / Last 30d / This Month / Last Month / YTD.
         - Account/bank: dynamically populated from unique `origin` values.
      6. Chase Plaid fixes:
         - Increased Plaid transactions.days_requested from 90 → 730 (full 24-month backfill).
         - New Update-Mode Plaid link-token endpoint: POST /api/plaid/link-token?item_id=<id>
           returns a link_token for re-authentication of existing Plaid items in
           ITEM_LOGIN_REQUIRED state.

      TESTING FOCUS (Phase 2):
      - Budget: Earn row now displays as a 4-column row with Actual/Budget/Left headers.
      - Add a manual Income $1000 with Earn source "W-2 Salary". Confirm actual shows.
      - Tap "Actual" amount on any subcategory or earn source → sheet opens listing the
        transaction(s). Tap the transaction → TxForm opens with pre-filled fields.
      - Manual Expense $180 with splits ($100 Groceries, $80 Household). Confirm:
        * $100 counts toward Groceries actual and $80 toward Household.
        * Budget totals reflect both correctly.
        * Drill-down for Groceries shows the tx with "of $180" annotation.
      - Activity: Date range pills All/30d/This Month/Last Month/YTD render and filter.
      - Activity: Account pills only shown when >2 unique origins exist; filter works.
      - Backend: POST /api/plaid/link-token?item_id=xxx should return a link_token when a
        Plaid item exists (update-mode) or 404 if item_id not found. Regular POST with no
        item_id returns a fresh link_token.
      - Test with alex+test1@jaleter.app (no linked Plaid items so update mode returns 404).

      NO breaking changes. Existing manual transactions still render/filter correctly.
      Report to next available iteration file.

  - agent: "main"
    message: |
      PHASE 3 OF 3 — Reports + Legacy — implementation complete.

      REPORTS FIXES (/app/frontend/src/ReportsScreen.tsx):
      1. Classification now uses `tx.type` (not signed amount). All Jaleter tx
         amounts are positive; type ∈ {income, expense, transfer}.
      2. Transfers explicitly excluded via both system_category AND type='transfer'.
      3. Splits-aware: each transaction contributes to categoryPie / incomePie /
         subcategoryBars via a local `allocations()` helper that iterates splits.
      4. Renamed sections:
         - "Where the money came from (by source)" → "Income by Source"
         - "Where the money went (by category)" → "Spending by Category"
         - "Top merchants / sources" → "Top Merchants (spending)"
      5. Category resolution now uses groupId → category name (was reading
         legacy fields t.category / t.subcategory).

      LEGACY FIXES (/app/frontend/app/index.tsx):
      6. BUILD math clamps surplus at >= 0 per spec ("Only use surplus if positive").
         Real (possibly-negative) surplus still surfaced in the "What we're
         projecting from" card so users see it.
      7. Home Legacy Snapshot rewritten to mirror Legacy tab exactly:
         - BUILD row: 1YR / 2YR / 3YR / 5YR (drops old Y1/Y5/Y10 Cash split)
         - GROW row: 10YR GROW / 20YR GROW / 30YR GROW
         - Labels explicitly say "GROW" so users never confuse 10yr Cash
           with 10yr investment compounding.
      8. Math card note now explicitly explains negative-surplus clamp when
         applicable, guiding the user to fix their Budget.

      NO backend changes.

      TESTING FOCUS:
      - Reports tab:
        * Add manual $500 Income (Salary) + $200 Expense (Groceries) + $50 Transfer.
        * Income total should show $500 (never $700). Expense should show $200.
        * Transfer excluded from all totals + pies.
        * Section headers show "Income by Source" and "Spending by Category".
        * Merchant chip in tx row appears in "Top Merchants (spending)".
        * Add a split expense $180 = $100 Groceries + $80 Household. Both
          subcategories appear in the "Spending by Category" pie with correct
          shares.
      - Home Legacy Snapshot:
        * Verify BUILD row shows 4 tiles: 1YR / 2YR / 3YR / 5YR.
        * Verify GROW row shows 3 tiles: 10YR GROW / 20YR GROW / 30YR GROW.
        * Number of tiles: 7 total (not 6 as before).
      - Legacy tab:
        * BUILD projection with a NEGATIVE surplus (spending > income) must
          NOT shrink cash further — clamp surplus at $0 with a note in the
          math card explaining it.

      Report to next iteration file.

  - agent: "main"
    message: |
      POST-PHASE-3 REFINEMENT PASS — Legacy + Activity filters + Wealth cleanup + no-flash loading.

      LEGACY (/app/frontend/app/index.tsx):
      1. BUILD now holds investments FLAT (no 7% applied). Cash grows only from
         positive monthly surplus. GROW / Retirement keep compounding at the
         user-editable rate. Home Snapshot label updated:
         BUILD · CASH + SURPLUS · INVESTMENTS FLAT
         GROW · INVESTMENTS COMPOUND @ N%
      2. Monthly Budget Surplus row is now TAPPABLE — opens a read-only
         breakdown sheet showing:
           Budgeted Monthly Income
           − Budgeted Monthly Expenses
           = Monthly Budget Surplus
         + Source: "Based on <Month> <Year> budget"
         When negative, sheet shows a "Surplus clamped to $0" banner + guidance.
      3. Row text updated to "No positive budget surplus available for projection."
         when the raw surplus is negative.

      ACTIVITY:
      4. Consolidated Date range + Account/bank filters into a single "Filter"
         button that opens a bottom sheet with both sections + Reset/Done.
         Filter button shows a gold dot when any advanced filter is active.

      WEALTH (NetWorthScreen):
      5. REMOVED the duplicate "Assets"/"Liabilities" WorthCards. Kept a single
         collapsible "ASSETS & LIABILITIES" tree (renamed from WEALTH BY CATEGORY)
         with per-category expand-to-account rows.
      6. NEW top-of-page Sync banner ("Accounts synced" / "Updating your
         accounts…" / "Syncing…" / "Refreshing…") with Last Synced timestamp
         in the user's device local timezone (via toLocaleString('en-US', ...)).
      7. No-flash loading state:
         - Net Worth hero shows a skeleton bar until first fetch completes.
         - Cash / Set Aside / Available strip shows "Updating your accounts…"
           until linkedLoaded flips true.
         - Removed the duplicate /accounts/all fetch inside NetWorthScreen so
           there is only ONE request per token.
         - refreshLinked keeps last-known linkedRows on failure — never wipes
           to empty and never renders a $0 flash.
      8. Timezone: all Last-Synced strings use toLocaleString('en-US', {...})
         which is device-local by default; no hardcoded CST/CDT anywhere.

      Frontend-only. NO backend schema changes required.

      TESTING FOCUS:
      - Legacy tab: verify BUILD 1yr/2yr/3yr/5yr and Retirement all display.
        BUILD math no longer shows a 7% return applied to investments — they
        should stay flat at the current value across all BUILD years.
      - Legacy: tap "Monthly Budget Surplus" → drill-down sheet opens with
        income/expense/surplus breakdown + "Based on <Month> <Year> budget".
      - Activity: verify only ONE row of top filter pills + a "Filter" button;
        tapping the button opens a sheet with Date range + Account chips.
      - Wealth: on cold start, verify no negative/$0 net worth is briefly shown.
        A "Updating your accounts…" strip should appear until data lands.
        The old Assets/Liabilities cards are gone — only ONE collapsible
        Assets & Liabilities card remains at the bottom.
      - Home Legacy Snapshot: BUILD row (1YR/2YR/3YR/5YR) values should equal
        currentCash + surplus*12*n + currentInvestments (flat), never compounded.

      Report to next iteration file.
