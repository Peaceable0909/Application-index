// Everything on /welcome that is not layout: the words, when each panel shows, and where the film is "looking".
// Keep to things WhiteRock really does: no figures, no promises about results.

export type Panel = {
  id: string;
  /** Where the text sits on a wide screen: in the white space on that side of the picture. */
  side: 'left' | 'right';
  /** A frosted card low on the picture instead of bare text (for a part of the film with no white space, like the aircraft). */
  card?: boolean;
  /** The frame shown in place of the film when motion is switched off. */
  still: number;
  label?: string;
  title: string;
  text?: string;
  points?: string[];
  /** 'hero' and 'ready' carry the chat and sign-in buttons, 'ask' only the chat button. */
  cta?: 'hero' | 'ready' | 'ask';
  /** The universities line (per country, see UNIVERSITIES). */
  unis?: boolean;
  /** Short title and line pairs. */
  list?: { icon: string; title: string; text: string }[];
};

export const PANELS: Panel[] = [
  { id: 'hero', side: 'left', still: 6, label: 'WhiteRock Educational Services', title: 'Study abroad, one clear step at a time.', text: 'Ask your questions, send your documents and speak to a real counsellor. Everything for your application lives in one place.', cta: 'hero' },
  { id: 'docs', side: 'right', still: 64, label: 'Step 1', title: 'Send your documents once', text: 'Add your passport and certificates to your student portal. We check them against the list for your university and show you exactly what is still missing.', points: ['Upload from your phone or laptop', 'A clear list of what is left to send'] },
  { id: 'talk', side: 'right', still: 84, label: 'Step 2', title: 'Talk to a real person', text: 'Your counsellor sees your whole application, so you never explain it twice.', points: ['Chat, voice and video calls in the portal', 'Interview slots booked in the same place'] },
  { id: 'news', side: 'left', still: 108, label: 'Step 3', title: 'Hear the news in one place', text: 'Every application and offer is tracked in your portal, and you are notified as soon as something changes.' },
  { id: 'apply', side: 'right', still: 136, label: 'Where to study', title: 'Where our UK students apply', text: 'Ask the assistant about courses and entry requirements. When we cannot confirm something, we say so instead of guessing.', unis: true, cta: 'ask' },
  { id: 'pack', side: 'left', still: 158, label: 'Step 4', title: 'Then it is time to pack', text: 'Your documents, your offer and your counsellor stay together until you are on your way.' },
  {
    id: 'why', side: 'right', still: 162, title: 'Everything in one portal',
    list: [
      { icon: 'chat', title: 'Answers, not guesses', text: 'We say so when we cannot confirm something.' },
      { icon: 'file', title: 'Documents without the chasing', text: 'See exactly what is left to send.' },
      { icon: 'users', title: 'A counsellor who knows your file', text: 'You never explain it twice.' },
      { icon: 'trend', title: 'Your progress, always visible', text: 'Notified as soon as something changes.' },
    ],
  },
  { id: 'ready', side: 'left', card: true, still: 178, title: 'Ready when you are.', text: 'Say hello and tell us what you would like to study. There is nothing to fill in first.', cta: 'ready' },
];

/**
 * The film is not played at a steady speed: it slows down while a panel is being read and speeds through the parts where the
 * picture has no spare room. `vh` is how much scrolling (in screen heights x 100) the stretch takes, `frames` the film frames it covers.
 */
export const TIMELINE: { vh: number; frames: [number, number]; panels: string[] }[] = [
  { vh: 18, frames: [0, 0], panels: ['hero'] },
  { vh: 100, frames: [0, 20], panels: ['hero'] },
  { vh: 45, frames: [20, 57], panels: [] },
  { vh: 95, frames: [57, 72], panels: ['docs'] },
  { vh: 95, frames: [72, 89], panels: ['talk'] },
  { vh: 25, frames: [89, 99], panels: [] },
  { vh: 100, frames: [99, 118], panels: ['news'] },
  { vh: 35, frames: [118, 132], panels: [] },
  { vh: 85, frames: [132, 140], panels: ['apply'] },
  { vh: 30, frames: [140, 150], panels: [] },
  { vh: 110, frames: [150, 166], panels: ['pack', 'why'] },
  { vh: 20, frames: [166, 172], panels: [] },
  { vh: 100, frames: [172, 182], panels: ['ready'] },
];

/** How far the picture slides sideways (as a share of the screen width; + moves it right) to open more white space for the text. Worked out from the pictures themselves. */
export const CAMERA: [frame: number, shift: number][] = [
  [0, 0.105], [3, 0.11], [6, 0.114], [9, 0.116], [12, 0.121], [15, 0.126], [18, 0.129], [21, 0.124], [24, 0.105], [27, 0.068], [30, 0.068], [33, 0.006], [36, 0.006], [39, 0],
  [42, -0.031], [45, -0.05], [48, -0.068], [51, -0.073], [54, -0.105], [57, -0.124], [60, -0.13], [63, -0.13], [66, -0.13], [69, -0.13], [72, -0.13], [75, -0.13], [78, -0.13], [81, -0.13], [84, -0.118], [87, -0.08], [90, -0.017], [93, -0.026], [96, -0.005],
  [99, 0.021], [102, 0.053], [105, 0.074], [108, 0.074], [111, 0.079], [114, 0.094], [117, 0.085], [120, 0.059], [123, 0.027], [126, 0.002],
  [129, -0.006], [132, -0.072], [135, -0.109], [138, -0.121], [141, -0.056], [144, -0.084], [147, -0.074], [150, -0.056], [153, -0.037], [156, -0.019], [159, 0],
];

/** Where the person is in the picture, as a share of its width (0 left, 1 right). A phone shows a narrow slice of the film, so it follows her. */
export const FOCUS: [frame: number, x: number][] = [
  [0, 0.5], [30, 0.52], [40, 0.74], [52, 0.62], [64, 0.42], [80, 0.52], [90, 0.72], [102, 0.5], [130, 0.5], [142, 0.56], [155, 0.46], [182, 0.5],
];

/** Universities named on the page, per country workspace. A country without a list simply does not show them. */
export const UNIVERSITIES: Record<string, string[]> = {
  uk: ['Regent College London', 'Canterbury Christ Church University', 'York St John University', 'BPP University'],
};
