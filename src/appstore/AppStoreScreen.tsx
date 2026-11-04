import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Project } from '../project/store';
import { colors, fonts, radii, type } from '../theme';
import { useWideLayout } from '../theme/layout';
import { search, type Listing } from './catalog';
import { Screenshot, StoreIcon } from './Screenshot';
import * as shotImages from './shotImages';

type Props = {
  apiKey: string;
  projects: Project[];
  // An agent turn is running; installing stops it.
  running: boolean;
  // Back to Your apps.
  onHome: () => void;
  onInstall: (listing: Listing) => Promise<void>;
  onOpenProject: (id: string) => void;
};

const TRENDING = [
  'habit tracker',
  'a calculator with feelings',
  'plant care',
  'games for one thumb',
  'budget for chaotic people',
  'focus timer',
  'apps for my cat',
  'recipe roulette',
];

const QUIPS = [
  'Hiring indie developers…',
  'Writing five-star reviews…',
  'Drawing the screenshots…',
  'Picking a tasteful gradient…',
  'Inventing a release history…',
  'Arguing about the icon…',
];

// Survives closing the store, so coming back shows the last search.
let lastSearch: { query: string; results: Listing[] } | null = null;

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'results'; results: Listing[] };

export function AppStoreScreen({
  apiKey,
  projects,
  running,
  onHome,
  onInstall,
  onOpenProject,
}: Props) {
  const insets = useSafeAreaInsets();
  const wide = useWideLayout();
  const [query, setQuery] = React.useState(lastSearch?.query ?? '');
  const [status, setStatus] = React.useState<Status>(() =>
    lastSearch ? { kind: 'results', results: lastSearch.results } : { kind: 'idle' },
  );
  const [selected, setSelected] = React.useState<Listing | null>(null);
  const [installing, setInstalling] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const runSearch = React.useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (!q) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setQuery(q);
      setSelected(null);
      setStatus({ kind: 'loading' });
      try {
        const results = await search(apiKey, q, ctrl.signal);
        if (ctrl.signal.aborted) return;
        lastSearch = { query: q, results };
        setStatus({ kind: 'results', results });
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setStatus({ kind: 'error', message: (e as Error)?.message ?? 'Something went wrong.' });
      }
    },
    [apiKey],
  );

  React.useEffect(() => () => abortRef.current?.abort(), []);

  // Real screenshots: the first of each result, then the rest of an opened
  // listing. Cached, so going back and forth costs nothing more.
  const results = status.kind === 'results' ? status.results : null;
  React.useEffect(() => {
    for (const l of results ?? []) shotImages.request(apiKey, l, 0);
  }, [apiKey, results]);
  React.useEffect(() => {
    if (selected) selected.screens.forEach((_, i) => shotImages.request(apiKey, selected, i));
  }, [apiKey, selected]);

  const installedId = (l: Listing) =>
    projects.find((p) => p.name.toLowerCase() === l.name.toLowerCase())?.id ?? null;

  const get = async (l: Listing) => {
    if (installing) return;
    const existing = installedId(l);
    if (existing) return onOpenProject(existing);
    setInstalling(l.id);
    try {
      await onInstall(l);
    } finally {
      setInstalling(null);
    }
  };

  const getProps = (l: Listing) => ({
    installed: !!installedId(l),
    busy: installing === l.id,
    disabled: !!installing && installing !== l.id,
    onPress: () => get(l),
  });

  const back = () => (selected ? setSelected(null) : onHome());

  return (
    <View style={[styles.root, { paddingTop: insets.top + 6 }]}>
      <View style={[styles.header, wide && styles.column]}>
        <Pressable
          onPress={back}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={selected ? 'Back to results' : 'Your apps'}
        >
          <Ionicons name={selected ? 'chevron-back' : 'home-outline'} size={20} color={colors.dust} />
        </Pressable>
        {selected ? (
          <Text style={styles.headerName} numberOfLines={1}>
            {selected.name}
          </Text>
        ) : (
          <View style={styles.searchBox}>
            <Ionicons name="search" size={17} color={colors.dust} />
            <TextInput
              keyboardAppearance="dark"
              value={query}
              onChangeText={setQuery}
              placeholder="Search for any app, real or not"
              placeholderTextColor={colors.dust}
              style={styles.searchInput}
              returnKeyType="search"
              onSubmitEditing={() => runSearch(query)}
              autoCorrect={false}
              accessibilityLabel="Search the App Store"
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={17} color={colors.dust} />
              </Pressable>
            ) : null}
          </View>
        )}
      </View>

      {selected ? (
        <Detail listing={selected} get={getProps(selected)} stopsBuild={running} wide={wide} bottom={insets.bottom} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.body, wide && styles.column, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
        >
          {status.kind === 'idle' ? (
            <Idle onPick={runSearch} />
          ) : status.kind === 'loading' ? (
            <Loading />
          ) : status.kind === 'error' ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>The store is having a moment</Text>
              <Text style={styles.errorBody}>{status.message}</Text>
              <Pressable
                onPress={() => runSearch(query)}
                style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={type.sectionLabel}>
                {status.results.length} results for “{lastSearch?.query ?? query}”
              </Text>
              {status.results.map((l) => (
                <ResultRow key={l.id} listing={l} onOpen={() => setSelected(l)} get={getProps(l)} />
              ))}
              <Pressable
                onPress={() => runSearch(query)}
                style={({ pressed }) => [styles.more, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Ionicons name="shuffle" size={16} color={colors.chalkSoft} />
                <Text style={styles.moreText}>Dream up different apps</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// The App Store's own icon on Your apps and in the dock.
export function StoreAppIcon({ size = 72 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), overflow: 'hidden' }}>
      <LinearGradient
        colors={[colors.accent, colors.danger]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
      >
        <Ionicons name="bag-handle" size={Math.round(size * 0.46)} color={colors.slate} />
      </LinearGradient>
    </View>
  );
}

type GetProps = { installed: boolean; busy: boolean; disabled: boolean; onPress: () => void };

function GetButton({ installed, busy, disabled, onPress, big }: GetProps & { big?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || disabled}
      style={({ pressed }) => [
        styles.get,
        big && styles.getBig,
        installed && styles.getOpen,
        (pressed || disabled) && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={installed ? 'Open' : 'Get'}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.slate} />
      ) : (
        <Text style={[styles.getText, big && styles.getTextBig, installed && styles.getTextOpen]}>
          {installed ? 'OPEN' : 'GET'}
        </Text>
      )}
    </Pressable>
  );
}

function ResultRow({ listing: l, onOpen, get }: { listing: Listing; onOpen: () => void; get: GetProps }) {
  // GET sits beside the tappable area, not inside it: web can't nest buttons.
  return (
    <View style={styles.result}>
      <View style={styles.resultHead}>
        <Pressable
          onPress={onOpen}
          style={({ pressed }) => [styles.resultOpen, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`${l.name}, ${l.tagline}`}
        >
          <StoreIcon listing={l} size={60} />
          <View style={styles.resultText}>
            <Text style={styles.resultName} numberOfLines={1}>
              {l.name}
            </Text>
            <Text style={styles.resultTagline} numberOfLines={2}>
              {l.tagline}
            </Text>
            <Stars rating={l.rating} count={l.ratings} />
          </View>
        </Pressable>
        <GetButton {...get} />
      </View>
      {l.screens.length ? (
        <Pressable
          onPress={onOpen}
          style={({ pressed }) => [styles.resultShots, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`${l.name} screenshots`}
        >
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.resultShot}>
              {l.screens[i] ? <ShotFill listing={l} index={i} /> : null}
            </View>
          ))}
        </Pressable>
      ) : null}
    </View>
  );
}

