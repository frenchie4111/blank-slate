import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import {
  FONTS,
  iconName,
  type Backdrop,
  type Block,
  type Corners,
  type FontStyle,
  type Listing,
  type Palette,
  type Screen,
} from './catalog';
import { SHOT_RATIO, useShot } from './shotImages';

// Screenshots are laid out at this width and scaled to whatever they're shown
// at, so a thumbnail is the same picture as the full-size one.
const BASE = 196;
const RATIO = SHOT_RATIO;

// Some faces run large or small for their point size.
const DISPLAY_SCALE: Partial<Record<FontStyle, number>> = {
  pixel: 0.55,
  hand: 1.3,
  condensed: 1.2,
  editorial: 1.15,
};

type Look = {
  p: Palette;
  display: string;
  body: string;
  // Display font size for a nominal size.
  ds: (n: number) => number;
  // Corner radius for a nominal radius.
  r: (n: number) => number;
};

function lookOf(l: Listing): Look {
  const f = FONTS[l.look.font];
  const k = DISPLAY_SCALE[l.look.font] ?? 1;
  const c: Record<Corners, number> = { sharp: 0.2, soft: 1, round: 1.9 };
  const rc = c[l.look.corners];
  return {
    p: l.palette,
    display: f.display,
    body: f.body,
    ds: (n) => Math.round(n * k * 10) / 10,
    r: (n) => Math.min(n * rc, 24),
  };
}

// ---- icon -------------------------------------------------------------------

