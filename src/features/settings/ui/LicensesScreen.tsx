import React, { useMemo, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { YStack, XStack, Card, Text, Paragraph, Button, Input } from 'tamagui';
import { Screen, HIT_SLOP, monoFontFamily } from '@/shared/ui';
import { LICENSES_URL } from '@/shared/lib/appInfo';
import { logError } from '@/shared/state/errorLogStore';
import { formatNumber } from '@/shared/lib/format';
import { useTranslation } from '@/shared/i18n';
import {
  THIRD_PARTY_LICENSES,
  filterPackages,
  licenceSummary,
  packageKey,
  type LicenseData,
  type LicensedPackage,
} from '../model/licenses';

/** Entries rendered at first and added by each **Show more** (the list has ~700 packages). */
export const LICENSES_PAGE = 40;

function PackageRow({
  pkg,
  data,
  open,
  onToggle,
}: {
  pkg: LicensedPackage;
  data: LicenseData;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation('settings');
  const text = pkg.text ? data.texts[pkg.text] : null;
  return (
    <Card bordered padding="$3" backgroundColor="$backgroundHover">
      <YStack
        gap="$1"
        onPress={onToggle}
        hitSlop={HIT_SLOP}
        accessible
        role="button"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('licenses.rowA11y', {
          name: pkg.name,
          version: pkg.version,
          license: pkg.license,
        })}
        testID={`license-${packageKey(pkg)}`}
      >
        <XStack justifyContent="space-between" gap="$2" alignItems="center">
          <Text fontWeight="700" fontSize="$3" flexShrink={1}>
            {pkg.name}
          </Text>
          <Text theme="alt2" fontSize="$2">
            {pkg.license}
          </Text>
        </XStack>
        <Text theme="alt2" fontSize="$1">
          {pkg.version}
        </Text>
      </YStack>
      {open ? (
        <YStack gap="$2" marginTop="$2">
          {pkg.copyright.map((line) => (
            <Paragraph key={line} fontSize="$2" selectable>
              {line}
            </Paragraph>
          ))}
          {pkg.repository ? (
            <Paragraph theme="alt2" fontSize="$1" selectable>
              {pkg.repository}
            </Paragraph>
          ) : null}
          {text ? (
            <Text fontFamily={monoFontFamily(Platform.OS)} fontSize="$1" selectable>
              {text}
            </Text>
          ) : (
            <Paragraph theme="alt2" fontSize="$1">
              {t('licenses.noText', { license: pkg.license })}
            </Paragraph>
          )}
        </YStack>
      ) : null}
    </Card>
  );
}

/** **Licences** (`/licenses`, plan 30): the third-party notices for every package the app ships
 *  with — a per-licence summary, a filter, and each package's copyright lines and licence text on
 *  tap. Opened from Settings → About. */
export function LicensesScreen({ data = THIRD_PARTY_LICENSES }: { data?: LicenseData } = {}) {
  const { t } = useTranslation('settings');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(LICENSES_PAGE);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const summary = useMemo(() => licenceSummary(data), [data]);
  const matches = useMemo(() => filterPackages(data, query), [data, query]);
  const shown = matches.slice(0, limit);

  return (
    <Screen title={t('licenses.title')}>
      <Paragraph fontSize="$3">{t('licenses.intro', { count: data.packages.length })}</Paragraph>
      <Paragraph theme="alt2" fontSize="$2" testID="licenses-summary">
        {summary.map((s) => `${s.license} ${formatNumber(s.count, 0)}`).join(' · ')}
      </Paragraph>
      <Input
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          setLimit(LICENSES_PAGE);
        }}
        placeholder={t('licenses.filterPlaceholder')}
        accessibilityLabel={t('licenses.filterA11y')}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {matches.length === 0 ? (
        <Paragraph theme="alt2" fontSize="$2">
          {t('licenses.noMatch')}
        </Paragraph>
      ) : null}
      <YStack gap="$2">
        {shown.map((pkg) => {
          const key = packageKey(pkg);
          return (
            <PackageRow
              key={key}
              pkg={pkg}
              data={data}
              open={openKey === key}
              onToggle={() => setOpenKey((k) => (k === key ? null : key))}
            />
          );
        })}
      </YStack>
      {matches.length > shown.length ? (
        <Button size="$3" hitSlop={HIT_SLOP} onPress={() => setLimit((n) => n + LICENSES_PAGE)}>
          {t('licenses.showMore', { count: matches.length - shown.length })}
        </Button>
      ) : null}
      <Button
        size="$3"
        hitSlop={HIT_SLOP}
        accessibilityLabel={t('licenses.onlineA11y')}
        onPress={() =>
          Linking.openURL(LICENSES_URL).catch((e: unknown) =>
            logError({ source: 'settings/licenses', error: e, severity: 'warning' }),
          )
        }
      >
        {t('licenses.online')}
      </Button>
    </Screen>
  );
}
