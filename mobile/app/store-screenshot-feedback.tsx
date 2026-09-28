import { Redirect } from 'expo-router';

import { config } from '@/src/config';

import DraftRunScreen from './draft-run';

export default function StoreScreenshotFeedbackScreen() {
  if (!config.screenshots.fixtures) return <Redirect href="/" />;
  return <DraftRunScreen screenshotFeedback />;
}
