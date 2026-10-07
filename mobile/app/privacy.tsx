import { ArticleScreen } from '@/src/components/ArticleScreen';
import { privacySections } from '@/src/nativeEditorial';

export default function PrivacyScreen() {
  return (
    <ArticleScreen
      kicker="Policy"
      title="Privacy"
      deck="A plain-English description of what Pack One stores on the website and in the iPhone, iPad and Android apps: analytics, optional accounts, memberships, commerce links, and third-party services."
      sections={privacySections}
    />
  );
}