export function StoreIcon({ listing, size = 64 }: { listing: Listing; size?: number }) {
  const { accent, bg, surface, text } = listing.palette;
  const look = lookOf(listing);
  const box = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.24),
    overflow: 'hidden' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };
  const glyph = (filled: boolean) => iconName(listing.icon, 'sparkles', filled);
  switch (listing.look.iconStyle) {
    case 'flat':
      return (
        <View style={[box, { backgroundColor: bg }]}>
          <Ionicons name={glyph(true)} size={Math.round(size * 0.52)} color={accent} />
        </View>
      );
    case 'outline':
      return (
        <View style={[box, { backgroundColor: surface }]}>
          <View
            style={{
              width: size * 0.66,
              height: size * 0.66,
              borderRadius: size,
              borderWidth: Math.max(2, size * 0.04),
              borderColor: accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={glyph(false)} size={Math.round(size * 0.36)} color={text} />
          </View>
        </View>
      );
    case 'letter':
      return (
        <View style={[box, { backgroundColor: accent }]}>
          <Text
            style={{
              fontFamily: look.display,
              fontSize: look.ds(size * 0.56),
              color: bg,
              includeFontPadding: false,
            }}
          >
            {listing.name.trim().charAt(0).toUpperCase()}
          </Text>
        </View>
      );
    case 'sticker':
      return (
        <View style={[box, { backgroundColor: bg }]}>
          <View
            style={{
              position: 'absolute',
              width: size * 0.9,
              height: size * 0.9,
              borderRadius: size,
              backgroundColor: accent,
              right: -size * 0.22,
              bottom: -size * 0.22,
            }}
          />
          <View style={{ transform: [{ rotate: '-10deg' }] }}>
            <Ionicons name={glyph(true)} size={Math.round(size * 0.5)} color={text} />
          </View>
        </View>
      );
    default:
      return (
        <View style={[box, { backgroundColor: accent }]}>
          <LinearGradient
            colors={['rgba(255,255,255,0.35)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0.18)']}
            style={StyleSheet.absoluteFill}
          />
          <Ionicons name={glyph(true)} size={Math.round(size * 0.5)} color={bg} />
        </View>
      );
  }
}

// ---- screenshot ---------------------------------------------------------------

/**
 * A marketing screenshot. The image model's version when one has been made
 * (shotImages.ts); until then, and if it fails, a drawing: a caption and
 * backdrop around the screen, all from the listing.
 */
export function Screenshot({
  screen,
  listing,
  index,
  width,
}: {
  screen: Screen;
  listing: Listing;
  index: number;
  width: number;
}) {
  const scale = width / BASE;
  const shot = useShot(listing, index);
  const height = Math.round(width * RATIO);
  return (
    <View style={{ width, height, overflow: 'hidden', borderRadius: 18 * scale }}>
      {shot?.status === 'ready' ? (
        <Image source={{ uri: shot.uri }} style={{ width, height }} resizeMode="cover" accessibilityLabel={screen.caption} />
      ) : (
        <View style={{ width: BASE, height: BASE * RATIO, transformOrigin: 'top left', transform: [{ scale }] }}>
          <Composition screen={screen} look={lookOf(listing)} />
        </View>
      )}
      {shot?.status === 'loading' ? (
        <View style={[styles.painting, { transform: [{ scale: Math.min(1, scale * 1.4) }] }]}>
          <ActivityIndicator size="small" color="#FFFFFF" />
        </View>
      ) : null}
    </View>
  );
}

function Composition({ screen, look }: { screen: Screen; look: Look }) {
  const { p } = look;
  const backColor = backdropColor(screen.backdrop, p);
  const captionColor = readableOn(backColor, p);
  const caption = (align: 'center' | 'left', size = 17) => (
    <Text
      style={{
        fontFamily: look.display,
        fontSize: look.ds(size),
        lineHeight: look.ds(size) * 1.12,
        letterSpacing: -0.2,
        textAlign: align,
        color: captionColor,
      }}
      numberOfLines={3}
    >
      {screen.caption}
    </Text>
  );

  if (screen.layout === 'bleed') {
    // No device: the screen fills the shot, with the caption as a sticker.
    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: p.bg }]}>
        <ScreenBody screen={screen} look={look} topPad={14} />
        <View style={[styles.sticker, { backgroundColor: p.accent, borderRadius: look.r(14) }]}>
          <Text
            style={{
              fontFamily: look.display,
              fontSize: look.ds(15),
              lineHeight: look.ds(15) * 1.15,
              color: readableOn(p.accent, p),
              textAlign: 'center',
            }}
            numberOfLines={3}
          >
            {screen.caption}
          </Text>
        </View>
      </View>
    );
  }

  const phone = (style: object) => (
    <View style={[styles.phone, { backgroundColor: p.bg, borderColor: '#0A0A0C' }, style]}>
      <ScreenBody screen={screen} look={look} topPad={0} />
    </View>
  );

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: backColor }]}>
      <BackdropArt kind={screen.backdrop} p={p} />
      {screen.layout === 'bottom' ? (
        <>
          {phone({ position: 'absolute', top: -26, left: '8%', right: '8%', height: 270, ...radiusBottom(24) })}
          <View style={styles.captionBottom}>{caption('center', 18)}</View>
        </>
      ) : screen.layout === 'tilt' ? (
        <>
          <View style={styles.captionTop}>{caption('center')}</View>
          {phone({
            position: 'absolute',
            top: 92,
            left: '14%',
            width: '80%',
            height: 360,
            transform: [{ rotate: '-8deg' }],
            ...radiusAll(24),
          })}
        </>
      ) : screen.layout === 'zoom' ? (
        <>
          <View style={[styles.captionTop, { alignItems: 'flex-start', paddingRight: 30 }]}>
            {caption('left', 22)}
          </View>
          {phone({
            position: 'absolute',
            top: 120,
            left: 44,
            width: 200,
            height: 420,
            ...radiusAll(28),
          })}
        </>
      ) : (
        <>
          <View style={styles.captionTop}>{caption('center')}</View>
          {phone({ position: 'absolute', top: 76, left: '8%', right: '8%', bottom: -30, ...radiusAll(24) })}
        </>
      )}
    </View>
  );
}

function BackdropArt({ kind, p }: { kind: Backdrop; p: Palette }) {
  switch (kind) {
    case 'gradient':
      return (
        <LinearGradient
          colors={[p.accent, mix(p.accent, p.bg, 0.55)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      );
    case 'dots':
      return (
        <View style={[StyleSheet.absoluteFill, styles.dots]} pointerEvents="none">
          {Array.from({ length: 60 }, (_, i) => (
            <View key={i} style={[styles.dot, { backgroundColor: p.bg, opacity: 0.16 }]} />
          ))}
        </View>
      );
    case 'stripes':
      return (
        <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} pointerEvents="none">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: -120 + i * 70,
                top: -40,
                width: 26,
                height: 600,
                backgroundColor: p.bg,
                opacity: 0.1,
                transform: [{ rotate: '24deg' }],
              }}
            />
          ))}
        </View>
      );
    case 'blob':
      return (
        <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} pointerEvents="none">
          <View style={[styles.blob, { backgroundColor: p.accent, top: -60, left: -70 }]} />
          <View
            style={[styles.blob, { backgroundColor: p.accent, opacity: 0.5, bottom: -40, right: -90, width: 220, height: 220 }]}
          />
        </View>
      );
    default:
      return null;
  }
}

