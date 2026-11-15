// Plain ASCII sentences without quotes, so every keyboard and phone types them the same way.
const SENTENCES = [
  "A small boat drifted past the harbor lights as the night grew quiet and cold.",
  "Every morning the baker opens the shop early and fills the street with warm bread.",
  "The old map showed a path through the forest that nobody had walked in years.",
  "Bright kites danced above the beach while children raced along the wet sand.",
  "She packed a notebook, two pencils, and an apple before the long train ride.",
  "Thunder rolled across the valley, and the farmers hurried to bring in the hay.",
  "Learning to type quickly takes patience, steady hands, and a lot of practice.",
  "The robot paused at the crossing, checked both ways, and rolled on to the park.",
  "Seven green frogs sat on a log and sang until the moon rose over the pond.",
  "A good team shares ideas, listens closely, and celebrates every small win.",
  "The library smelled of dust and paper, and the clock ticked softly on the wall.",
  "Fresh snow covered the rooftops, and the whole town seemed to hold its breath.",
];

/** Random sentence, never the same as the previous one in this room. */
export function pickSentence(previous: string | null): string {
  const options = SENTENCES.filter((s) => s !== previous);
  return options[Math.floor(Math.random() * options.length)];
}
