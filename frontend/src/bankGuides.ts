/**
 * Step-by-step CSV/OFX export guides for major US banks.
 * Shared between AccountLinkSheet (import flow) and SupportSheet (bank help center).
 */
export type BankImportGuide = {
  name: string;
  steps: string[];
  format: string;
};

export const BANK_IMPORT_GUIDES: BankImportGuide[] = [
  {
    name: 'Chase',
    steps: [
      'Sign in at chase.com from a browser.',
      'Open the account you want to export.',
      'Click the download arrow icon (top right of transactions list).',
      'Choose the date range, then select "Spreadsheet (Excel, CSV)".',
      'Save the file, then import it in Jaleter.',
    ],
    format: 'CSV',
  },
  {
    name: 'Bank of America',
    steps: [
      'Log in at bankofamerica.com.',
      'Open the account, then click "Download".',
      'Choose "Microsoft Excel" or "Comma-delimited (CSV)".',
      'Select a date range and download.',
      'Upload the file into Jaleter.',
    ],
    format: 'CSV',
  },
  {
    name: 'Wells Fargo',
    steps: [
      'Sign in at wellsfargo.com.',
      'Open the account and go to "Download Account Activity".',
      'Choose date range and "Comma Delimited" format.',
      'Save and import into Jaleter.',
    ],
    format: 'CSV',
  },
  {
    name: 'Capital One',
    steps: [
      'Sign in at capitalone.com.',
      'Open your account, click the three-dot menu next to Transactions.',
      'Choose "Download transactions".',
      'Pick a date range and CSV format.',
      'Import into Jaleter.',
    ],
    format: 'CSV',
  },
  {
    name: 'Citi',
    steps: [
      'Sign in at citi.com.',
      'Choose the account and open "Statements".',
      'Click "Download activity" and choose CSV.',
      'Select date range and save.',
      'Import into Jaleter.',
    ],
    format: 'CSV',
  },
  {
    name: 'US Bank',
    steps: [
      'Log in at usbank.com.',
      'Open the account, click "Manage" then "Export transactions".',
      'Choose Excel/CSV.',
      'Save the export and upload it in Jaleter.',
    ],
    format: 'CSV',
  },
  {
    name: 'PNC',
    steps: [
      'Log in at pnc.com.',
      'Open the account and click "Activity".',
      'Click the download icon and choose CSV.',
      'Select date range and save.',
      'Import into Jaleter.',
    ],
    format: 'CSV',
  },
  {
    name: 'Discover Card',
    steps: [
      'Log in at discover.com.',
      'Go to "Account Details" then "Download activity".',
      'Choose CSV format and date range.',
      'Save the file and import it in Jaleter.',
    ],
    format: 'CSV',
  },
  {
    name: 'American Express',
    steps: [
      'Sign in at americanexpress.com.',
      'Open Statements & Activity.',
      'Click "Download".',
      'Pick "CSV" (or Excel), choose a date range.',
      'Save and import in Jaleter.',
    ],
    format: 'CSV',
  },
  {
    name: 'Ally Bank',
    steps: [
      'Sign in at ally.com.',
      'Choose the account, click "Download".',
      'Pick CSV (or OFX/QFX for Quicken).',
      'Save and upload it in Jaleter.',
    ],
    format: 'CSV / OFX / QFX',
  },
  {
    name: 'Credit Union / Other',
    steps: [
      'Log in to your credit union or bank on a browser.',
      'Look for "Download", "Export", or a download-arrow icon on the transactions/statements page.',
      'Choose CSV (preferred), OFX, QFX, or QBO — Jaleter supports all four.',
      'Save the file and upload it in Jaleter.',
      'If your bank has no export at all, use "Request an institution" to let us know.',
    ],
    format: 'CSV / OFX / QFX / QBO',
  },
];
