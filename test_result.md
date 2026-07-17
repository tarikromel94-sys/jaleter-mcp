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
