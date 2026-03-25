import React, { useMemo, useState } from "react";
import {
  ArrowUpRight,
  Bell,
  Building2,
  ChartBar,
  CreditCard,
  DollarSign,
  Goal,
  House,
  Landmark,
  Menu,
  PiggyBank,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function JaleterApp() {
  const [theme, setTheme] = useState("cyber");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [period, setPeriod] = useState("monthly");
  const [isSyncOpen, setSyncOpen] = useState(false);
  const [syncStep, setSyncStep] = useState("select");
  const [syncBank, setSyncBank] = useState("Chase");
  const [toasts, setToasts] = useState([]);

  const [finance, setFinance] = useState({
    personalNetWorth: 0,
    personalIncome: 0,
    investmentsValue: 0,
    incomeTypes: [
      { id: crypto.randomUUID(), name: "Salary", budget: 0, actual: 0 },
      { id: crypto.randomUUID(), name: "Side Hustle", budget: 0, actual: 0 },
    ],
    expenseTypes: [
      { id: crypto.randomUUID(), name: "Housing", budget: 0, actual: 0 },
      { id: crypto.randomUUID(), name: "Food", budget: 0, actual: 0 },
      { id: crypto.randomUUID(), name: "Transport", budget: 0, actual: 0 },
    ],
    accounts: [],
    householdMembers: [],
    goals: [
      { id: crypto.randomUUID(), name: "Vacation", current: 0, target: 0 },
      { id: crypto.randomUUID(), name: "New Car", current: 0, target: 0 },
    ],
  });

  const [prefs, setPrefs] = useState({
    pushNotifications: true,
    biometrics: true,
  });

  const pushToast = (message) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 2500);
  };

  const periodFactor = period === "monthly" ? 1 : 12;
  const totalMemberNetWorth = finance.householdMembers.reduce((sum, m) => sum + m.netWorth, 0);
  const totalMemberIncome = finance.householdMembers.reduce((sum, m) => sum + m.income, 0);
  const totalHouseholdNetWorth = finance.personalNetWorth + totalMemberNetWorth;
  const householdIncome = finance.personalIncome + totalMemberIncome;

  const totalIncome = finance.incomeTypes.reduce((sum, i) => sum + i.actual, 0) * periodFactor;
  const totalExpenses = finance.expenseTypes.reduce((sum, e) => sum + e.actual, 0) * periodFactor;
  const netSummary = totalIncome - totalExpenses;

  const investmentsSeries = useMemo(
    () => [
      { m: "Jan", value: finance.investmentsValue * 0.55 },
      { m: "Feb", value: finance.investmentsValue * 0.63 },
      { m: "Mar", value: finance.investmentsValue * 0.74 },
      { m: "Apr", value: finance.investmentsValue * 0.78 },
      { m: "May", value: finance.investmentsValue * 0.89 },
      { m: "Jun", value: finance.investmentsValue || 0 },
    ],
    [finance.investmentsValue]
  );

  const themes = {
    light:
      "bg-[linear-gradient(180deg,#f8fafc_0%,#e2e8f0_60%,#dbeafe_100%)] text-slate-800",
    dark: "bg-[#0f172a] text-slate-100",
    cyber:
      "bg-[radial-gradient(circle_at_top,#0f172a_0%,#05070d_45%,#02040a_100%)] text-slate-100",
  };

  const panelClass =
    theme === "cyber"
      ? "bg-white/5 border border-cyan-300/20 backdrop-blur-xl shadow-[0_0_0_1px_rgba(34,211,238,.15),0_20px_40px_-16px_rgba(6,182,212,.35)]"
      : theme === "light"
      ? "bg-white/85 border border-slate-200 shadow-xl shadow-slate-300/50"
      : "bg-slate-800 border border-slate-700 shadow-xl shadow-black/40";

  const navItems = [
    { key: "dashboard", label: "Dashboard", icon: House },
    { key: "budget", label: "Budget", icon: Wallet },
    { key: "household", label: "Household", icon: Users },
    { key: "accounts", label: "Accounts", icon: Landmark },
    { key: "cashflow", label: "Cash Flow", icon: ChartBar },
    { key: "investments", label: "Investments", icon: ArrowUpRight },
    { key: "goals", label: "Goals", icon: Goal },
    { key: "preferences", label: "Preferences", icon: Sparkles },
  ];

  const mobileTabs = ["dashboard", "budget", "accounts", "cashflow", "preferences"];

  const updateListNumber = (listKey, id, field, value) => {
    setFinance((prev) => ({
      ...prev,
      [listKey]: prev[listKey].map((item) =>
        item.id === id ? { ...item, [field]: Number.isFinite(value) ? value : 0 } : item
      ),
    }));
  };

  const runBankSync = () => {
    setSyncStep("auth");
    pushToast(`Connecting to ${syncBank} through secure channel...`);
    setTimeout(() => {
      setSyncStep("done");
      setFinance((prev) => ({
        ...prev,
        personalNetWorth: 164000,
        personalIncome: 6900,
        investmentsValue: 52350,
        incomeTypes: [
          { id: crypto.randomUUID(), name: "Salary", budget: 7200, actual: 6900 },
          { id: crypto.randomUUID(), name: "Freelance", budget: 850, actual: 940 },
        ],
        expenseTypes: [
          { id: crypto.randomUUID(), name: "Housing", budget: 2200, actual: 2140 },
          { id: crypto.randomUUID(), name: "Food", budget: 800, actual: 920 },
          { id: crypto.randomUUID(), name: "Transport", budget: 350, actual: 315 },
          { id: crypto.randomUUID(), name: "Utilities", budget: 420, actual: 390 },
        ],
        accounts: [
          { id: crypto.randomUUID(), name: `${syncBank} Checking`, type: "Bank", balance: 11980 },
          { id: crypto.randomUUID(), name: `${syncBank} Savings`, type: "Bank", balance: 28640 },
          { id: crypto.randomUUID(), name: "Everyday Card", type: "Credit", balance: -1240 },
        ],
      }));
      pushToast("Secure sync complete. Financial data encrypted + imported.");
    }, 2200);
  };

  const EditableNumber = ({ value, onChange, className = "" }) => {
    const [editing, setEditing] = useState(false);
    const display = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
      Number(value) || 0
    );

    return editing ? (
      <input
        autoFocus
        type="number"
        className={`w-28 rounded-lg border border-cyan-400/50 bg-black/30 px-2 py-1 text-right ${className}`}
        value={value}
        onBlur={() => setEditing(false)}
        onChange={(e) => onChange(Number(e.target.value || 0))}
      />
    ) : (
      <button className={`rounded px-1 hover:bg-cyan-500/10 ${className}`} onClick={() => setEditing(true)}>
        {display}
      </button>
    );
  };

  const EditableText = ({ value, onChange }) => (
    <input
      className="w-full rounded-lg border border-slate-400/20 bg-transparent px-2 py-1 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  const Header = () => (
    <div className={`sticky top-0 z-10 mb-4 flex items-center justify-between rounded-2xl p-3 ${panelClass}`}>
      <div className="flex items-center gap-3">
        <button className="rounded-lg p-2 hover:bg-cyan-500/20 lg:hidden" onClick={() => setSidebarOpen((s) => !s)}>
          <Menu size={18} />
        </button>
        <JaleterLogo />
      </div>
      <button className="rounded-lg p-2 hover:bg-cyan-500/20" onClick={() => pushToast("All data safely stored locally.")}>
        <ShieldCheck size={18} />
      </button>
    </div>
  );

  const SummaryCards = () => (
    <div className="grid gap-3 md:grid-cols-4">
      {[
        { label: "Household Net Worth", value: totalHouseholdNetWorth, icon: PiggyBank },
        { label: "Household Income", value: householdIncome * periodFactor, icon: DollarSign },
        { label: "Total Expenses", value: totalExpenses, icon: CreditCard },
        { label: "Net Summary", value: netSummary, icon: ChartBar },
      ].map((card) => (
        <div key={card.label} className={`rounded-2xl p-4 ${panelClass}`}>
          <div className="mb-2 flex items-center justify-between text-xs opacity-80">
            <span>{card.label}</span>
            <card.icon size={15} />
          </div>
          <div className="text-xl font-semibold">
            <EditableNumber value={card.value} onChange={() => {}} className="pointer-events-none" />
          </div>
        </div>
      ))}
    </div>
  );

  const BudgetTable = ({ title, listKey, rows }) => (
    <details open className={`rounded-2xl p-4 ${panelClass}`}>
      <summary className="cursor-pointer font-semibold">{title}</summary>
      <div className="mt-3 space-y-2">
        {rows.map((row) => {
          const budget = row.budget * periodFactor;
          const actual = row.actual * periodFactor;
          const progress = budget <= 0 ? 0 : Math.min((actual / budget) * 100, 100);
          const over = actual > budget && budget > 0;
          return (
            <div key={row.id} className="rounded-xl border border-slate-400/20 p-3">
              <div className="grid gap-2 md:grid-cols-[1.2fr_1fr_1fr]">
                <EditableText
                  value={row.name}
                  onChange={(name) =>
                    setFinance((prev) => ({
                      ...prev,
                      [listKey]: prev[listKey].map((item) => (item.id === row.id ? { ...item, name } : item)),
                    }))
                  }
                />
                <EditableNumber
                  value={budget}
                  onChange={(value) => updateListNumber(listKey, row.id, "budget", value / periodFactor)}
                />
                <EditableNumber
                  value={actual}
                  onChange={(value) => updateListNumber(listKey, row.id, "actual", value / periodFactor)}
                />
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-500/20">
                <div className={`h-full ${over ? "bg-red-500" : "bg-cyan-400"}`} style={{ width: `${progress}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );

  const addMember = () => {
    setFinance((prev) => ({
      ...prev,
      householdMembers: [
        ...prev.householdMembers,
        { id: crypto.randomUUID(), name: "New Member", role: "Dependent", netWorth: 0, income: 0 },
      ],
    }));
    pushToast("Household member securely added.");
  };

  const addGoal = () => {
    setFinance((prev) => ({
      ...prev,
      goals: [...prev.goals, { id: crypto.randomUUID(), name: "Custom Goal", current: 0, target: 0 }],
    }));
  };

  const screen = {
    dashboard: (
      <div className="space-y-4">
        <SummaryCards />
        <div className={`grid gap-4 rounded-2xl p-4 lg:grid-cols-2 ${panelClass}`}>
          <div>
            <h3 className="mb-2 font-semibold">Personal Core Metrics</h3>
            <p className="text-sm opacity-70">Click any value to edit live numbers.</p>
            <div className="mt-3 space-y-2 text-sm">
              <Row label="Personal Net Worth">
                <EditableNumber
                  value={finance.personalNetWorth}
                  onChange={(v) => setFinance((p) => ({ ...p, personalNetWorth: v }))}
                />
              </Row>
              <Row label="Personal Monthly Income">
                <EditableNumber
                  value={finance.personalIncome}
                  onChange={(v) => setFinance((p) => ({ ...p, personalIncome: v }))}
                />
              </Row>
              <Row label="Total Investments">
                <EditableNumber
                  value={finance.investmentsValue}
                  onChange={(v) => setFinance((p) => ({ ...p, investmentsValue: v }))}
                />
              </Row>
            </div>
          </div>
          <div className="rounded-xl border border-cyan-300/20 p-3">
            <h4 className="mb-2 font-medium">Secure Bank Sync</h4>
            <p className="text-sm opacity-75">Autofill realistic accounts, budget and dashboard metrics.</p>
            <button className="mt-3 rounded-xl bg-cyan-500/20 px-3 py-2 text-sm hover:bg-cyan-500/30" onClick={() => setSyncOpen(true)}>
              Start Secure Sync
            </button>
          </div>
        </div>
      </div>
    ),
    budget: (
      <div className="space-y-4">
        <div className={`flex items-center justify-between rounded-2xl p-3 ${panelClass}`}>
          <h3 className="font-semibold">Budget Planner</h3>
          <button className="rounded-lg bg-cyan-500/20 px-3 py-1 text-sm" onClick={() => setPeriod((p) => (p === "monthly" ? "yearly" : "monthly"))}>
            {period === "monthly" ? "Monthly" : "Yearly"}
          </button>
        </div>
        <SummaryCards />
        <BudgetTable title="Income Types" rows={finance.incomeTypes} listKey="incomeTypes" />
        <BudgetTable title="Expense Types" rows={finance.expenseTypes} listKey="expenseTypes" />
      </div>
    ),
    household: (
      <div className="space-y-4">
        <div className={`flex items-center justify-between rounded-2xl p-4 ${panelClass}`}>
          <h3 className="font-semibold">Household Members</h3>
          <button className="rounded-lg bg-cyan-500/20 px-3 py-1 text-sm" onClick={addMember}>+ Add Member</button>
        </div>
        {finance.householdMembers.map((m) => (
          <div key={m.id} className={`grid gap-2 rounded-xl p-3 md:grid-cols-4 ${panelClass}`}>
            <EditableText
              value={m.name}
              onChange={(name) =>
                setFinance((p) => ({ ...p, householdMembers: p.householdMembers.map((i) => (i.id === m.id ? { ...i, name } : i)) }))
              }
            />
            <EditableText
              value={m.role}
              onChange={(role) =>
                setFinance((p) => ({ ...p, householdMembers: p.householdMembers.map((i) => (i.id === m.id ? { ...i, role } : i)) }))
              }
            />
            <EditableNumber
              value={m.netWorth}
              onChange={(netWorth) =>
                setFinance((p) => ({ ...p, householdMembers: p.householdMembers.map((i) => (i.id === m.id ? { ...i, netWorth } : i)) }))
              }
            />
            <EditableNumber
              value={m.income}
              onChange={(income) =>
                setFinance((p) => ({ ...p, householdMembers: p.householdMembers.map((i) => (i.id === m.id ? { ...i, income } : i)) }))
              }
            />
          </div>
        ))}
      </div>
    ),
    accounts: (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {finance.accounts.length === 0 ? (
          <div className={`rounded-2xl p-6 text-sm opacity-80 ${panelClass}`}>No linked accounts yet. Use Secure Sync from Dashboard.</div>
        ) : (
          finance.accounts.map((a) => (
            <div key={a.id} className={`rounded-2xl p-4 ${panelClass}`}>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="font-medium">{a.name}</h4>
                <Building2 size={16} />
              </div>
              <p className="text-sm opacity-75">{a.type}</p>
              <p className="mt-3 text-xl font-semibold">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(a.balance)}</p>
            </div>
          ))
        )}
      </div>
    ),
    cashflow: (
      <div className={`h-[360px] rounded-2xl p-4 ${panelClass}`}>
        <h3 className="mb-3 font-semibold">Live Income vs Expenses</h3>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={[{ label: period, income: totalIncome, expenses: totalExpenses }]}>
            <CartesianGrid strokeDasharray="4 4" strokeOpacity={0.2} />
            <XAxis dataKey="label" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="income" fill="#22d3ee" radius={[8, 8, 0, 0]} />
            <Bar dataKey="expenses" fill="#fb7185" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    ),
    investments: (
      <div className={`h-[360px] rounded-2xl p-4 ${panelClass}`}>
        <h3 className="mb-3 font-semibold">Portfolio Growth Projection</h3>
        <ResponsiveContainer width="100%" height="90%">
          <AreaChart data={investmentsSeries}>
            <CartesianGrid strokeDasharray="4 4" strokeOpacity={0.2} />
            <XAxis dataKey="m" />
            <YAxis />
            <Tooltip />
            <Area type="monotone" dataKey="value" stroke="#22d3ee" fill="url(#investGradient)" strokeWidth={2} />
            <defs>
              <linearGradient id="investGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.05} />
              </linearGradient>
            </defs>
          </AreaChart>
        </ResponsiveContainer>
      </div>
    ),
    goals: (
      <div className="space-y-3">
        <button className="rounded-lg bg-cyan-500/20 px-3 py-2 text-sm" onClick={addGoal}>+ Add Goal</button>
        {finance.goals.map((g) => {
          const progress = g.target > 0 ? Math.min((g.current / g.target) * 100, 100) : 0;
          return (
            <div key={g.id} className={`rounded-2xl p-4 ${panelClass}`}>
              <div className="grid gap-2 md:grid-cols-3">
                <EditableText
                  value={g.name}
                  onChange={(name) =>
                    setFinance((p) => ({ ...p, goals: p.goals.map((x) => (x.id === g.id ? { ...x, name } : x)) }))
                  }
                />
                <EditableNumber
                  value={g.current}
                  onChange={(current) =>
                    setFinance((p) => ({ ...p, goals: p.goals.map((x) => (x.id === g.id ? { ...x, current } : x)) }))
                  }
                />
                <EditableNumber
                  value={g.target}
                  onChange={(target) =>
                    setFinance((p) => ({ ...p, goals: p.goals.map((x) => (x.id === g.id ? { ...x, target } : x)) }))
                  }
                />
              </div>
              <div className="mt-3 h-2 rounded-full bg-slate-500/20">
                <div className="h-full rounded-full bg-emerald-400" style={{ width: `${progress}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    ),
    preferences: (
      <div className="space-y-3">
        <div className={`rounded-2xl p-4 ${panelClass}`}>
          <h3 className="mb-2 font-semibold">Theme Engine</h3>
          <div className="flex flex-wrap gap-2">
            {["light", "dark", "cyber"].map((m) => (
              <button
                key={m}
                className={`rounded-lg px-3 py-2 text-sm ${theme === m ? "bg-cyan-500/40" : "bg-slate-500/20"}`}
                onClick={() => {
                  setTheme(m);
                  pushToast(`Theme switched to ${m} mode.`);
                }}
              >
                {m === "light" ? "Light" : m === "dark" ? "Dark" : "Cyber / Default"}
              </button>
            ))}
          </div>
        </div>
        <div className={`space-y-3 rounded-2xl p-4 ${panelClass}`}>
          <Toggle label="Push Notifications" icon={Bell} value={prefs.pushNotifications} onToggle={() => setPrefs((p) => ({ ...p, pushNotifications: !p.pushNotifications }))} />
          <Toggle label="Biometric Security" icon={ShieldCheck} value={prefs.biometrics} onToggle={() => setPrefs((p) => ({ ...p, biometrics: !p.biometrics }))} />
        </div>
      </div>
    ),
  };

  return (
    <div className={`min-h-screen p-3 pb-20 transition-all duration-300 md:p-5 ${themes[theme]}`}>
      <Header />

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <aside className={`${isSidebarOpen ? "block" : "hidden"} lg:block`}>
          <div className={`rounded-2xl p-3 ${panelClass}`}>
            {navItems.map((item) => (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                  activeTab === item.key ? "bg-cyan-500/25" : "hover:bg-cyan-500/10"
                }`}
              >
                <item.icon size={15} /> {item.label}
              </button>
            ))}
          </div>
        </aside>
        <main>{screen[activeTab]}</main>
      </div>

      <nav className={`fixed bottom-3 left-1/2 z-20 grid w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 grid-cols-5 rounded-2xl p-2 lg:hidden ${panelClass}`}>
        {mobileTabs.map((tab) => {
          const item = navItems.find((n) => n.key === tab);
          const Icon = item.icon;
          return (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`rounded-xl p-2 ${activeTab === tab ? "bg-cyan-500/30" : ""}`}>
              <Icon size={16} className="mx-auto" />
            </button>
          );
        })}
      </nav>

      {isSyncOpen && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-black/70 p-4">
          <div className={`w-full max-w-md rounded-2xl p-4 ${panelClass}`}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">Secure Bank Sync</h3>
              <button onClick={() => setSyncOpen(false)}>
                <X size={16} />
              </button>
            </div>
            {syncStep === "select" && (
              <div className="space-y-3">
                <select className="w-full rounded-lg bg-slate-900/40 p-2" value={syncBank} onChange={(e) => setSyncBank(e.target.value)}>
                  <option>Chase</option>
                  <option>Bank of America</option>
                  <option>Wells Fargo</option>
                  <option>Citi</option>
                  <option>Capital One</option>
                </select>
                <button className="w-full rounded-lg bg-cyan-500/25 p-2" onClick={runBankSync}>Connect Securely</button>
              </div>
            )}
            {syncStep === "auth" && <p className="animate-pulse text-sm">Encrypting session, validating credentials, importing transactions...</p>}
            {syncStep === "done" && (
              <div className="space-y-2 text-sm">
                <p>Connection successful. Your data has been synced.</p>
                <button
                  className="w-full rounded-lg bg-emerald-500/25 p-2"
                  onClick={() => {
                    setSyncOpen(false);
                    setSyncStep("select");
                  }}
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="fixed right-3 top-16 z-40 space-y-2">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-lg px-3 py-2 text-sm ${panelClass}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-500/20 px-3 py-2">
      <span>{label}</span>
      {children}
    </div>
  );
}

function Toggle({ label, icon: Icon, value, onToggle }) {
  return (
    <button className="flex w-full items-center justify-between rounded-lg border border-slate-400/20 px-3 py-2" onClick={onToggle}>
      <span className="flex items-center gap-2 text-sm">
        <Icon size={15} /> {label}
      </span>
      <span className={`h-5 w-10 rounded-full p-0.5 ${value ? "bg-cyan-400" : "bg-slate-500"}`}>
        <span className={`block h-4 w-4 rounded-full bg-white transition-all ${value ? "ml-5" : "ml-0"}`} />
      </span>
    </button>
  );
}

function JaleterLogo() {
  return (
    <div className="flex items-center gap-2">
      <svg width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="17" width="5" height="13" rx="1" fill="#22d3ee" />
        <rect x="11" y="12" width="5" height="18" rx="1" fill="#22d3ee" opacity="0.85" />
        <rect x="19" y="7" width="5" height="23" rx="1" fill="#22d3ee" opacity="0.7" />
        <path d="M3 21C8 16 14 16 19 11C22 8 25 6 31 4" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M30 8L31 4L27 4" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div>
        <p className="text-sm font-semibold">Jaleter</p>
        <p className="text-[10px] opacity-70">Budget OS</p>
      </div>
    </div>
  );
}
