// Public-facing editorial rules only. No personal emails, private writing
// samples, or attribution of invented experiences to the owner.
export const LAB_STYLE_VERSION='lab-plain-v1';
export const LAB_STYLE_GUIDE=[
  'Write like an experienced Magic player talking to another player. Put the specific card, decision or surprising result in the first sentence. Use ordinary words, contractions and concrete reasons.',
  'Spend words where the finding earns them. Follow a surprising observation with a relevant second check when possible, then say what it suggests for a real draft or why it remains inconclusive. A self-contained short note is fine. No required introduction, subheading, summary, lesson or final question. Vary rhythm and structure; use short sentences when they fit.',
  'No sales pitch, inflated adjectives, stock transitions, fake suspense, formulaic contrast, abstract "insight" language or generic advice. Never tell the reader that a finding is interesting instead of showing it. Cut sentences that merely repeat a chart or could describe any set.',
  'Use an independent voice: no authorial we/our/us, invented owner opinions, personal anecdotes, or simulated play experience. Natural dry humor is welcome only when it genuinely fits; never manufacture personality.',
  'Use the provided stat placeholders for specific numbers in normal sentences. No unverified numerical claims. State the finding plainly, explain only what the evidence supports and finish when the point is made. Keep the essential scope and caveat; leave technical details to the research note.',
  'Do not use em dashes as prose punctuation. Avoid rhetorical questions unless there is a genuine unanswered drafting question. At most one question in the body. Use simple headings only when helpful.'
].join('\n');
const prohibited=[
  ['stock-transition',/\b(?:here(?:'|’)s (?:the thing|where it gets interesting|what makes this interesting|why (?:it|that) matters)|let(?:'|’)s (?:dive in|unpack|take a closer look)|it(?:'|’)s worth noting|it is worth noting|at the end of the day|in today(?:'|’)s|when it comes to|the numbers tell a story|the data tells a story|in the world of|the real question is|the takeaway is|this serves as a reminder)\b/i],
  ['formulaic-contrast',/\b(?:it|this|that)(?:'|’)s not (?:just|about)\b[^.!?]{1,180}\b(?:it(?:'|’)s|this is|but rather|it is)\b/i],
  ['hype',/\b(?:game[- ]changer|unlock(?:s|ing)? the (?:power|potential)|a testament to|a masterclass in|a fascinating glimpse|a powerful reminder|a compelling reminder|the beauty of)\b/i],
  ['generic-heading',/^(?:what this means(?: for (?:you|your draft))?|the takeaway|why (?:this|it) matters|key takeaways?|the bottom line|the big picture|final thoughts|conclusion|a closer look|a deeper dive)[\s:.!?]*$/i],
  ['em-dash',/—/u]
];
export function plainStyleIssue(text,{heading=false}={}){
  if(typeof text!=='string')return 'invalid-prose';
  for(const [name,regex] of prohibited){
    if(name==='generic-heading'&&!heading)continue;
    if(regex.test(text.trim()))return name;
  }
  return null;
}
