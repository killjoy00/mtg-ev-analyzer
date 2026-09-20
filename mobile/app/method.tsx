import { ArticleScreen, type ArticleSection } from '@/src/components/ArticleScreen';

const sections: ArticleSection[] = [
  {
    title: 'Real packs and earlier picks.',
    body: [
      'Pack One builds eight-pick runs from 17Lands public archives. Each decision uses a different source draft and its original pool. Your answers do not rewrite another historical state.',
    ],
  },
  {
    title: 'All seven-win Premier finishes count.',
    body: [
      '7-0, 7-1, and 7-2 are trophies. Drafters also meet the established experience and quality standard: at least 100 prior games and the per-set high-quality cohort. Older archives without win-rate fields retain their documented rank qualification.',
    ],
  },
  {
    title: 'Model evidence supports partial credit.',
    body: [
      'The model learns from a broader qualified cohort, not only trophies, and excludes a puzzle’s source draft from its own grading evidence. Card preferences, pick position, and earlier pool context inform support.',
      'Probability and score calibration are separate. The exact trophy pick always earns 100; alternatives receive at most 95.',
    ],
  },
  {
    title: 'Published corpus, fixed Daily.',
    body: [
      'Only Live eligible sets enter new games. Ingestion validates sources, trajectories, metadata, images, model evidence, and accounting; an admin explicitly publishes a ready set. Older sets remain in the corpus.',
      'A generated Daily keeps its decisions and versions after later serving-status changes.',
    ],
  },
  {
    title: 'Cube’s missing opening packs.',
    body: [
      'The public Cube archive lacks complete first-pick packs. Its eight decisions therefore use Picks 2–9 with the actual first card visible. Missing packs are never invented.',
    ],
  },
  {
    title: 'Qualified Traditional trophies add variety.',
    body: [
      'Some 3-0 Traditional trophy drafts are also used when their picks meet Pack One’s publication requirements. Each published decision must pass trajectory, metadata, image, and puzzle-quality checks.',
      'The scoring model remains trained on Premier draft data; Traditional drafts supply eligible puzzle decisions, not model-training evidence.',
    ],
  },
  {
    title: 'Provenance and limits.',
    body: [
      'Public 17Lands datasets are licensed under CC BY 4.0. Pack One adapts them into puzzles, statistics, and model evidence. Metadata and images come from Scryfall; card rights remain with their owners. No endorsement is implied.',
      'Archives are recorded samples, not every draft played, and model support is not proof of the best pick.',
    ],
  },
];

export default function MethodScreen() {
  return (
    <ArticleScreen
      kicker="Model notes"
      title="Methodology"
      deck="Real trophy trajectories, qualified drafters, and held-out model evidence."
      sections={sections}
    />
  );
}
