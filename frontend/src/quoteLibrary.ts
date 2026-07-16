// Curated, static content only. Ported from source quoteLibrary.js
const faith: [string, string, string][] = [
  ['Commit thy works unto the Lord, and thy thoughts shall be established.', 'Proverbs 16:3 · KJV', 'purpose'],
  ['But seek ye first the kingdom of God, and his righteousness.', 'Matthew 6:33 · KJV', 'priorities'],
  ['The Lord is my shepherd; I shall not want.', 'Psalm 23:1 · KJV', 'provision'],
  ['The blessing of the Lord, it maketh rich, and he addeth no sorrow with it.', 'Proverbs 10:22 · KJV', 'blessing'],
  ['A good man leaveth an inheritance to his children\u2019s children.', 'Proverbs 13:22 · KJV', 'legacy'],
  ['The plans of the diligent lead surely to abundance.', 'Proverbs 21:5 · KJV theme summary', 'diligence'],
  ['Honour the Lord with thy substance, and with the firstfruits of all thine increase.', 'Proverbs 3:9 · KJV', 'giving'],
  ['Moreover it is required in stewards, that a man be found faithful.', '1 Corinthians 4:2 · KJV', 'stewardship'],
  ['He that is faithful in that which is least is faithful also in much.', 'Luke 16:10 · KJV', 'faithfulness'],
  ['The hand of the diligent maketh rich.', 'Proverbs 10:4 · KJV', 'diligence'],
  ['There is treasure to be desired and oil in the dwelling of the wise.', 'Proverbs 21:20 · KJV', 'saving'],
  ['For where your treasure is, there will your heart be also.', 'Matthew 6:21 · KJV', 'priorities'],
  ['Owe no man any thing, but to love one another.', 'Romans 13:8 · KJV', 'debt'],
  ['Every man according as he purposeth in his heart, so let him give.', '2 Corinthians 9:7 · KJV', 'giving'],
  ['The liberal soul shall be made fat: and he that watereth shall be watered also himself.', 'Proverbs 11:25 · KJV', 'generosity'],
  ['If any of you lack wisdom, let him ask of God.', 'James 1:5 · KJV', 'wisdom'],
  ['Let all things be done decently and in order.', '1 Corinthians 14:40 · KJV', 'order'],
  ['Prepare thy work without, and make it fit for thyself in the field.', 'Proverbs 24:27 · KJV', 'planning'],
  ['The thoughts of the diligent tend only to plenteousness.', 'Proverbs 21:5 · KJV', 'planning'],
  ['In all labour there is profit.', 'Proverbs 14:23 · KJV', 'work'],
];

const motivation: string[] = [
  'A clear plan gives every dollar a purpose.','Small choices repeated consistently become financial freedom.',
  'Progress begins when intention becomes action.','You do not need perfection; you need a faithful next step.',
  'Your future is shaped by what you practice today.','A budget is permission to enjoy what matters without fear.',
  'Clarity turns money stress into informed decisions.','Consistency can accomplish what intensity cannot sustain.',
  'Every wise decision strengthens the life you are building.','Spend with purpose, save with vision, and live with peace.',
  'Your numbers are information, not a judgment of your worth.','A stronger financial life is built one honest check-in at a time.',
  'Protecting tomorrow starts with understanding today.','A small margin today can become a major opportunity tomorrow.',
  'Wealth grows where patience and purpose work together.','Give your goals a number and your numbers a plan.',
  'Confidence comes from knowing what your money is doing.','You can enjoy today and still prepare wisely for tomorrow.',
  'The best financial system is one you can live with consistently.','Your plan should support your life, not punish it.',
  'Financial peace grows when every commitment is visible.','A setback is data; use it to strengthen the next decision.',
  'Make room for generosity, growth, responsibility, and joy.','Your legacy is being shaped before it is ever measured.',
  'Do not underestimate the compound power of an ordinary month.','One protected dollar is one dollar still serving your future.',
  'A thoughtful pause can prevent an expensive impulse.','The goal is not restriction; the goal is alignment.',
  'Build a financial life that reflects what you value most.','Today\u2019s discipline can become tomorrow\u2019s flexibility.',
  'Your budget should tell the truth and still leave room for hope.','A plan creates options where uncertainty creates pressure.',
  'The next right decision matters more than the last wrong one.','Review, adjust, and keep moving forward.',
];

const focus: string[] = [
  'Know what came in, what went out, and what must happen next.','Give first, steward wisely, grow intentionally, and enjoy responsibly.',
  'Check the plan before you change the plan.','Separate available cash from money already committed to a goal.',
  'Review recurring expenses before adding new commitments.','Let your spending reflect your priorities, not only your impulses.',
  'Fund the future before the month finds another use for the money.','Measure progress with honest numbers and a patient perspective.',
  'Keep the categories simple enough to guide real decisions.','When income changes, update the plan before increasing lifestyle.',
  'Protect emergency savings by naming what it is reserved to do.','A monthly review prevents a yearly surprise.',
  'Use annual planning for direction and monthly planning for control.','Reconcile accounts regularly so your decisions use current information.',
  'Automate what matters, then review what changed.','Treat sinking funds as commitments, not spare checking cash.',
  'Give every income source a job before spending begins.','Track cash purchases so the budget reflects the whole story.',
  'Keep liabilities visible while celebrating asset growth.','Net worth is a direction to manage, not an identity to defend.',
];

export type QuoteType = 'Faith' | 'Motivation' | 'Both';
export interface Quote { id: string; type: QuoteType; quote: string; source: string; theme: string; }

export const quoteLibrary: Quote[] = [
  ...faith.map((item, i): Quote => ({ id: `faith-${i + 1}`, type: 'Faith', quote: item[0], source: item[1], theme: item[2] })),
  ...motivation.map((q, i): Quote => ({ id: `motivation-${i + 1}`, type: 'Motivation', quote: q, source: 'Jaleter Motivation Library', theme: 'motivation' })),
  ...focus.map((q, i): Quote => ({ id: `focus-${i + 1}`, type: 'Both', quote: q, source: 'Jaleter Focus Library', theme: 'focus' })),
];

export function dailyQuote(experience: QuoteType, date = new Date()): Quote {
  const allowed = experience === 'Both' ? quoteLibrary : quoteLibrary.filter(x => x.type === experience);
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  return allowed[Math.abs(day) % allowed.length];
}

export const MONEY = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
export const EXACT = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
