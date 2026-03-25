import React, { useMemo, useState } from "react";
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
import {
  Bell,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  DollarSign,
  Goal,
  Home,
  Landmark,
  Moon,
  PiggyBank,
  Shield,
  Smartphone,
  Sun,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";

export default function JaleterApp() {
  const [theme, setTheme] = useState("cyber");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toasts, setToasts] = useState([]);

  const [personal, setPersonal] = useState({
    netWorth: 0,
    monthlyIncome: 0,
    totalInvestments: 0,
  });

  const [members, setMembers] = useState([]);
  const [newMember, setNewMember] = useState({
    name: "",
    role: "Partner",
    netWorth: 0,
    monthlyIncome: 0,
  });

  const [period, setPeriod] = useState("monthly");
  const [incomeExpanded, setIncomeExpanded] = useState(true);
  const [expenseExpanded, setExpenseExpanded] = useState(true);

  const [incomeCategories, setIncomeCategories] = useState([
    { id: "income-1", name: "Primary Salary", budget: 0, actual: 0 },
    { id: "income-2", name: "Side Income", budget: 0, actual: 0 },
  ]);

  const [expenseCategories, setExpenseCategories] = useState([
    { id: "expense-1", name: "Housing", budget: 0, actual: 0 },
    { id: "expense-2", name: "Food", budget: 0, actual: 0 },
    { id: "expense-3", name: "Transport", budget: 0, actual: 0 },
  ]);

  const [accounts, setAccounts] = useState([
    { id: "acc-1", name: "Main Checking", type: "Bank", balance: 0 },
    { id: "acc-2", name: "Emergency Savings", type: "Bank", balance: 0 },
    { id: "acc-3", name: "Rewards Card", type: "Credit", balance: 0 },
  ]);

  const [goals, setGoals] = useState([
    { id: "goal-1", title: "Vacation", target: 0, current: 0 },
  ]);
  const [newGoal, setNewGoal] = useState({ title: "", target: 0, current: 0 });

  const [preferences, setPreferences] = useState({
    pushNotifications: true,
    biometricSecurity: false,
  });

  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [selectedBank, setSelectedBank] = useState("Chase");
  const [syncState, setSyncState] = useState("idle");

  const themeMap = {
    light: {
      app: "bg-[linear-gradient(135deg,#f8fbff_0%,#f3f7ff_40%,#eef3ff_100%)] text-slate-900",
      panel: "bg-white/90 border border-slate-200 shadow-[0_12px_30px_rgba(2,6,23,0.08)]",
      panelAlt: "bg-white border border-slate-100",
      accent: "text-cyan-700",
      accentBg: "bg-cyan-500",
      muted: "text-slate-500",
      nav: "bg-white/90 border-r border-slate-200",
      input: "bg-white border border-slate-300",
    },
    dark: {
      app: "bg-[#101320] text-slate-100",
      panel: "bg-[#1a1f33] border border-[#2f3959] shadow-[0_20px_40px_rgba(0,0,0,0.35)]",
      panelAlt: "bg-[#151a2c] border border-[#2d3651]",
      accent: "text-sky-300",
      accentBg: "bg-sky-500",
      muted: "text-slate-400",
      nav: "bg-[#13182a] border-r border-[#2a3453]",
      input: "bg-[#0f1426] border border-[#2e3b61]",
    },
    cyber: {
      app: "bg-[radial-gradient(circle_at_15%_20%,rgba(19,110,136,0.35)_0%,rgba(7,10,16,0)_35%),radial-gradient(circle_at_80%_0%,rgba(205,149,69,0.22)_0%,rgba(7,10,16,0)_38%),linear-gradient(180deg,#04070d_0%,#070c14_100%)] text-[#e8f6ff]",
      panel:
        "bg-[linear-gradient(145deg,rgba(16,30,44,0.65),rgba(11,18,33,0.55))] border border-[rgba(153,219,255,0.22)] backdrop-blur-xl shadow-[0_20px_60px_rgba(0,245,255,0.12),inset_0_1px_0_rgba(255,255,255,0.08)]",
      panelAlt:
        "bg-[linear-gradient(145deg,rgba(15,21,36,0.9),rgba(8,14,26,0.9))] border border-[rgba(153,219,255,0.2)]",
      accent: "text-[#67edff]",
      accentBg: "bg-[#2de4ff]",
      muted: "text-[#9fb3c7]",
      nav: "bg-[rgba(9,14,24,0.9)] border-r border-[rgba(103,237,255,0.2)] backdrop-blur-xl",
      input: "bg-[rgba(10,18,30,0.8)] border border-[rgba(103,237,255,0.25)]",
    },
  };

  const t = themeMap[theme];
  const periodMultiplier = period === "monthly" ? 1 : 12;

  const householdNetWorth = useMemo(
    () => personal.netWorth + members.reduce((sum, m) => sum + (m.netWorth || 0), 0),
    [members, personal.netWorth]
  );

  const householdMonthlyIncome = useMemo(
    () =>
      personal.monthlyIncome +
      members.reduce((sum, m) => sum + (m.monthlyIncome || 0), 0),
    [members, personal.monthlyIncome]
  );

  const totalIncome = useMemo(
    () => incomeCategories.reduce((sum, item) => sum + (item.actual || 0), 0),
    [incomeCategories]
  );

  const totalExpenses = useMemo(
    () => expenseCategories.reduce((sum, item) => sum + (item.actual || 0), 0),
    [expenseCategories]
  );

  const incomeBudgetTotal = useMemo(
    () => incomeCategories.reduce((sum, item) => sum + (item.budget || 0), 0),
    [incomeCategories]
  );

  const expenseBudgetTotal = useMemo(
    () => expenseCategories.reduce((sum, item) => sum + (item.budget || 0), 0),
    [expenseCategories]
  );

  const netSummary = totalIncome - totalExpenses;

  const cashFlowData = [
    {
      name: period === "monthly" ? "This Month" : "This Year",
      Income: totalIncome * periodMultiplier,
      Expenses: totalExpenses * periodMultiplier,
    },
  ];

  const investmentSeries = Array.from({ length: 8 }).map((_, i) => ({
    month: `M${i + 1}`,
    value:
      personal.totalInvestments *
      (0.4 + i * 0.08 + (theme === "cyber" ? 0.04 : 0.02)),
  }));

  const addToast = (message, type = "success") => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 2600);
  };

  const formatMoney = (value) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value || 0);

  const updateBudgetRow = (setter, rows, rowId, key, displayValue) => {
    setter(
      rows.map((row) =>
        row.id === rowId
          ? {
              ...row,
              [key]: key === "name" ? displayValue : displayValue / periodMultiplier,
            }
          : row
      )
    );
  };

  const addMember = () => {
    if (!newMember.name.trim()) {
      addToast("Please provide a member name.", "error");
      return;
    }
    setMembers((prev) => [...prev, { ...newMember, id: crypto.randomUUID() }]);
    setNewMember({ name: "", role: "Partner", netWorth: 0, monthlyIncome: 0 });
    addToast("Household member added securely.");
  };

  const addBudgetCategory = (type) => {
    const row = {
      id: crypto.randomUUID(),
      name: type === "income" ? "New Income" : "New Expense",
      budget: 0,
      actual: 0,
    };
    if (type === "income") setIncomeCategories((prev) => [...prev, row]);
    else setExpenseCategories((prev) => [...prev, row]);
    addToast(`${type === "income" ? "Income" : "Expense"} category created.`);
  };

  const addGoal = () => {
    if (!newGoal.title.trim()) {
      addToast("Goal title is required.", "error");
      return;
    }
    setGoals((prev) => [...prev, { ...newGoal, id: crypto.randomUUID() }]);
    setNewGoal({ title: "", target: 0, current: 0 });
    addToast("Savings goal added.");
  };

  const startBankSync = () => {
    setSyncState("loading");
    addToast(`Establishing encrypted tunnel to ${selectedBank}...`);
    setTimeout(() => {
      setPersonal({ netWorth: 245000, monthlyIncome: 10200, totalInvestments: 89000 });
      setMembers([
        {
          id: "m-1",
          name: "Alex",
          role: "Partner",
          netWorth: 92000,
          monthlyIncome: 5700,
        },
      ]);
      setAccounts([
        { id: "a-1", name: "Premium Checking", type: "Bank", balance: 14220 },
        { id: "a-2", name: "High Yield Savings", type: "Bank", balance: 38250 },
        { id: "a-3", name: "Travel Credit Card", type: "Credit", balance: -1940 },
      ]);
      setIncomeCategories([
        { id: "inc-1", name: "Salary", budget: 11500, actual: 11000 },
        { id: "inc-2", name: "Freelance", budget: 1800, actual: 2100 },
      ]);
      setExpenseCategories([
        { id: "exp-1", name: "Mortgage", budget: 2800, actual: 2800 },
        { id: "exp-2", name: "Utilities", budget: 520, actual: 610 },
        { id: "exp-3", name: "Food", budget: 950, actual: 880 },
        { id: "exp-4", name: "Insurance", budget: 760, actual: 760 },
      ]);
      setGoals([
        { id: "g1", title: "Vacation", target: 8000, current: 4600 },
        { id: "g2", title: "New Car", target: 22000, current: 9800 },
      ]);
      setSyncState("done");
      addToast("Bank sync completed. Live data imported.");
      setTimeout(() => {
        setIsSyncModalOpen(false);
        setSyncState("idle");
      }, 900);
    }, 1600);
  };

  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: Home },
    { id: "household", label: "Household", icon: Users },
    { id: "budget", label: "Budget", icon: Wallet },
    { id: "accounts", label: "Accounts", icon: Landmark },
    { id: "cashflow", label: "Cash Flow", icon: DollarSign },
    { id: "investments", label: "Investments", icon: Briefcase },
    { id: "goals", label: "Goals", icon: Goal },
    { id: "preferences", label: "Preferences", icon: Shield },
  ];

  const mobileTabs = tabs.slice(0, 5);

  const EditableNumber = ({ value, onChange, className = "" }) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(String(value || 0));

    return editing ? (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9.-]/g, ""))}
        onBlur={() => {
          setEditing(false);
          onChange(Number(draft || 0));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        className={`w-full rounded-md px-2 py-1 text-right ${t.input} ${className}`}
      />
    ) : (
      <button
        type="button"
        onClick={() => {
          setDraft(String(value || 0));
          setEditing(true);
        }}
        className={`rounded-md px-2 py-1 text-right transition hover:bg-white/10 ${className}`}
      >
        {formatMoney(value)}
      </button>
    );
  };

  const EditableText = ({ value, onChange }) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    return editing ? (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onChange(draft || "Untitled");
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className={`rounded-md px-2 py-1 ${t.input}`}
      />
    ) : (
      <button
        type="button"
        className="rounded-md px-2 py-1 text-left hover:bg-white/10"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        {value}
      </button>
    );
  };

  const SummaryCard = ({ title, value, subtitle, icon: Icon, positive = true }) => (
    <div className={`rounded-2xl p-4 ${t.panel}`}>
      <div className="mb-3 flex items-center justify-between">
        <p className={`text-xs uppercase tracking-widest ${t.muted}`}>{title}</p>
        <Icon className={`h-5 w-5 ${positive ? t.accent : "text-rose-400"}`} />
      </div>
      <p className="text-2xl font-semibold">{formatMoney(value * periodMultiplier)}</p>
      <p className={`text-xs ${t.muted}`}>{subtitle}</p>
    </div>
  );

  const SectionHeader = ({ title, expanded, onToggle }) => (
    <button
      className={`mb-3 flex w-full items-center justify-between rounded-xl p-3 text-left ${t.panelAlt}`}
      type="button"
      onClick={onToggle}
    >
      <span className="font-medium">{title}</span>
      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
    </button>
  );

  return (
    <div className={`min-h-screen ${t.app}`}>
      <div className="flex min-h-screen">
        <aside
          className={`hidden md:flex ${sidebarCollapsed ? "w-20" : "w-72"} flex-col ${t.nav} p-4 transition-all duration-300`}
        >
          <div className="mb-8 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <svg viewBox="0 0 180 60" className="h-10 w-14">
                <defs>
                  <linearGradient id="jaleterLogo" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#5ee8ff" />
                    <stop offset="100%" stopColor="#d9a35a" />
                  </linearGradient>
                </defs>
                <rect x="10" y="30" width="16" height="18" rx="2" fill="url(#jaleterLogo)" />
                <rect x="35" y="22" width="16" height="26" rx="2" fill="url(#jaleterLogo)" />
                <rect x="60" y="12" width="16" height="36" rx="2" fill="url(#jaleterLogo)" />
                <path
                  d="M10 38 C 35 10, 60 20, 78 5"
                  stroke="url(#jaleterLogo)"
                  strokeWidth="4"
                  fill="none"
                  strokeLinecap="round"
                />
                <path d="M75 3 L86 6 L80 15" fill="none" stroke="url(#jaleterLogo)" strokeWidth="4" />
              </svg>
              {!sidebarCollapsed && <h1 className="text-xl font-semibold tracking-wide">Jaleter</h1>}
            </div>
            <button
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              className={`rounded-xl p-2 ${t.panelAlt}`}
              type="button"
            >
              {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>

          <nav className="flex flex-1 flex-col gap-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 transition ${
                    activeTab === tab.id ? `${t.panelAlt} ${t.accent}` : "hover:bg-white/10"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {!sidebarCollapsed && <span>{tab.label}</span>}
                </button>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={() => setIsSyncModalOpen(true)}
            className={`mt-6 rounded-xl px-3 py-2 text-sm font-medium ${t.panelAlt}`}
          >
            Secure Bank Sync
          </button>
        </aside>

        <main className="flex-1 pb-20 md:pb-6">
          <header className="sticky top-0 z-20 border-b border-white/10 bg-black/20 px-4 py-3 backdrop-blur md:px-8">
            <div className="mx-auto flex max-w-7xl items-center justify-between">
              <h2 className="text-lg font-medium capitalize">{activeTab}</h2>
              <button
                type="button"
                onClick={() => setIsSyncModalOpen(true)}
                className={`hidden rounded-xl px-3 py-2 text-sm md:block ${t.panelAlt}`}
              >
                Connect Bank
              </button>
            </div>
          </header>

          <div className="mx-auto grid max-w-7xl gap-4 px-4 py-6 md:px-8">
            {activeTab === "dashboard" && (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <SummaryCard title="Personal Net Worth" value={personal.netWorth} subtitle="Click to edit below" icon={PiggyBank} />
                  <SummaryCard
                    title="Total Household Net Worth"
                    value={householdNetWorth}
                    subtitle="Auto-summed across members"
                    icon={Users}
                  />
                  <SummaryCard title="Monthly Income" value={personal.monthlyIncome} subtitle="Primary profile" icon={DollarSign} />
                  <SummaryCard title="Investments" value={personal.totalInvestments} subtitle="Portfolio value" icon={Briefcase} />
                </div>
                <div className={`grid gap-4 rounded-2xl p-5 ${t.panel}`}>
                  <h3 className="text-lg font-semibold">Live Core Metrics (Editable)</h3>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <p className={`text-xs ${t.muted}`}>Personal Net Worth</p>
                      <EditableNumber
                        value={personal.netWorth}
                        onChange={(value) => setPersonal((prev) => ({ ...prev, netWorth: value }))}
                      />
                    </div>
                    <div>
                      <p className={`text-xs ${t.muted}`}>Personal Monthly Income</p>
                      <EditableNumber
                        value={personal.monthlyIncome}
                        onChange={(value) => setPersonal((prev) => ({ ...prev, monthlyIncome: value }))}
                      />
                    </div>
                    <div>
                      <p className={`text-xs ${t.muted}`}>Total Investments</p>
                      <EditableNumber
                        value={personal.totalInvestments}
                        onChange={(value) => setPersonal((prev) => ({ ...prev, totalInvestments: value }))}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            {activeTab === "household" && (
              <div className={`rounded-2xl p-5 ${t.panel}`}>
                <h3 className="mb-4 text-lg font-semibold">Household Members</h3>
                <div className="mb-6 grid gap-3 sm:grid-cols-4">
                  <input
                    placeholder="Name"
                    value={newMember.name}
                    onChange={(e) => setNewMember((p) => ({ ...p, name: e.target.value }))}
                    className={`rounded-lg px-3 py-2 ${t.input}`}
                  />
                  <select
                    value={newMember.role}
                    onChange={(e) => setNewMember((p) => ({ ...p, role: e.target.value }))}
                    className={`rounded-lg px-3 py-2 ${t.input}`}
                  >
                    <option>Partner</option>
                    <option>Dependent</option>
                    <option>Parent</option>
                  </select>
                  <EditableNumber
                    value={newMember.netWorth}
                    onChange={(v) => setNewMember((p) => ({ ...p, netWorth: v }))}
                    className="text-left"
                  />
                  <EditableNumber
                    value={newMember.monthlyIncome}
                    onChange={(v) => setNewMember((p) => ({ ...p, monthlyIncome: v }))}
                    className="text-left"
                  />
                </div>
                <button type="button" onClick={addMember} className={`mb-6 rounded-xl px-4 py-2 ${t.panelAlt}`}>
                  <UserPlus className="mr-2 inline h-4 w-4" /> Add Member
                </button>

                <div className="space-y-3">
                  {members.map((member) => (
                    <div key={member.id} className={`grid gap-3 rounded-xl p-4 sm:grid-cols-4 ${t.panelAlt}`}>
                      <div>
                        <p className="font-medium">{member.name}</p>
                        <p className={`text-xs ${t.muted}`}>{member.role}</p>
                      </div>
                      <EditableNumber
                        value={member.netWorth}
                        onChange={(value) =>
                          setMembers((prev) =>
                            prev.map((m) => (m.id === member.id ? { ...m, netWorth: value } : m))
                          )
                        }
                      />
                      <EditableNumber
                        value={member.monthlyIncome}
                        onChange={(value) =>
                          setMembers((prev) =>
                            prev.map((m) => (m.id === member.id ? { ...m, monthlyIncome: value } : m))
                          )
                        }
                      />
                      <button
                        type="button"
                        onClick={() => setMembers((prev) => prev.filter((m) => m.id !== member.id))}
                        className="rounded-lg border border-rose-400/40 px-3 py-1 text-rose-300"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <p className={`mt-4 text-sm ${t.muted}`}>
                  Total household monthly income: {formatMoney(householdMonthlyIncome)}
                </p>
              </div>
            )}

            {activeTab === "budget" && (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <SummaryCard title="Income (Actual)" value={totalIncome} subtitle="From income types" icon={DollarSign} />
                  <SummaryCard title="Expenses (Actual)" value={totalExpenses} subtitle="From expense types" icon={CreditCard} positive={false} />
                  <SummaryCard title="Net Summary" value={netSummary} subtitle="Income - Expenses" icon={CheckCircle2} positive={netSummary >= 0} />
                </div>

                <div className={`flex items-center justify-between rounded-2xl p-4 ${t.panel}`}>
                  <p className="font-medium">Budget Mode</p>
                  <button
                    type="button"
                    onClick={() => setPeriod((prev) => (prev === "monthly" ? "yearly" : "monthly"))}
                    className={`rounded-full px-4 py-1 text-sm ${t.panelAlt}`}
                  >
                    {period === "monthly" ? "Monthly" : "Yearly"}
                  </button>
                </div>

                <div className={`rounded-2xl p-5 ${t.panel}`}>
                  <SectionHeader
                    title={`Income Types (${formatMoney(incomeBudgetTotal * periodMultiplier)} budgeted)`}
                    expanded={incomeExpanded}
                    onToggle={() => setIncomeExpanded((prev) => !prev)}
                  />
                  {incomeExpanded && (
                    <div className="space-y-3">
                      {incomeCategories.map((row) => {
                        const budget = row.budget * periodMultiplier;
                        const actual = row.actual * periodMultiplier;
                        const pct = budget > 0 ? Math.min((actual / budget) * 100, 100) : 0;
                        return (
                          <div key={row.id} className={`rounded-xl p-3 ${t.panelAlt}`}>
                            <div className="grid gap-3 md:grid-cols-3">
                              <EditableText
                                value={row.name}
                                onChange={(value) => updateBudgetRow(setIncomeCategories, incomeCategories, row.id, "name", value)}
                              />
                              <EditableNumber
                                value={budget}
                                onChange={(value) =>
                                  updateBudgetRow(setIncomeCategories, incomeCategories, row.id, "budget", value)
                                }
                              />
                              <EditableNumber
                                value={actual}
                                onChange={(value) =>
                                  updateBudgetRow(setIncomeCategories, incomeCategories, row.id, "actual", value)
                                }
                              />
                            </div>
                            <div className="mt-2 h-2 rounded-full bg-white/10">
                              <div className="h-2 rounded-full bg-emerald-400" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                      <button type="button" className={`rounded-lg px-3 py-2 ${t.panelAlt}`} onClick={() => addBudgetCategory("income")}>
                        + Add Income Type
                      </button>
                    </div>
                  )}
                </div>

                <div className={`rounded-2xl p-5 ${t.panel}`}>
                  <SectionHeader
                    title={`Expense Types (${formatMoney(expenseBudgetTotal * periodMultiplier)} budgeted)`}
                    expanded={expenseExpanded}
                    onToggle={() => setExpenseExpanded((prev) => !prev)}
                  />
                  {expenseExpanded && (
                    <div className="space-y-3">
                      {expenseCategories.map((row) => {
                        const budget = row.budget * periodMultiplier;
                        const actual = row.actual * periodMultiplier;
                        const pct = budget > 0 ? Math.min((actual / budget) * 100, 100) : 0;
                        const over = actual > budget && budget > 0;
                        return (
                          <div key={row.id} className={`rounded-xl p-3 ${t.panelAlt}`}>
                            <div className="grid gap-3 md:grid-cols-3">
                              <EditableText
                                value={row.name}
                                onChange={(value) => updateBudgetRow(setExpenseCategories, expenseCategories, row.id, "name", value)}
                              />
                              <EditableNumber
                                value={budget}
                                onChange={(value) =>
                                  updateBudgetRow(setExpenseCategories, expenseCategories, row.id, "budget", value)
                                }
                              />
                              <EditableNumber
                                value={actual}
                                onChange={(value) =>
                                  updateBudgetRow(setExpenseCategories, expenseCategories, row.id, "actual", value)
                                }
                              />
                            </div>
                            <div className="mt-2 h-2 rounded-full bg-white/10">
                              <div
                                className={`h-2 rounded-full ${over ? "bg-rose-500" : "bg-cyan-400"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                      <button type="button" className={`rounded-lg px-3 py-2 ${t.panelAlt}`} onClick={() => addBudgetCategory("expense")}>
                        + Add Expense Type
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {activeTab === "accounts" && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {accounts.map((account) => (
                  <div key={account.id} className={`rounded-2xl p-4 ${t.panel}`}>
                    <div className="mb-3 flex items-center justify-between">
                      <p className="font-medium">{account.name}</p>
                      {account.type === "Credit" ? <CreditCard className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
                    </div>
                    <p className={`text-xs ${t.muted}`}>{account.type}</p>
                    <EditableNumber
                      value={account.balance}
                      onChange={(value) =>
                        setAccounts((prev) =>
                          prev.map((a) => (a.id === account.id ? { ...a, balance: value } : a))
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            )}

            {activeTab === "cashflow" && (
              <div className={`rounded-2xl p-5 ${t.panel}`}>
                <h3 className="mb-4 text-lg font-semibold">Income vs Expenses</h3>
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cashFlowData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                      <XAxis dataKey="name" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip />
                      <Bar dataKey="Income" fill="#22d3ee" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="Expenses" fill="#fb7185" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {activeTab === "investments" && (
              <div className={`rounded-2xl p-5 ${t.panel}`}>
                <h3 className="mb-4 text-lg font-semibold">Portfolio Growth</h3>
                <EditableNumber
                  value={personal.totalInvestments}
                  onChange={(value) => setPersonal((prev) => ({ ...prev, totalInvestments: value }))}
                />
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={investmentSeries}>
                      <defs>
                        <linearGradient id="invFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#67edff" stopOpacity={0.8} />
                          <stop offset="95%" stopColor="#67edff" stopOpacity={0.1} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                      <XAxis dataKey="month" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip />
                      <Area type="monotone" dataKey="value" stroke="#2de4ff" fillOpacity={1} fill="url(#invFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {activeTab === "goals" && (
              <div className={`rounded-2xl p-5 ${t.panel}`}>
                <h3 className="mb-4 text-lg font-semibold">Savings Goals</h3>
                <div className="mb-5 grid gap-3 sm:grid-cols-3">
                  <input
                    placeholder="Goal title"
                    value={newGoal.title}
                    onChange={(e) => setNewGoal((p) => ({ ...p, title: e.target.value }))}
                    className={`rounded-lg px-3 py-2 ${t.input}`}
                  />
                  <EditableNumber
                    value={newGoal.current}
                    onChange={(value) => setNewGoal((p) => ({ ...p, current: value }))}
                  />
                  <EditableNumber
                    value={newGoal.target}
                    onChange={(value) => setNewGoal((p) => ({ ...p, target: value }))}
                  />
                </div>
                <button type="button" onClick={addGoal} className={`mb-6 rounded-xl px-4 py-2 ${t.panelAlt}`}>
                  Add Goal
                </button>

                <div className="space-y-3">
                  {goals.map((goal) => {
                    const progress = goal.target > 0 ? Math.min((goal.current / goal.target) * 100, 100) : 0;
                    return (
                      <div key={goal.id} className={`rounded-xl p-3 ${t.panelAlt}`}>
                        <div className="mb-2 flex items-center justify-between">
                          <p className="font-medium">{goal.title}</p>
                          <p className={`text-sm ${t.muted}`}>
                            {formatMoney(goal.current)} / {formatMoney(goal.target)}
                          </p>
                        </div>
                        <div className="h-2 rounded-full bg-white/10">
                          <div className="h-2 rounded-full bg-emerald-400" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === "preferences" && (
              <div className={`grid gap-4 rounded-2xl p-5 ${t.panel}`}>
                <h3 className="text-lg font-semibold">Preferences & Theme Engine</h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { key: "light", label: "Light", icon: Sun },
                    { key: "dark", label: "Dark", icon: Moon },
                    { key: "cyber", label: "Cyber", icon: Smartphone },
                  ].map((mode) => {
                    const Icon = mode.icon;
                    return (
                      <button
                        key={mode.key}
                        type="button"
                        onClick={() => {
                          setTheme(mode.key);
                          addToast(`${mode.label} theme activated.`);
                        }}
                        className={`rounded-xl p-4 text-left ${theme === mode.key ? t.panelAlt : "border border-white/10"}`}
                      >
                        <Icon className="mb-2 h-4 w-4" />
                        <p className="font-medium">{mode.label}</p>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setPreferences((prev) => ({
                      ...prev,
                      pushNotifications: !prev.pushNotifications,
                    }))
                  }
                  className={`flex items-center justify-between rounded-xl p-3 ${t.panelAlt}`}
                >
                  <span className="flex items-center gap-2">
                    <Bell className="h-4 w-4" /> Push Notifications
                  </span>
                  <span>{preferences.pushNotifications ? "On" : "Off"}</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setPreferences((prev) => ({
                      ...prev,
                      biometricSecurity: !prev.biometricSecurity,
                    }))
                  }
                  className={`flex items-center justify-between rounded-xl p-3 ${t.panelAlt}`}
                >
                  <span className="flex items-center gap-2">
                    <Shield className="h-4 w-4" /> Biometric Security
                  </span>
                  <span>{preferences.biometricSecurity ? "Enabled" : "Disabled"}</span>
                </button>
              </div>
            )}
          </div>
        </main>
      </div>

      <nav className={`fixed bottom-0 left-0 right-0 z-30 flex border-t border-white/10 md:hidden ${t.nav}`}>
        {mobileTabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              type="button"
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 px-2 py-3 text-xs ${activeTab === tab.id ? t.accent : t.muted}`}
            >
              <Icon className="mx-auto mb-1 h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {isSyncModalOpen && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4">
          <div className={`w-full max-w-md rounded-2xl p-5 ${t.panel}`}>
            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-lg font-semibold">Secure Bank Sync</h4>
              <button type="button" onClick={() => setIsSyncModalOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className={`mb-3 text-sm ${t.muted}`}>Plaid-style encrypted handoff simulation.</p>
            <select
              value={selectedBank}
              onChange={(e) => setSelectedBank(e.target.value)}
              className={`mb-4 w-full rounded-lg px-3 py-2 ${t.input}`}
              disabled={syncState === "loading"}
            >
              <option>Chase</option>
              <option>Bank of America</option>
              <option>Wells Fargo</option>
              <option>Capital One</option>
            </select>
            <button
              type="button"
              onClick={startBankSync}
              disabled={syncState === "loading"}
              className={`w-full rounded-xl px-4 py-2 font-medium ${t.panelAlt}`}
            >
              {syncState === "loading"
                ? "Authenticating..."
                : syncState === "done"
                  ? "Synced"
                  : "Connect Securely"}
            </button>
          </div>
        </div>
      )}

      <div className="fixed right-4 top-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`rounded-lg px-4 py-2 text-sm ${
              toast.type === "error" ? "bg-rose-500/90" : "bg-emerald-500/90"
            } text-white shadow-lg`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}
