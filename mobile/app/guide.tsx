import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { ArticleScreen, articleStyles, type ArticleSection } from '@/src/components/ArticleScreen';
import { learningGuide } from '@/src/content/learning';

export default function GuideScreen() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = typeof params.slug === 'string' ? params.slug : '';
  const guide = learningGuide(slug);

  if (!guide) {
    return (
      <ArticleScreen
        kicker="Learn"
        title="Guide unavailable"
        deck="This Pack One guide link is not available."
        sections={[]}
        footer={(
          <Pressable accessibilityRole="button" onPress={() => router.replace('/learn')} style={articleStyles.linkCard}>
            <Text style={articleStyles.linkAction}>Back to Learn →</Text>
          </Pressable>
        )}
      />
    );
  }

  const sections: ArticleSection[] = guide.sections.map((section) => ({
    title: section.title,
    body: section.body,
    extra: section.callout ? (
      <View style={articleStyles.callout}>
        <Text style={articleStyles.calloutBody}>{section.callout}</Text>
      </View>
    ) : undefined,
  }));

  return (
    <ArticleScreen
      kicker="Limited study"
      title={guide.title}
      deck={guide.deck}
      sections={sections}
      footer={(
        <View style={articleStyles.callout}>
          <Text style={articleStyles.calloutTitle}>Put it into practice</Text>
          <Text style={articleStyles.calloutBody}>Make the decision before you read the answer.</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/practice')}>
            <Text style={articleStyles.linkAction}>Open Practice →</Text>
          </Pressable>
        </View>
      )}
    />
  );
}