const SHOT_WIDTH = 196;

// A screenshot as wide as its parent (results thumbnails).
function ShotFill({ listing, index }: { listing: Listing; index: number }) {
  const [w, setW] = React.useState(0);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={styles.shotFill}>
      {w ? <Screenshot screen={listing.screens[index]} listing={listing} index={index} width={w} /> : null}
    </View>
  );
}

function Stars({ rating, count }: { rating: number; count?: number }) {
  return (
    <View style={styles.stars} accessibilityLabel={`${rating} stars${count === undefined ? '' : ` from ${count} ratings`}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons
          key={i}
          name={rating >= i - 0.25 ? 'star' : rating >= i - 0.75 ? 'star-half' : 'star-outline'}
          size={11}
          color={colors.dust}
        />
      ))}
      {count === undefined ? null : <Text style={styles.starsCount}>{compact(count)}</Text>}
    </View>
  );
}

function Detail({
  listing: l,
  get,
  stopsBuild,
  wide,
  bottom,
}: {
  listing: Listing;
  get: GetProps;
  stopsBuild: boolean;
  wide: boolean;
  bottom: number;
}) {
  const shotWidth = wide ? 220 : SHOT_WIDTH;
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: bottom + 40 }}>
      <View style={[styles.detailHead, wide && styles.column]}>
        <StoreIcon listing={l} size={108} />
        <View style={styles.detailHeadText}>
          <Text style={styles.detailName} numberOfLines={2}>
            {l.name}
          </Text>
          <Text style={styles.detailTagline} numberOfLines={2}>
            {l.tagline}
          </Text>
          <Text style={styles.detailDev} numberOfLines={1}>
            {l.developer}
          </Text>
          <View style={styles.detailGetRow}>
            <GetButton {...get} big />
          </View>
        </View>
      </View>
      {get.busy ? (
        <Text style={[styles.note, wide && styles.column]}>
          Finishing the screenshots. The agent gets them as the design to build from.
        </Text>
      ) : null}
      {stopsBuild && !get.installed ? (
        <Text style={[styles.note, wide && styles.column]}>Getting an app stops the build that's running.</Text>
      ) : null}

      <View style={[styles.stats, wide && styles.column]}>
        <Stat top={`${compact(l.ratings)} RATINGS`} big={l.rating.toFixed(1)} bottom={<Stars rating={l.rating} />} />
        <Stat top="AGE" big={l.ageRating} bottom="Years old" />
        <Stat top="CATEGORY" big={<Ionicons name="grid-outline" size={20} color={colors.chalkSoft} />} bottom={l.category} />
        <Stat top="SIZE" big="0 KB" bottom="for now" last />
      </View>

      {l.screens.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.shots, wide && styles.shotsWide]}
          snapToInterval={shotWidth + 12}
          decelerationRate="fast"
        >
          {l.screens.map((s, i) => (
            <Screenshot key={i} screen={s} listing={l} index={i} width={shotWidth} />
          ))}
        </ScrollView>
      ) : null}

      <View style={[styles.section, wide && styles.column]}>
        {l.description.split(/\n\n+/).map((para, i) => (
          <Text key={i} style={styles.para}>
            {para}
          </Text>
        ))}
      </View>

      {l.features.length ? (
        <View style={[styles.section, wide && styles.column]}>
          <Text style={styles.sectionTitle}>Features</Text>
          {l.features.map((f, i) => (
            <View key={i} style={styles.feature}>
              <Ionicons name="checkmark-circle" size={16} color={l.palette.accent} />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {l.whatsNew ? (
        <View style={[styles.section, wide && styles.column]}>
          <Text style={styles.sectionTitle}>What's New</Text>
          <Text style={styles.versionLine}>Version 1.0 · built fresh on your phone</Text>
          <Text style={styles.para}>{l.whatsNew}</Text>
        </View>
      ) : null}

      {l.reviews.length ? (
        <View style={[styles.section, wide && styles.column]}>
          <Text style={styles.sectionTitle}>Ratings & Reviews</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.reviews}>
            {l.reviews.map((r, i) => (
              <View key={i} style={styles.review}>
                <View style={styles.reviewHead}>
                  <Text style={styles.reviewTitle} numberOfLines={1}>
                    {r.title || '★'.repeat(r.stars)}
                  </Text>
                  <Text style={styles.reviewAuthor} numberOfLines={1}>
                    {r.author}
                  </Text>
                </View>
                <View style={styles.stars}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Ionicons key={s} name={r.stars >= s ? 'star' : 'star-outline'} size={11} color={colors.accent} />
                  ))}
                </View>
                <Text style={styles.reviewBody} numberOfLines={5}>
                  {r.body}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <Text style={[styles.footer, wide && styles.column]}>
        This app doesn't exist yet. Tap Get and the agent builds it on this device, from this listing.
      </Text>
    </ScrollView>
  );
}

function Stat({
  top,
  big,
  bottom,
  last,
}: {
  top: string;
  big: React.ReactNode;
  bottom: React.ReactNode;
  last?: boolean;
}) {
  return (
    <View style={[styles.stat, !last && styles.statDivider]}>
      <Text style={styles.statTop} numberOfLines={1}>
        {top}
      </Text>
      {typeof big === 'string' ? <Text style={styles.statBig}>{big}</Text> : <View style={styles.statBigBox}>{big}</View>}
      {typeof bottom === 'string' ? (
        <Text style={styles.statBottom} numberOfLines={1}>
          {bottom}
        </Text>
      ) : (
        bottom
      )}
    </View>
  );
}

function Idle({ onPick }: { onPick: (q: string) => void }) {
  return (
    <View style={styles.idle}>
      <View style={styles.idleHero}>
        <Text style={styles.idleTitle}>Every app is in stock.</Text>
        <Text style={styles.idleBody}>
          Search for anything. The store dreams up apps to match, and the one you Get is built on this
          device while you watch.
        </Text>
      </View>
      <Text style={type.sectionLabel}>Trending searches</Text>
      <View style={styles.trending}>
        {TRENDING.map((t) => (
          <Pressable
            key={t}
            onPress={() => onPick(t)}
            style={({ pressed }) => [styles.trendRow, pressed && styles.resultPressed]}
            accessibilityRole="button"
          >
            <Ionicons name="search" size={15} color={colors.dust} />
            <Text style={styles.trendText}>{t}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Loading() {
  const [i, setI] = React.useState(0);
  const pulse = React.useRef(new Animated.Value(0.5)).current;
  React.useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % QUIPS.length), 1600);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => {
      clearInterval(t);
      loop.stop();
    };
  }, [pulse]);
  return (
    <View style={styles.loading}>
      <Text style={styles.quip}>{QUIPS[i]}</Text>
      {[0, 1, 2, 3].map((k) => (
        <Animated.View key={k} style={[styles.skeleton, { opacity: pulse }]}>
          <View style={styles.skelIcon} />
          <View style={styles.skelLines}>
            <View style={[styles.skelLine, { width: '55%' }]} />
            <View style={[styles.skelLine, { width: '80%' }]} />
          </View>
          <View style={styles.skelGet} />
        </Animated.View>
      ))}
    </View>
  );
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.slate },
  pressed: { opacity: 0.7 },
  // Desktop: a readable column rather than edge to edge.
  column: { alignSelf: 'center', width: '100%', maxWidth: 720 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  headerName: { flex: 1, ...type.header, color: colors.chalk },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.board,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.board,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    color: colors.chalk,
    fontFamily: fonts.body,
    fontSize: 15,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },

  body: { paddingHorizontal: 16, gap: 14, paddingTop: 6 },

  idle: { gap: 16 },
  idleHero: {
    padding: 20,
    gap: 8,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.board,
  },
  idleTitle: { ...type.screenTitle, color: colors.chalk },
  idleBody: { ...type.body, color: colors.chalkMuted },
  trending: { borderRadius: radii.card, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  trendText: { fontFamily: fonts.body, fontSize: 15, color: colors.accent },

  loading: { gap: 12 },
  quip: { fontFamily: fonts.mono, fontSize: 12, color: colors.dust, marginBottom: 4 },
  skeleton: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  skelIcon: { width: 60, height: 60, borderRadius: 14, backgroundColor: colors.raised },
  skelLines: { flex: 1, gap: 8 },
  skelLine: { height: 10, borderRadius: 5, backgroundColor: colors.raised },
  skelGet: { width: 64, height: 30, borderRadius: 15, backgroundColor: colors.raised },

  errorBox: {
    padding: 20,
    gap: 8,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerBg,
  },
  errorTitle: { fontFamily: fonts.displaySemi, fontSize: 18, color: colors.chalk },
  errorBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.dangerSoft },
  retry: {
    alignSelf: 'flex-start',
    height: 40,
    paddingHorizontal: 16,
    marginTop: 6,
    borderRadius: radii.input,
    backgroundColor: colors.accent,
    justifyContent: 'center',
  },
  retryText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.slate },

  result: {
    gap: 12,
    padding: 14,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.board,
  },
  resultPressed: { backgroundColor: colors.raised },
  resultHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  resultOpen: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  resultText: { flex: 1, minWidth: 0, gap: 3 },
  resultName: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.chalk },
  resultTagline: { fontFamily: fonts.body, fontSize: 13, lineHeight: 17, color: colors.dust },
  resultShots: { flexDirection: 'row', gap: 8 },
  resultShot: { flex: 1 },
  shotFill: { aspectRatio: 1 / shotImages.SHOT_RATIO },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  starsCount: { fontFamily: fonts.body, fontSize: 11, color: colors.dust, marginLeft: 4 },

  get: {
    minWidth: 72,
    height: 32,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  getBig: { height: 36, minWidth: 96, borderRadius: 18 },
  getOpen: { backgroundColor: colors.raised },
  getText: { fontFamily: fonts.bodySemi, fontSize: 14, letterSpacing: 0.4, color: colors.slate },
  getTextBig: { fontSize: 15 },
  getTextOpen: { color: colors.accent },

  more: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: radii.button,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.lineFaint,
  },
  moreText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.chalkSoft },

  detailHead: { flexDirection: 'row', gap: 16, paddingHorizontal: 20, paddingTop: 8 },
  detailHeadText: { flex: 1, minWidth: 0, gap: 3 },
  detailName: { fontFamily: fonts.display, fontSize: 24, lineHeight: 27, letterSpacing: -0.4, color: colors.chalk },
  detailTagline: { fontFamily: fonts.body, fontSize: 14, color: colors.chalkMuted },
  detailDev: { fontFamily: fonts.body, fontSize: 13, color: colors.dust },
  detailGetRow: { flexDirection: 'row', marginTop: 8 },
  note: { fontFamily: fonts.body, fontSize: 12, color: colors.dust, paddingHorizontal: 20, paddingTop: 10 },

  stats: {
    flexDirection: 'row',
    marginTop: 20,
    marginHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  stat: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  statDivider: { borderRightWidth: 1, borderRightColor: colors.line },
  statTop: { fontFamily: fonts.bodySemi, fontSize: 9, letterSpacing: 0.6, color: colors.dust },
  statBig: { fontFamily: fonts.display, fontSize: 20, color: colors.chalkSoft },
  statBigBox: { height: 26, justifyContent: 'center' },
  statBottom: { fontFamily: fonts.body, fontSize: 11, color: colors.dust },

  shots: { gap: 12, paddingHorizontal: 20, paddingTop: 20 },
  shotsWide: { paddingHorizontal: 24 },

  section: { paddingHorizontal: 20, paddingTop: 24, gap: 10 },
  sectionTitle: { fontFamily: fonts.displaySemi, fontSize: 20, color: colors.chalk },
  para: { ...type.body, color: colors.chalkSoft },
  versionLine: { fontFamily: fonts.body, fontSize: 12, color: colors.dust, marginTop: -4 },
  feature: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  featureText: { flex: 1, ...type.body, color: colors.chalkSoft },

  reviews: { gap: 12 },
  review: {
    width: 270,
    padding: 14,
    gap: 6,
    borderRadius: radii.card,
    backgroundColor: colors.board,
    borderWidth: 1,
    borderColor: colors.line,
  },
  reviewHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  reviewTitle: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 14, color: colors.chalk },
  reviewAuthor: { maxWidth: 100, fontFamily: fonts.body, fontSize: 12, color: colors.dust },
  reviewBody: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.chalkMuted },

  footer: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.dust,
    textAlign: 'center',
    paddingHorizontal: 32,
    paddingTop: 32,
  },
});
