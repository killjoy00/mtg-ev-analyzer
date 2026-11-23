import { withAppTheme } from '@/src/appearance';
import { Text } from '@/src/components/Text';
import { ArticleScreen } from '@/src/components/ArticleScreen';
import { privacySections, resultsPolicyReleaseDate } from '@/src/nativeEditorial';

function PrivacyScreen() {
  return (
    <ArticleScreen
      kicker="Policy"
      title="Privacy"
      deck="A plain-English description of what Pack One stores on the website and in its mobile apps: analytics, optional accounts, memberships, commerce links, and third-party services."
      intro={<Text>Last updated: {resultsPolicyReleaseDate}</Text>}
      sections={privacySections}
    />
  );
}

export default withAppTheme(PrivacyScreen);
