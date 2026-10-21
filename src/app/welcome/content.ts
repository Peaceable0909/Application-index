// All the words on /welcome live here, so they can be changed without touching the layout.
// Keep to things WhiteRock really does: no figures, no promises about results, no names of people.

/** The film is split into scenes. `from` is the first frame of the scene, `still` the frame shown when motion is switched off. */
export const BEATS = [
  { from: 0, still: 20, title: 'Start with a question', text: 'Ask about courses, entry requirements or how applying works. Our assistant answers, and a counsellor can join the chat.' },
  { from: 38, still: 50, title: 'Send your documents once', text: 'Add your passport and certificates to your student portal. We check them against the list for your university and show what is still missing.' },
  { from: 67, still: 92, title: 'Talk to a real person', text: 'Message your counsellor or jump on a voice or video call without leaving the portal. Interview slots are booked there too.' },
  { from: 102, still: 112, title: 'Hear the news in one place', text: 'Every application and offer is tracked in your portal, and you are notified as soon as something changes.' },
  { from: 142, still: 172, title: 'Then it is time to pack', text: 'Your documents, your offer and your counsellor stay together until you are on your way.' },
] as const;

/** Where the person is in the picture, as a share of its width (0 left, 1 right). Phones show a narrow slice of the film, so it follows her. */
export const FOCUS: [frame: number, x: number][] = [
  [0, 0.5], [30, 0.52], [40, 0.74], [52, 0.62], [64, 0.42], [80, 0.52], [90, 0.72], [102, 0.5], [130, 0.5], [142, 0.56], [155, 0.46], [182, 0.5],
];

export const FEATURES = [
  { icon: 'chat', title: 'Answers, not guesses', text: 'Ask about courses, entry requirements and applying. When we cannot confirm something we say so, instead of guessing.' },
  { icon: 'file', title: 'Documents without the chasing', text: 'Upload each document once. We check it against your university\'s list and show you exactly what is left to send.' },
  { icon: 'users', title: 'A counsellor who knows your file', text: 'Message, call or meet by video. Your counsellor sees your whole application, so you never explain it twice.' },
  { icon: 'trend', title: 'Your progress, always visible', text: 'See every application and offer in one place, and get a notification when something changes.' },
] as const;

/** Universities named on the page, per country workspace. A country without a list simply does not show the section. */
export const UNIVERSITIES: Record<string, { heading: string; names: string[] }> = {
  uk: { heading: 'Where our UK students apply', names: ['Regent College London', 'Canterbury Christ Church University', 'York St John University', 'BPP University'] },
};