// ---- the screen itself --------------------------------------------------------

function ScreenBody({ screen, look, topPad }: { screen: Screen; look: Look; topPad: number }) {
  const { p } = look;
  return (
    <View style={{ flex: 1, paddingTop: topPad }}>
      <View style={styles.statusBar}>
        <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 8, color: p.text }}>9:41</Text>
        <View style={styles.island} />
        <Ionicons name="battery-full" size={10} color={p.text} />
      </View>
      {screen.header === 'large' ? (
        <Text
          style={{ fontFamily: look.display, fontSize: look.ds(17), color: p.text, marginTop: 6, marginBottom: 8, paddingHorizontal: 10 }}
          numberOfLines={1}
        >
          {screen.title}
        </Text>
      ) : screen.header === 'center' ? (
        <View style={styles.navBar}>
          <Ionicons name="chevron-back" size={12} color={p.accent} />
          <Text
            style={{ flex: 1, textAlign: 'center', fontFamily: look.display, fontSize: look.ds(10.5), color: p.text }}
            numberOfLines={1}
          >
            {screen.title}
          </Text>
          <Ionicons name="ellipsis-horizontal" size={12} color={p.accent} />
        </View>
      ) : (
        <View style={{ height: 8 }} />
      )}
      <View style={styles.blocks}>
        {screen.blocks.map((b, i) => (
          <BlockView key={i} block={b} look={look} />
        ))}
      </View>
      {screen.tabs.length ? (
        <View style={[styles.tabs, { backgroundColor: p.surface }]}>
          {screen.tabs.map((t, i) => (
            <Ionicons
              key={i}
              name={iconName(t, 'ellipse', i === 0)}
              size={13}
              color={i === 0 ? p.accent : p.text}
              style={i === 0 ? null : { opacity: 0.45 }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function BlockView({ block: b, look }: { block: Block; look: Look }) {
  const { p, r } = look;
  const body = (size: number, extra?: TextStyle): TextStyle => ({ fontFamily: look.body, fontSize: size, color: p.text, ...extra });
  const display = (size: number, extra?: TextStyle): TextStyle => ({
    fontFamily: look.display,
    fontSize: look.ds(size),
    color: p.text,
    ...extra,
  });
  const muted = { opacity: 0.6 };
  const onAccent = readableOn(p.accent, p);

  switch (b.t) {
    case 'hero':
      return (
        <View style={styles.center}>
          <Text style={display(26, { color: p.accent, textAlign: 'center', letterSpacing: -0.5 })} numberOfLines={2}>
            {b.text}
          </Text>
          {b.sub ? (
            <Text style={[body(8.5), muted]} numberOfLines={1}>
              {b.sub}
            </Text>
          ) : null}
        </View>
      );
    case 'row':
      return (
        <View style={[styles.row, { backgroundColor: p.surface, borderRadius: r(8) }]}>
          <View style={[styles.rowIcon, { backgroundColor: p.accent, borderRadius: r(5) }]}>
            <Ionicons name={iconName(b.icon, 'ellipse')} size={9} color={onAccent} />
          </View>
          <View style={styles.flex}>
            <Text style={body(8.5, { fontWeight: '600' })} numberOfLines={1}>
              {b.text}
            </Text>
            {b.sub ? (
              <Text style={[body(7), muted]} numberOfLines={1}>
                {b.sub}
              </Text>
            ) : null}
          </View>
        </View>
      );
    case 'card':
      return (
        <View style={{ padding: 8, gap: 2, borderRadius: r(10), backgroundColor: p.surface }}>
          <Text style={display(10.5)} numberOfLines={1}>
            {b.text}
          </Text>
          {b.sub ? (
            <Text style={[body(7.5), muted]} numberOfLines={3}>
              {b.sub}
            </Text>
          ) : null}
        </View>
      );
    case 'chips':
      return (
        <View style={styles.wrap}>
          {b.items.map((c, i) => (
            <View
              key={i}
              style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: r(8), backgroundColor: i === 0 ? p.accent : p.surface }}
            >
              <Text style={body(7.5, { color: i === 0 ? onAccent : p.text })} numberOfLines={1}>
                {c}
              </Text>
            </View>
          ))}
        </View>
      );
    case 'segment':
      return (
        <View style={{ flexDirection: 'row', padding: 2, borderRadius: r(9), backgroundColor: p.surface }}>
          {b.items.map((c, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 4,
                borderRadius: r(7),
                backgroundColor: i === b.selected ? p.accent : 'transparent',
              }}
            >
              <Text style={body(7.5, { color: i === b.selected ? onAccent : p.text })} numberOfLines={1}>
                {c}
              </Text>
            </View>
          ))}
        </View>
      );
    case 'bars': {
      const max = Math.max(1, ...b.values);
      return (
        <View style={[styles.bars, { backgroundColor: p.surface, borderRadius: r(10) }]}>
          {b.values.map((v, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: `${Math.max(6, (v / max) * 100)}%`,
                borderRadius: r(3),
                backgroundColor: p.accent,
                opacity: i === b.values.length - 1 ? 1 : 0.55,
              }}
            />
          ))}
        </View>
      );
    }
    case 'progress':
      return (
        <View style={{ gap: 3 }}>
          {b.text ? (
            <Text style={[body(7.5), muted]} numberOfLines={1}>
              {b.text}
            </Text>
          ) : null}
          <View style={{ height: 7, borderRadius: r(4), overflow: 'hidden', backgroundColor: p.surface }}>
            <View style={{ height: '100%', width: `${b.value * 100}%`, borderRadius: r(4), backgroundColor: p.accent }} />
          </View>
        </View>
      );
    case 'ring': {
      const size = 92;
      const stroke = 9;
      const rad = (size - stroke) / 2;
      const circ = 2 * Math.PI * rad;
      return (
        <View style={[styles.center, { paddingVertical: 4 }]}>
          <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
              <Circle cx={size / 2} cy={size / 2} r={rad} stroke={p.surface} strokeWidth={stroke} fill="none" />
              <Circle
                cx={size / 2}
                cy={size / 2}
                r={rad}
                stroke={p.accent}
                strokeWidth={stroke}
                fill="none"
                strokeLinecap={look.r(10) < 4 ? 'butt' : 'round'}
                strokeDasharray={`${circ * b.value} ${circ}`}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            </Svg>
            <Text style={display(17, { color: p.text })} numberOfLines={1}>
              {b.text}
            </Text>
          </View>
          {b.sub ? (
            <Text style={[body(8), muted]} numberOfLines={1}>
              {b.sub}
            </Text>
          ) : null}
        </View>
      );
    }
    case 'stats':
      return (
        <View style={{ flexDirection: 'row', gap: 5 }}>
          {b.items.map((s, i) => (
            <View key={i} style={{ flex: 1, padding: 6, gap: 1, borderRadius: r(9), backgroundColor: p.surface }}>
              <Text style={display(15, { color: i === 0 ? p.accent : p.text })} numberOfLines={1}>
                {s.value}
              </Text>
              <Text style={[body(6.5), muted]} numberOfLines={1}>
                {s.label}
              </Text>
            </View>
          ))}
        </View>
      );
    case 'calendar': {
      const marked = new Set(b.marked);
      return (
        <View style={{ padding: 6, gap: 3, borderRadius: r(10), backgroundColor: p.surface }}>
          <Text style={display(9.5)} numberOfLines={1}>
            {b.month}
          </Text>
          <View style={styles.calGrid}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <Text key={`h${i}`} style={[body(5.5, { width: '14.28%', textAlign: 'center' }), muted]}>
                {d}
              </Text>
            ))}
            {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
              <View key={d} style={styles.calCell}>
                <View
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: r(7),
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: marked.has(d) ? p.accent : 'transparent',
                  }}
                >
                  <Text style={body(6, { color: marked.has(d) ? onAccent : p.text })}>{d}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      );
    }
    case 'chat':
      return (
        <View style={{ gap: 4 }}>
          {b.messages.map((m, i) => (
            <View
              key={i}
              style={{
                alignSelf: m.me ? 'flex-end' : 'flex-start',
                maxWidth: '78%',
                paddingHorizontal: 7,
                paddingVertical: 5,
                borderRadius: r(10),
                backgroundColor: m.me ? p.accent : p.surface,
              }}
            >
              <Text style={body(7.5, { color: m.me ? onAccent : p.text })} numberOfLines={3}>
                {m.text}
              </Text>
            </View>
          ))}
        </View>
      );
    case 'photos':
      return (
        <View style={styles.wrapTight}>
          {b.icons.map((ic, i) => (
            <View key={i} style={{ width: '31.5%', aspectRatio: 1, borderRadius: r(6), overflow: 'hidden' }}>
              <LinearGradient
                colors={[mix(p.accent, p.bg, (i % 3) * 0.25), mix(p.surface, p.accent, 0.2 + (i % 2) * 0.3)]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[StyleSheet.absoluteFill, styles.centerFill]}
              >
                <Ionicons name={iconName(ic, 'image', true)} size={16} color={p.bg} style={{ opacity: 0.55 }} />
              </LinearGradient>
            </View>
          ))}
        </View>
      );
    case 'map': {
      const spots = [
        [22, 30],
        [62, 18],
        [45, 58],
        [78, 64],
        [15, 72],
        [70, 40],
      ];
      return (
        <View style={{ height: 120, borderRadius: r(10), overflow: 'hidden', backgroundColor: p.surface }}>
          <View style={[styles.park, { backgroundColor: p.accent }]} />
          {[
            { top: 40, rotate: '-12deg' },
            { top: 82, rotate: '6deg' },
          ].map((road, i) => (
            <View
              key={i}
              style={{ position: 'absolute', left: -20, right: -20, top: road.top, height: 5, backgroundColor: p.bg, transform: [{ rotate: road.rotate }] }}
            />
          ))}
          <View style={{ position: 'absolute', top: -10, bottom: -10, left: '58%', width: 4, backgroundColor: p.bg, transform: [{ rotate: '14deg' }] }} />
          {spots.slice(0, b.pins).map(([x, y], i) => (
            <View key={i} style={{ position: 'absolute', left: `${x}%`, top: `${y}%` }}>
              <Ionicons name="location" size={i === 0 ? 18 : 13} color={i === 0 ? p.accent : p.text} />
            </View>
          ))}
          {b.label ? (
            <View style={[styles.mapLabel, { backgroundColor: p.bg, borderRadius: r(8) }]}>
              <Text style={body(7.5, { fontWeight: '600' })} numberOfLines={1}>
                {b.label}
              </Text>
            </View>
          ) : null}
        </View>
      );
    }
    case 'toggles':
      return (
        <View style={{ borderRadius: r(10), overflow: 'hidden', backgroundColor: p.surface }}>
          {b.items.map((t, i) => (
            <View key={i} style={[styles.toggleRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.bg }]}>
              <Text style={body(8, { flex: 1 })} numberOfLines={1}>
                {t.text}
              </Text>
              <View
                style={{
                  width: 22,
                  height: 13,
                  padding: 1.5,
                  borderRadius: r(7),
                  backgroundColor: t.on ? p.accent : p.bg,
                  alignItems: t.on ? 'flex-end' : 'flex-start',
                }}
              >
                <View style={{ width: 10, height: 10, borderRadius: r(5), backgroundColor: t.on ? onAccent : p.text }} />
              </View>
            </View>
          ))}
        </View>
      );
    case 'art':
      return (
        <View style={[styles.center, { paddingVertical: 8, gap: 6 }]}>
          <View style={{ width: 104, height: 104, alignItems: 'center', justifyContent: 'center' }}>
            <View style={[styles.artBlob, { backgroundColor: p.accent, borderRadius: r(30) + 22 }]} />
            <View style={[styles.artBlob, { backgroundColor: p.accent, opacity: 0.18, transform: [{ scale: 1.25 }, { rotate: '20deg' }], borderRadius: r(30) + 22 }]} />
            <Ionicons name={iconName(b.icon, 'sparkles', true)} size={50} color={onAccent} />
          </View>
          {b.text ? (
            <Text style={display(11, { textAlign: 'center' })} numberOfLines={2}>
              {b.text}
            </Text>
          ) : null}
        </View>
      );
    case 'board': {
      const cells = b.cells.split('');
      return (
        <View style={{ padding: 4, borderRadius: r(8), backgroundColor: p.surface }}>
          <View style={styles.wrapBoard}>
            {cells.map((c, i) => (
              <View key={i} style={{ width: `${100 / b.cols}%`, aspectRatio: 1, padding: 1.5 }}>
                <View
                  style={{
                    flex: 1,
                    borderRadius: r(3),
                    backgroundColor: c === '#' ? p.text : p.bg,
                    opacity: c === '#' ? 0.75 : 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {c === 'x' || c === 'o' ? (
                    <View
                      style={{
                        width: '66%',
                        height: '66%',
                        borderRadius: r(20),
                        backgroundColor: c === 'x' ? p.accent : p.text,
                      }}
                    />
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </View>
      );
    }
    case 'keypad':
      return (
        <View style={styles.wrapTight}>
          {b.keys.map((k, i) => {
            const last = i === b.keys.length - 1;
            return (
              <View
                key={i}
                style={{
                  width: '23%',
                  height: 24,
                  borderRadius: r(8),
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: last ? p.accent : p.surface,
                }}
              >
                <Text style={display(11, { color: last ? onAccent : p.text })}>{k}</Text>
              </View>
            );
          })}
        </View>
      );
    case 'quote':
      return (
        <View style={{ paddingVertical: 4, paddingHorizontal: 2, gap: 3 }}>
          <Text style={display(30, { color: p.accent, lineHeight: look.ds(28), height: look.ds(18) })}>“</Text>
          <Text style={display(13, { lineHeight: look.ds(13) * 1.25 })} numberOfLines={4}>
            {b.text}
          </Text>
          {b.by ? (
            <Text style={[body(7.5), muted]} numberOfLines={1}>
              — {b.by}
            </Text>
          ) : null}
        </View>
      );
    case 'grid':
      return (
        <View style={styles.wrapTight}>
          {b.icons.map((ic, i) => (
            <View
              key={i}
              style={{ width: '23%', aspectRatio: 1, borderRadius: r(8), alignItems: 'center', justifyContent: 'center', backgroundColor: p.surface }}
            >
              <Ionicons name={iconName(ic)} size={14} color={p.accent} />
            </View>
          ))}
        </View>
      );
    case 'button':
      return (
        <View style={{ height: 26, marginTop: 2, borderRadius: r(9), alignItems: 'center', justifyContent: 'center', backgroundColor: p.accent }}>
          <Text style={display(9.5, { color: onAccent })} numberOfLines={1}>
            {b.text}
          </Text>
        </View>
      );
  }
}

// ---- colour helpers --------------------------------------------------------------

function rgb(h: string): [number, number, number] {
  let s = h.replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(h: string): number {
  const [r, g, b] = rgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Whichever of the palette's bg and text reads better on `color`. */
function readableOn(color: string, p: Palette): string {
  const best = contrast(color, p.bg) >= contrast(color, p.text) ? p.bg : p.text;
  if (contrast(color, best) >= 3) return best;
  return luminance(color) > 0.4 ? '#111111' : '#FFFFFF';
}

/** a blended toward b by t (0..1). */
function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function backdropColor(kind: Backdrop, p: Palette): string {
  if (kind === 'dark') return mix(p.bg, '#000000', 0.55);
  if (kind === 'blob') return p.surface;
  return p.accent;
}

function radiusAll(r: number) {
  return { borderRadius: r };
}

function radiusBottom(r: number) {
  return { borderBottomLeftRadius: r, borderBottomRightRadius: r, borderTopWidth: 0 };
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  center: { alignItems: 'center' },
  centerFill: { alignItems: 'center', justifyContent: 'center' },
  captionTop: { paddingTop: 18, paddingHorizontal: 16, alignItems: 'center' },
  captionBottom: { position: 'absolute', left: 14, right: 14, bottom: 22, alignItems: 'center' },
  sticker: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 18,
    paddingVertical: 10,
    paddingHorizontal: 12,
    boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
  },
  phone: { borderWidth: 3.5, overflow: 'hidden', boxShadow: '0 10px 24px rgba(0,0,0,0.35)' },
  statusBar: {
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  island: { width: 34, height: 10, borderRadius: 5, backgroundColor: '#000' },
  navBar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6 },
  blocks: { gap: 6, paddingHorizontal: 9 },
  tabs: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingBottom: 4,
  },
  dots: { flexDirection: 'row', flexWrap: 'wrap', gap: 22, padding: 10 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  blob: { position: 'absolute', width: 260, height: 260, borderRadius: 130, opacity: 0.85 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6 },
  rowIcon: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  wrapTight: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  wrapBoard: { flexDirection: 'row', flexWrap: 'wrap' },
  bars: { height: 54, flexDirection: 'row', alignItems: 'flex-end', gap: 4, padding: 6 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 1 },
  calCell: { width: '14.28%', alignItems: 'center' },
  park: { position: 'absolute', width: 70, height: 50, borderRadius: 30, left: 10, top: 52, opacity: 0.25 },
  mapLabel: { position: 'absolute', left: 6, bottom: 6, paddingHorizontal: 7, paddingVertical: 4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 6 },
  artBlob: { position: 'absolute', width: 84, height: 84 },
  painting: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
});
