// Pure helpers shared by the server and the browser (no server-only imports here).
// ---------- scoring bands ----------
export const BANDS = [
  { min: 90, max: 100, label: 'Excellent', tone: 'excellent' },
  { min: 75, max: 89, label: 'Very Good', tone: 'verygood' },
  { min: 60, max: 74, label: 'Good', tone: 'good' },
  { min: 40, max: 59, label: 'Needs Improvement', tone: 'improve' },
  { min: 0, max: 39, label: 'Needs Significant Improvement', tone: 'poor' },
] as const;
export const bandFor = (score: number) => BANDS.find((b) => score >= b.min) || BANDS[BANDS.length - 1];

export const CATEGORIES = ['course', 'university', 'uk', 'career', 'finance', 'background', 'combined', 'general'] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<string, string> = { course: 'Course & modules', university: 'The university', uk: 'Why the UK', career: 'Career plans', finance: 'Finance & funding', background: 'Background & history', combined: 'The big picture', general: 'General' };

export const CRITERIA = [
  { key: 'relevance', label: 'Answers the question', weight: 20 },
  { key: 'specificity', label: 'Specific detail', weight: 15 },
  { key: 'reasoning', label: 'Clear reasons', weight: 10 },
  { key: 'naturalVoice', label: 'Natural and personal', weight: 10 },
  { key: 'courseKnowledge', label: 'Course and module knowledge', weight: 15 },
  { key: 'institutionKnowledge', label: 'Knowledge of the university', weight: 10 },
  { key: 'careerCoherence', label: 'Career plan fits', weight: 10 },
  { key: 'financeKnowledge', label: 'Funding knowledge', weight: 15 },
  { key: 'consistency', label: 'Matches your application', weight: 10 },
] as const;
export type CriterionKey = (typeof CRITERIA)[number]['key'];
export type Criteria = Partial<Record<CriterionKey, number | null>>;


export type Stats = {
  attempts: number; completed: number; totalQuestions: number; average: number | null; best: number | null; latest: number | null;
  trend: { at: string; score: number }[]; weak: { key: CriterionKey; label: string; avg: number }[];
  byQuestion: Record<string, { n: number; best: number; last: number; lastAt: string }>;
};

export type Question = { id: string; position: number; question: string; category: string; guidance: string | null; model_answer: string | null; active: boolean };

/** The training is for applicants to Regent College London (matched on the university name, e.g. "Regent College London (RCL)"). */
export const isRegentCollege = (school: string | null | undefined) => /regent|\brcl\b/i.test(school || '');
export const regentApp = <T extends { school: string | null }>(apps: T[]): T | undefined => apps.find((a) => isRegentCollege(a.school));
